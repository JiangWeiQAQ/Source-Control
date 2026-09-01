import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { GitRepository } from "./src/core/GitRepository"
import { IsomorphicGitAdapter } from "./src/core/types"

const root = `${FileManager.scriptsDirectory}/Source Control Restore Snapshot Test-${Date.now()}`

type RepositoryInternals = {
  projectPath: string
  gitdir: string
  git: IsomorphicGitAdapter
  fs: unknown
}

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try { await action() } catch (error) { assert(String(error).includes(text), `错误不包含 ${text}: ${String(error)}`); return }
  throw new Error(`未拒绝: ${text}`)
}

async function repo(name: string): Promise<{ service: GitService; repository: RepositoryInternals; path: string; gitdir: string }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  await FileManager.writeAsString(`${path}/old.txt`, "old baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `restore-snapshot-test-${Date.now()}-${name}`)
  await service.stageAll(); await service.commit("baseline")
  return { service, repository: await service.openRepository(path) as unknown as RepositoryInternals, path, gitdir }
}

async function capture(state: { service: GitService; repository: RepositoryInternals; path: string; gitdir: string }) {
  const { repository, path, gitdir } = state
  const head = await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" })
  const branch = await repository.git.currentBranch({ fs: repository.fs, dir: path, gitdir, fullname: true })
  assert(branch, "测试仓库必须在分支上")
  return { head, branch, branchOid: await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: branch }), index: await FileManager.readAsBytes(`${gitdir}/index`) }
}

async function assertHeadAndIndexUnchanged(before: Awaited<ReturnType<typeof capture>>, state: { repository: RepositoryInternals; path: string; gitdir: string }, label: string): Promise<void> {
  const after = await capture(state as never)
  assert(after.head === before.head, `${label}: HEAD 改变`)
  assert(after.branch === before.branch && after.branchOid === before.branchOid, `${label}: branch ref 改变`)
  assert(sameBytes(after.index, before.index), `${label}: Index bytes 改变`)
}

async function createSnapshot(state: { service: GitService }, reason: string): Promise<string> {
  const result = await state.service.createSafetySnapshot(reason)
  assert(result.created && result.ref, `${reason}: Snapshot 创建失败`)
  return result.ref
}

async function run(): Promise<void> {
  const modified = await repo("modified")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${modified.path}/tracked.txt`, "snapshot content\n", "utf8")
  const modifiedRef = await createSnapshot(modified, "modified")
  await modified.service.restoreFile("tracked.txt")
  assert((await modified.service.getStatus()).isClean, "modified: 清理 Snapshot 创建状态失败")
  const modifiedBefore = await capture(modified)
  const modifiedResult = await modified.service.restoreSafetySnapshot(modifiedRef)
  assert(modifiedResult.restored && modifiedResult.changedFiles === 1, "modified: 恢复结果错误")
  assert(await FileManager.readAsString(`${modified.path}/tracked.txt`, "utf8") === "snapshot content\n", "modified: 内容错误")
  assert((await modified.service.getStatus()).unstagedChanges.some((item) => item.filepath === "tracked.txt" && item.worktreeStatus === "modified"), "modified: 未显示为未暂存修改")
  await assertHeadAndIndexUnchanged(modifiedBefore, modified, "modified")
  assert(await modified.repository.git.resolveRef({ fs: modified.repository.fs, dir: modified.path, gitdir: modified.gitdir, ref: modifiedRef }), "modified: Snapshot ref 丢失")

  const added = await repo("added")
  await FileManager.writeAsString(`${added.path}/new.txt`, "snapshot added\n", "utf8")
  const addedRef = await createSnapshot(added, "added")
  await FileManager.remove(`${added.path}/new.txt`)
  assert((await added.service.getStatus()).isClean, "added: 清理 Snapshot 创建状态失败")
  const addedBefore = await capture(added)
  await added.service.restoreSafetySnapshot(addedRef)
  assert(await FileManager.readAsString(`${added.path}/new.txt`, "utf8") === "snapshot added\n", "added: 文件未恢复")
  assert((await added.service.getStatus()).unstagedChanges.some((item) => item.filepath === "new.txt" && item.worktreeStatus === "untracked"), "added: 未显示为 untracked")
  await assertHeadAndIndexUnchanged(addedBefore, added, "added")

  const deleted = await repo("deleted")
  await FileManager.remove(`${deleted.path}/old.txt`)
  const deletedRef = await createSnapshot(deleted, "deleted")
  await deleted.service.restoreFile("old.txt")
  assert((await deleted.service.getStatus()).isClean, "deleted: 清理 Snapshot 创建状态失败")
  const deletedBefore = await capture(deleted)
  await deleted.service.restoreSafetySnapshot(deletedRef)
  assert(!(await FileManager.exists(`${deleted.path}/old.txt`)), "deleted: 文件未删除")
  assert((await deleted.service.getStatus()).unstagedChanges.some((item) => item.filepath === "old.txt" && item.worktreeStatus === "deleted"), "deleted: 未显示为未暂存删除")
  await assertHeadAndIndexUnchanged(deletedBefore, deleted, "deleted")

  const multi = await repo("multi")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${multi.path}/tracked.txt`, "multi modified\n", "utf8")
  await FileManager.writeAsString(`${multi.path}/new.txt`, "multi added\n", "utf8")
  await FileManager.remove(`${multi.path}/old.txt`)
  const multiRef = await createSnapshot(multi, "multi")
  await multi.service.restoreFile("tracked.txt"); await multi.service.restoreFile("old.txt"); await FileManager.remove(`${multi.path}/new.txt`)
  assert((await multi.service.getStatus()).isClean, "multi: 清理 Snapshot 创建状态失败")
  const multiBefore = await capture(multi)
  const multiResult = await multi.service.restoreSafetySnapshot(multiRef)
  assert(multiResult.changedFiles === 3, "multi: changedFiles 错误")
  assert(await FileManager.readAsString(`${multi.path}/tracked.txt`, "utf8") === "multi modified\n", "multi: modified 错误")
  assert(await FileManager.readAsString(`${multi.path}/new.txt`, "utf8") === "multi added\n", "multi: added 错误")
  assert(!(await FileManager.exists(`${multi.path}/old.txt`)), "multi: deleted 错误")
  await assertHeadAndIndexUnchanged(multiBefore, multi, "multi")

  const dirty = await repo("dirty")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${dirty.path}/tracked.txt`, "snapshot dirty target\n", "utf8")
  const dirtyRef = await createSnapshot(dirty, "dirty")
  await dirty.service.restoreFile("tracked.txt")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${dirty.path}/tracked.txt`, "current user work\n", "utf8")
  await expectReject(() => dirty.service.restoreSafetySnapshot(dirtyRef), "当前工作区存在未提交变更")
  assert(await FileManager.readAsString(`${dirty.path}/tracked.txt`, "utf8") === "current user work\n", "dirty: 当前内容被覆盖")

  const invalid = await repo("invalid")
  await expectReject(() => invalid.service.restoreSafetySnapshot("refs/heads/main"), "仅允许恢复")
  await expectReject(() => invalid.service.restoreSafetySnapshot("refs/source-control/snapshots/not-found"), "指定的文件或引用不存在")

  const unsafe = await repo("unsafe-path")
  const unsafeHead = await unsafe.repository.git.resolveRef({ fs: unsafe.repository.fs, dir: unsafe.path, gitdir: unsafe.gitdir, ref: "HEAD" })
  const unsafeHeadCommit = await unsafe.repository.git.readCommit({ fs: unsafe.repository.fs, dir: unsafe.path, gitdir: unsafe.gitdir, oid: unsafeHead })
  const unsafeOid = await unsafe.repository.git.writeCommit({
    fs: unsafe.repository.fs,
    dir: unsafe.path,
    gitdir: unsafe.gitdir,
    commit: {
      message: "snapshot: unsafe path test",
      tree: unsafeHeadCommit.commit.tree,
      parent: [unsafeHead],
      author: { name: "Test", email: "test@example.com", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
    },
  })
  const unsafeRef = "refs/source-control/snapshots/unsafe-path-test"
  await unsafe.repository.git.writeRef({ fs: unsafe.repository.fs, dir: unsafe.path, gitdir: unsafe.gitdir, ref: unsafeRef, value: unsafeOid })
  const unsafeAdapter = Object.create(unsafe.repository.git) as IsomorphicGitAdapter
  const originalReadTree = unsafe.repository.git.readTree.bind(unsafe.repository.git)
  Object.defineProperty(unsafeAdapter, "readTree", {
    value: async (options: { fs: unknown; dir: string; gitdir: string; oid: string; filepath?: string }) => options.oid === unsafeHeadCommit.commit.tree
      ? { tree: [{ mode: "100644", path: "../unsafe.txt", oid: "0000000000000000000000000000000000000000", type: "blob" as const }] }
      : originalReadTree(options),
    configurable: true,
  })
  const unsafeRepository = new GitRepository(unsafe.path, unsafe.gitdir, unsafeAdapter, unsafe.repository.fs)
  const unsafeOriginal = await FileManager.readAsString(`${unsafe.path}/tracked.txt`, "utf8")
  await expectReject(() => unsafeRepository.restoreSafetySnapshot(unsafeRef), "路径包含不安全的向上遍历字符")
  assert(await FileManager.readAsString(`${unsafe.path}/tracked.txt`, "utf8") === unsafeOriginal, "unsafe path: 恢复前发生了部分写入")

  Script.exit({ ok: true, scenarios: ["modified", "added", "deleted", "multi", "dirty", "invalid-ref", "missing-ref", "unsafe-path"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
