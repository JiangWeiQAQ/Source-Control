import { Script } from "scripting"
import { GitService } from "./src/core/GitService"

const rootPath = `${FileManager.scriptsDirectory}/Source Control Revert Core Test-${Date.now()}`

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

async function createRepository(name: string, files: Record<string, string>): Promise<{ git: GitService; path: string }> {
  const path = `${rootPath}/${name}`
  await FileManager.createDirectory(path, true)
  for (const [filepath, content] of Object.entries(files)) {
    await FileManager.writeAsString(`${path}/${filepath}`, content, "utf8")
  }
  const git = new GitService()
  await git.initRepository(path, `revert-core-${Date.now()}-${name}`)
  for (const filepath of Object.keys(files)) await git.stageFile(filepath)
  await git.commit("test: baseline")
  return { git, path }
}

async function run(): Promise<void> {
  await FileManager.createDirectory(rootPath, true)

  const modified = await createRepository("modified", { "tracked.txt": "A: baseline\n" })
  await FileManager.writeAsString(`${modified.path}/tracked.txt`, "B: modified\n", "utf8")
  await modified.git.stageFile("tracked.txt")
  const modifiedCommit = await modified.git.commit("test: modify tracked")
  const modifiedRevert = await modified.git.revertCommit(modifiedCommit.oid)
  assert(await FileManager.readAsString(`${modified.path}/tracked.txt`, "utf8") === "A: baseline\n", "modified Revert 未恢复 A 内容")
  const modifiedHistory = await modified.git.getHistory(10)
  assert(modifiedHistory[0].oid === modifiedRevert.oid && modifiedHistory.some((item) => item.oid === modifiedCommit.oid), "modified Revert 未保留历史或未创建新 Commit")
  assert(modifiedRevert.message === 'Revert "test: modify tracked"', "modified Revert message 不正确")

  const added = await createRepository("added", { "tracked.txt": "baseline\n" })
  await FileManager.writeAsString(`${added.path}/new.txt`, "B: added\n", "utf8")
  await added.git.stageFile("new.txt")
  const addedCommit = await added.git.commit("test: add new file")
  await added.git.revertCommit(addedCommit.oid)
  assert(!(await FileManager.exists(`${added.path}/new.txt`)), "added Revert 未删除 new.txt")

  const deleted = await createRepository("deleted", { "old.txt": "A: old\n" })
  await FileManager.remove(`${deleted.path}/old.txt`)
  await deleted.git.stageFile("old.txt")
  const deletedCommit = await deleted.git.commit("test: delete old file")
  await deleted.git.revertCommit(deletedCommit.oid)
  assert(await FileManager.readAsString(`${deleted.path}/old.txt`, "utf8") === "A: old\n", "deleted Revert 未恢复 old.txt")

  const dirty = await createRepository("dirty", { "tracked.txt": "A\n" })
  await FileManager.writeAsString(`${dirty.path}/tracked.txt`, "B\n", "utf8")
  await dirty.git.stageFile("tracked.txt")
  const dirtyCommit = await dirty.git.commit("test: change for dirty")
  await FileManager.writeAsString(`${dirty.path}/tracked.txt`, "dirty working tree\n", "utf8")
  await expectReject(() => dirty.git.revertCommit(dirtyCommit.oid), "工作区存在未提交变更")
  assert(await FileManager.readAsString(`${dirty.path}/tracked.txt`, "utf8") === "dirty working tree\n", "dirty Revert 覆盖了工作区内容")

  const conflict = await createRepository("conflict", { "tracked.txt": "A\n" })
  await FileManager.writeAsString(`${conflict.path}/tracked.txt`, "B\n", "utf8")
  await conflict.git.stageFile("tracked.txt")
  const conflictTarget = await conflict.git.commit("test: B change")
  await FileManager.writeAsString(`${conflict.path}/tracked.txt`, "C\n", "utf8")
  await conflict.git.stageFile("tracked.txt")
  await conflict.git.commit("test: C change")
  await expectReject(() => conflict.git.revertCommit(conflictTarget.oid), "已在当前 HEAD 中发生后续变化")
  assert(await FileManager.readAsString(`${conflict.path}/tracked.txt`, "utf8") === "C\n", "conflict Revert 覆盖了 C 内容")

  await expectReject(() => modified.git.revertCommit("0000000000000000000000000000000000000000"), "Revert Commit")
  const rootOid = modifiedHistory[modifiedHistory.length - 1].oid
  await expectReject(() => modified.git.revertCommit(rootOid), "暂不支持 Revert root Commit")

  Script.exit({ ok: true, modifiedCommit, modifiedRevert, addedCommit, deletedCommit })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
