import { Script } from "scripting"
import { GitService } from "./src/core/GitService"

const projectPath = `${FileManager.scriptsDirectory}/Source Control Stage Test`
const trackedPath = `${projectPath}/tracked.txt`
const addedPath = `${projectPath}/commit-history-added-${Date.now()}.txt`

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function expectReject(action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(message.includes(expected), `预期错误包含 "${expected}"，实际为 "${message}"`)
    return
  }
  throw new Error(`预期操作被拒绝：${expected}`)
}

function assertFileHasNoChange(status: Awaited<ReturnType<GitService["getStatus"]>>, filepath: string, message: string): void {
  assert(!status.changes.some((change) => change.filepath === filepath), message)
}

async function clearStagedChanges(git: GitService): Promise<void> {
  const status = await git.getStatus()
  for (const change of status.stagedChanges) {
    await git.unstageFile(change.filepath)
  }
}

async function run(): Promise<void> {
  const git = new GitService()
  await git.openRepository(projectPath)
  await clearStagedChanges(git)
  await git.restoreFile("tracked.txt").catch(() => undefined)
  if (await FileManager.exists(addedPath)) await FileManager.remove(addedPath)

  await expectReject(() => git.commit("   "), "Commit 提交信息不能为空")
  await expectReject(() => git.commit("test: no staged changes"), "没有已暂存的变更")

  await FileManager.writeAsString(trackedPath, `baseline\ncommitted tracked change ${Date.now()}\n`, "utf8")
  await git.stageFile("tracked.txt")
  const trackedCommit = await git.commit("test: modify tracked")
  assert(trackedCommit.oid.length === 40, "Commit oid 不是完整 SHA-1")
  assert(trackedCommit.shortOid === trackedCommit.oid.slice(0, 7), "shortOid 不正确")
  assert(trackedCommit.message === "test: modify tracked", "Commit message 不正确")
  assertFileHasNoChange(await git.getStatus(), "tracked.txt", "tracked Commit 后文件仍有变更")

  await FileManager.writeAsString(addedPath, `committed added file ${Date.now()}\n`, "utf8")
  await git.stageFile(addedPath.split("/").pop()!)
  const addedCommit = await git.commit("test: add file")
  assertFileHasNoChange(await git.getStatus(), addedPath.split("/").pop()!, "added Commit 后文件仍有变更")

  const history = await git.getHistory(30)
  assert(history.length >= 2, "History 条目不足")
  assert(history[0].oid === addedCommit.oid && history[0].message === "test: add file", "History 未按最新优先返回")
  assert(history[0].shortOid === addedCommit.shortOid, "History shortOid 不正确")
  assert(history[0].timestamp > 0 && history[0].authorName.length > 0, "History author 或 timestamp 不正确")

  const trackedDetail = await git.getCommitDetail(trackedCommit.oid)
  assert(trackedDetail.changedFiles.some((file) => file.filepath === "tracked.txt" && file.changeType === "modified"), "tracked Commit Detail 缺少 modified 文件")
  const addedDetail = await git.getCommitDetail(addedCommit.oid)
  assert(addedDetail.changedFiles.some((file) => file.filepath === addedPath.split("/").pop()! && file.changeType === "added"), "added Commit Detail 缺少 added 文件")
  await expectReject(() => git.getCommitDetail("0000000000000000000000000000000000000000"), "读取 Commit")

  Script.exit({ ok: true, trackedCommit, addedCommit, historyFirst: history[0], trackedDetail, addedDetail })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
