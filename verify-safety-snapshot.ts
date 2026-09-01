import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { GitRepository } from "./src/core/GitRepository"

const root = `${FileManager.scriptsDirectory}/Source Control Snapshot Test-${Date.now()}`

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(String(error).includes(text), `错误不包含 ${text}: ${String(error)}`)
    return
  }
  throw new Error(`未拒绝: ${text}`)
}

async function repo(name: string): Promise<{ service: GitService; repository: any; path: string; gitdir: string }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/staged.txt`, "A staged\n", "utf8")
  await FileManager.writeAsString(`${path}/unstaged.txt`, "A unstaged\n", "utf8")
  await FileManager.writeAsString(`${path}/deleted.txt`, "A deleted\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `snapshot-test-${Date.now()}-${name}`)
  await service.stageAll()
  await service.commit("baseline")
  const repository = await service.openRepository(path)
  return { service, repository, path, gitdir }
}

async function capture(state: { service: GitService; repository: any; path: string; gitdir: string }) {
  const { repository, path, gitdir } = state
  const adapter = repository.git
  const fs = repository.fs
  const head = await adapter.resolveRef({ fs, dir: path, gitdir, ref: "HEAD" })
  const branch = await adapter.currentBranch({ fs, dir: path, gitdir, fullname: true })
  assert(branch, "测试仓库必须处于分支上")
  const branchOid = await adapter.resolveRef({ fs, dir: path, gitdir, ref: branch })
  const index = await FileManager.readAsBytes(`${gitdir}/index`)
  const matrix = await adapter.statusMatrix({ fs, dir: path, gitdir })
  const status = await state.service.getStatus()
  const contents = new Map<string, Uint8Array>()
  for (const [filepath, , worktree] of matrix) {
    if (worktree !== 0) contents.set(filepath, await FileManager.readAsBytes(`${path}/${filepath}`))
  }
  return { head, branch, branchOid, index, matrix, status, contents }
}

async function assertUnchanged(before: Awaited<ReturnType<typeof capture>>, state: { service: GitService; repository: any; path: string; gitdir: string }, label: string): Promise<void> {
  const after = await capture(state)
  assert(after.head === before.head, `${label}: HEAD 改变`)
  assert(after.branch === before.branch && after.branchOid === before.branchOid, `${label}: 当前分支 ref 改变`)
  assert(sameBytes(after.index, before.index), `${label}: Index bytes 改变`)
  assert(JSON.stringify(after.matrix) === JSON.stringify(before.matrix), `${label}: statusMatrix 改变`)
  assert(JSON.stringify(after.status.stagedChanges) === JSON.stringify(before.status.stagedChanges), `${label}: stagedChanges 改变`)
  assert(JSON.stringify(after.status.unstagedChanges) === JSON.stringify(before.status.unstagedChanges), `${label}: unstagedChanges 改变`)
  assert(after.contents.size === before.contents.size, `${label}: Working Tree 文件集合改变`)
  for (const [filepath, bytes] of before.contents) assert(sameBytes(after.contents.get(filepath)!, bytes), `${label}: Working Tree 内容改变: ${filepath}`)
}

async function readTreeFiles(repository: any, treeOid: string, prefix = ""): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>()
  const entries = await repository.git.readTree({ fs: repository.fs, dir: repository.projectPath, gitdir: repository.gitdir, oid: treeOid })
  for (const entry of entries.tree) {
    const filepath = prefix ? `${prefix}/${entry.path}` : entry.path
    if (entry.type === "tree") {
      for (const [nestedPath, bytes] of await readTreeFiles(repository, entry.oid, filepath)) result.set(nestedPath, bytes)
    } else if (entry.type === "blob") {
      const object = await repository.git.readObject({ fs: repository.fs, dir: repository.projectPath, gitdir: repository.gitdir, oid: entry.oid, format: "content" })
      result.set(filepath, object.object)
    }
  }
  return result
}

async function assertSnapshot(state: { service: GitService; repository: any; path: string; gitdir: string }, reason: string): Promise<Map<string, Uint8Array>> {
  const before = await capture(state)
  const result = await state.service.createSafetySnapshot(reason)
  assert(result.created && result.oid && result.ref, "应创建并返回独立 Snapshot oid/ref")
  await assertUnchanged(before, state, reason)
  const adapter = state.repository.git
  const resolved = await adapter.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: result.ref })
  assert(resolved === result.oid, `${reason}: Snapshot ref 未指向返回 oid`)
  const commit = await adapter.readCommit({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, oid: result.oid })
  assert(commit.commit.parent.length === 1 && commit.commit.parent[0] === before.head, `${reason}: Snapshot parent 错误`)
  assert(commit.commit.message.trim() === `snapshot: ${reason}`, `${reason}: Snapshot message 错误`)
  const history = await state.service.getHistory(20)
  assert(!history.some((item) => item.oid === result.oid), `${reason}: Snapshot 污染普通 History`)
  return readTreeFiles(state.repository, commit.commit.tree)
}

async function run(): Promise<void> {
  const clean = await repo("clean")
  const cleanBefore = await capture(clean)
  assert(!(await clean.service.createSafetySnapshot("clean")).created, "clean 不应创建 Snapshot")
  await assertUnchanged(cleanBefore, clean, "clean")

  const staged = await repo("staged")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${staged.path}/staged.txt`, "B staged\n", "utf8")
  await staged.service.stageFile("staged.txt")
  const stagedTree = await assertSnapshot(staged, "before staged")
  assert(new TextDecoder().decode(stagedTree.get("staged.txt")) === "B staged\n", "only staged 未保存当前内容")

  const unstaged = await repo("unstaged")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${unstaged.path}/unstaged.txt`, "C unstaged\n", "utf8")
  const unstagedTree = await assertSnapshot(unstaged, "before unstaged")
  assert(new TextDecoder().decode(unstagedTree.get("unstaged.txt")) === "C unstaged\n", "only unstaged 未保存当前内容")

  const untracked = await repo("untracked")
  await FileManager.writeAsString(`${untracked.path}/untracked.txt`, "U content\n", "utf8")
  const untrackedTree = await assertSnapshot(untracked, "before untracked")
  assert(new TextDecoder().decode(untrackedTree.get("untracked.txt")) === "U content\n", "untracked 未保存到 Snapshot Tree")

  const deleted = await repo("deleted")
  await FileManager.remove(`${deleted.path}/deleted.txt`)
  const deletedTree = await assertSnapshot(deleted, "before deleted")
  assert(!deletedTree.has("deleted.txt"), "已删除文件仍错误存在于 Snapshot Tree")

  const mixed = await repo("mixed")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${mixed.path}/staged.txt`, "B staged\n", "utf8")
  await mixed.service.stageFile("staged.txt")
  await FileManager.writeAsString(`${mixed.path}/unstaged.txt`, "C unstaged\n", "utf8")
  await FileManager.writeAsString(`${mixed.path}/untracked.txt`, "U mixed\n", "utf8")
  const mixedTree = await assertSnapshot(mixed, "before mixed")
  assert(new TextDecoder().decode(mixedTree.get("staged.txt")) === "B staged\n", "mixed staged 内容错误")
  assert(new TextDecoder().decode(mixedTree.get("unstaged.txt")) === "C unstaged\n", "mixed unstaged 内容错误")
  assert(new TextDecoder().decode(mixedTree.get("untracked.txt")) === "U mixed\n", "mixed untracked 内容错误")

  await expectReject(() => mixed.service.createSafetySnapshot("   "), "Snapshot 原因不能为空")
  await expectReject(() => mixed.service.createSafetySnapshot("x".repeat(161)), "Snapshot 原因不能超过")

  const failure = await repo("write-ref-failure")
  await new Promise<void>((resolve) => setTimeout(resolve, 1100))
  await FileManager.writeAsString(`${failure.path}/staged.txt`, "failure content\n", "utf8")
  const failureBefore = await capture(failure)
  assert(!failureBefore.status.isClean, "失败注入前应存在工作区变更")
  const originalAdapter = failure.repository.git
  const failingAdapter = Object.create(originalAdapter)
  Object.defineProperty(failingAdapter, "writeRef", {
    value: async () => { throw new Error("injected writeRef failure") },
    configurable: true,
  })
  const failingRepository = new GitRepository(failure.path, failure.gitdir, failingAdapter, failure.repository.fs)
  await expectReject(() => failingRepository.createSafetySnapshot("write ref failure"), "injected writeRef failure")
  await assertUnchanged(failureBefore, failure, "writeRef failure")

  Script.exit({ ok: true, scenarios: ["clean", "staged", "unstaged", "untracked", "deleted", "mixed", "writeRef failure"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
