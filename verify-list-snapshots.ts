import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control List Snapshots Test-${Date.now()}`
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }

async function makeRepo(name: string): Promise<{ service: GitService; repository: RepositoryInternals; path: string; gitdir: string }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `list-snapshots-${Date.now()}-${name}`)
  await service.stageAll(); await service.commit("baseline")
  return { service, repository: await service.openRepository(path) as unknown as RepositoryInternals, path, gitdir }
}

async function capture(state: { service: GitService; repository: RepositoryInternals; path: string; gitdir: string }) {
  const { repository, path, gitdir } = state
  const head = await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" })
  const branch = await repository.git.currentBranch({ fs: repository.fs, dir: path, gitdir, fullname: true })
  assert(branch, "测试仓库必须位于分支")
  const index = await FileManager.readAsBytes(`${gitdir}/index`)
  const matrix = await repository.git.statusMatrix({ fs: repository.fs, dir: path, gitdir })
  const content = await FileManager.readAsBytes(`${path}/tracked.txt`)
  return { head, branch, branchOid: await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: branch }), index, matrix, content }
}

async function createSnapshot(state: { service: GitService; path: string }, reason: string, content: string): Promise<string> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${state.path}/tracked.txt`, content, "utf8")
  const result = await state.service.createSafetySnapshot(reason)
  assert(result.created && result.ref, `未创建 Snapshot: ${reason}`)
  await state.service.restoreFile("tracked.txt")
  assert((await state.service.getStatus()).isClean, `Snapshot 后未清理: ${reason}`)
  return result.ref
}

async function run(): Promise<void> {
  const empty = await makeRepo("empty")
  assert((await empty.service.listSafetySnapshots()).length === 0, "空 Snapshot refs 应返回 []")

  const state = await makeRepo("snapshots")
  const refs = [
    await createSnapshot(state, "before ui", "snapshot one\n"),
    await createSnapshot(state, "before refactor", "snapshot two\n"),
    await createSnapshot(state, "before revert", "snapshot three\n"),
  ]
  const before = await capture(state)
  const snapshots = await state.service.listSafetySnapshots()
  const after = await capture(state)
  assert(snapshots.length === 3, "应列出 3 个 Snapshot")
  assert(snapshots.map((item) => item.reason).join("|") === "before revert|before refactor|before ui", "Snapshot 未按 timestamp 降序排序")
  for (const item of snapshots) {
    assert(item.ref.startsWith("refs/source-control/snapshots/"), "ref 格式错误")
    assert(item.oid.length === 40 && item.shortOid === item.oid.slice(0, 7), "oid 字段错误")
    assert(item.message === `snapshot: ${item.reason}`, "message/reason 解析错误")
    assert(item.timestamp > 0 && item.parentOid === before.head, "timestamp 或 parentOid 错误")
  }
  assert((await state.service.listSafetySnapshots(2)).length === 2, "limit(2) 未生效")
  assert(before.head === after.head && before.branch === after.branch && before.branchOid === after.branchOid, "列表调用改变 HEAD/branch")
  assert(sameBytes(before.index, after.index), "列表调用改变 Index")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix) && sameBytes(before.content, after.content), "列表调用改变 Working Tree/statusMatrix")
  assert(!(await state.service.getHistory(20)).some((item) => refs.includes(item.oid)), "Snapshot 错误出现在普通 History")

  await state.service.restoreSafetySnapshot(refs[2])
  assert((await state.service.listSafetySnapshots()).some((item) => item.ref === refs[2]), "Restore 后 Snapshot 不可列出")
  Script.exit({ ok: true, scenarios: ["empty", "three-snapshots", "sort", "limit", "state-unchanged", "history-isolation", "restore-retains-ref"] })
}
run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
