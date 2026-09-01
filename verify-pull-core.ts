import { Script } from "scripting"
import { GitRepository } from "./src/core/GitRepository"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type Internals = { git: IsomorphicGitAdapter; fs: unknown }
type State = { service: GitService; repository: Internals; path: string; gitdir: string; branch: string; baseOid: string }
const root = `${FileManager.scriptsDirectory}/Source Control Pull Core Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try { await action() } catch (error) { assert(String(error).includes(text), `Expected “${text}”, got ${String(error)}`); return }
  throw new Error(`Expected rejection: ${text}`)
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }

async function createRepo(name: string, files: Record<string, string>, commit = true): Promise<State> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  for (const [file, content] of Object.entries(files)) {
    const separator = file.lastIndexOf("/")
    if (separator >= 0) await FileManager.createDirectory(`${path}/${file.slice(0, separator)}`, true)
    await FileManager.writeAsString(`${path}/${file}`, content, "utf8")
  }
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `pull-${Date.now()}-${name}`)
  const repository = await service.openRepository(path) as unknown as Internals
  const branch = await service.getCurrentBranch()
  assert(branch, "repository should have a branch")
  if (commit) {
    await service.stageAll()
    const result = await service.commit("A")
    await service.addRemote("origin", "https://example.com/origin.git")
    return { service, repository: await service.openRepository(path) as unknown as Internals, path, gitdir, branch, baseOid: result.oid }
  }
  await service.addRemote("origin", "https://example.com/origin.git")
  const emptyTree = await repository.git.writeTree({ fs: repository.fs, dir: path, gitdir, tree: [] })
  const baseOid = await repository.git.writeCommit({ fs: repository.fs, dir: path, gitdir, commit: { message: "A", tree: emptyTree, parent: [], author: { name: "A", email: "a@example.com", timestamp: 1, timezoneOffset: 0 } } })
  return { service, repository, path, gitdir, branch, baseOid }
}

async function createCommit(state: State, files: Record<string, string>, parent: string, message: string): Promise<string> {
  const tree = [] as Array<{ mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" }>
  for (const [file, content] of Object.entries(files)) {
    const oid = await state.repository.git.writeBlob({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, blob: new TextEncoder().encode(content) })
    tree.push({ mode: "100644", path: file, oid, type: "blob" })
  }
  const treeOid = await state.repository.git.writeTree({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, tree })
  return state.repository.git.writeCommit({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, commit: { message, tree: treeOid, parent: [parent], author: { name: "Remote", email: "remote@example.com", timestamp: 2, timezoneOffset: 0 } } })
}

async function createNestedRemoteCommit(state: State, parent: string): Promise<string> {
  const blob = await state.repository.git.writeBlob({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, blob: new TextEncoder().encode("remote\n") })
  const nestedTree = await state.repository.git.writeTree({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, tree: [{ mode: "100644", path: "bar.ts", oid: blob, type: "blob" }] })
  const tracked = await state.repository.git.writeBlob({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, blob: new TextEncoder().encode("A\n") })
  const rootTree = await state.repository.git.writeTree({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, tree: [{ mode: "100644", path: "tracked.txt", oid: tracked, type: "blob" }, { mode: "040000", path: "foo", oid: nestedTree, type: "tree" }] })
  return state.repository.git.writeCommit({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, commit: { message: "file-dir", tree: rootTree, parent: [parent], author: { name: "Remote", email: "remote@example.com", timestamp: 2, timezoneOffset: 0 } } })
}
async function writeRemote(state: State, oid: string): Promise<void> {
  await state.repository.git.writeRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: `refs/remotes/origin/${state.branch}`, value: oid, force: true })
}
function pullRepository(state: State, overrides: Partial<IsomorphicGitAdapter> = {}): GitRepository {
  const adapter = Object.create(state.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(adapter, "fetch", { value: async () => undefined })
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(adapter, key, { value })
  return new GitRepository(state.path, state.gitdir, adapter, state.repository.fs)
}
async function capture(state: State) {
  return {
    head: await state.repository.git.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: "HEAD" }),
    branch: await state.service.getCurrentBranch(),
    index: (await FileManager.exists(`${state.gitdir}/index`)) ? await FileManager.readAsBytes(`${state.gitdir}/index`) : new Uint8Array(),
    tracked: await FileManager.readAsBytes(`${state.path}/tracked.txt`).catch(() => new Uint8Array()),
    other: await FileManager.readAsBytes(`${state.path}/other.txt`).catch(() => new Uint8Array()),
    matrix: await state.repository.git.statusMatrix({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir }),
  }
}
async function assertClean(state: State): Promise<void> { assert((await state.service.getStatus()).isClean, "repository should be clean") }

async function run(): Promise<void> {
  const equal = await createRepo("equal", { "tracked.txt": "A\n" })
  await writeRemote(equal, equal.baseOid)
  let checkoutCalls = 0
  const equalPull = pullRepository(equal, { checkout: async () => { checkoutCalls += 1 } })
  const equalBefore = await capture(equal)
  const equalResult = await equalPull.pullRemote()
  assert(!equalResult.pulled && checkoutCalls === 0, "equal Pull must not mutate")
  const equalAfter = await capture(equal); assert(equalBefore.head === equalAfter.head && sameBytes(equalBefore.index, equalAfter.index) && JSON.stringify(equalBefore.matrix) === JSON.stringify(equalAfter.matrix), "equal state changed")

  const behind = await createRepo("behind", { "tracked.txt": "A\n", "remove.txt": "remove\n" })
  const behindOid = await createCommit(behind, { "tracked.txt": "C\n", "new.txt": "new\n" }, behind.baseOid, "C")
  await writeRemote(behind, behindOid)
  const beforeHistory = await behind.service.getHistory(20)
  const behindPull = pullRepository(behind)
  const pulled = await behindPull.pullRemote()
  assert(pulled.localOidAfter === behindOid && pulled.remoteOid === behindOid, "behind result oid mismatch")
  assert(await FileManager.readAsString(`${behind.path}/tracked.txt`, "utf8") === "C\n", "modified file mismatch")
  assert(await FileManager.readAsString(`${behind.path}/new.txt`, "utf8") === "new\n", "added file missing")
  assert(!(await FileManager.exists(`${behind.path}/remove.txt`)), "deleted file still exists")
  await assertClean(behind)
  const afterHistory = await behind.service.getHistory(20)
  assert(afterHistory.length === beforeHistory.length + 1, `Pull created an unexpected commit count: before=${beforeHistory.length}, after=${afterHistory.length}`)
  const statusAfterPull = await behind.service.getStatus()
  assert(statusAfterPull.isClean && !statusAfterPull.changes.some((item) => item.filepath === "remove.txt"), "post-pull status incorrect")
  const afterAheadBehind = await behind.service.getAheadBehind()
  assert(afterAheadBehind.ahead === 0 && afterAheadBehind.behind === 0 && !afterAheadBehind.diverged, "post-pull ahead/behind incorrect")

  const ahead = await createRepo("ahead", { "tracked.txt": "A\n" })
  await FileManager.writeAsString(`${ahead.path}/tracked.txt`, "local\n", "utf8")
  await ahead.service.stageFile("tracked.txt")
  const aheadLocal = (await ahead.service.commit("local")).oid
  await writeRemote(ahead, ahead.baseOid)
  const aheadBefore = await capture(ahead)
  await expectReject(() => pullRepository(ahead).pullRemote(), "Local branch is ahead")
  const aheadAfter = await capture(ahead); assert(aheadBefore.head === aheadAfter.head && sameBytes(aheadBefore.index, aheadAfter.index) && sameBytes(aheadBefore.tracked, aheadAfter.tracked), "ahead rejection changed state")
  assert(aheadLocal !== ahead.baseOid, "ahead setup invalid")

  const diverged = await createRepo("diverged", { "tracked.txt": "A\n" })
  await FileManager.writeAsString(`${diverged.path}/tracked.txt`, "local\n", "utf8")
  await diverged.service.stageFile("tracked.txt")
  await diverged.service.commit("local")
  const remoteDiverged = await createCommit(diverged, { "tracked.txt": "remote\n" }, diverged.baseOid, "remote")
  await writeRemote(diverged, remoteDiverged)
  const divergedBefore = await capture(diverged)
  await expectReject(() => pullRepository(diverged).pullRemote(), "Local and remote branches have diverged")
  const divergedAfter = await capture(diverged); assert(divergedBefore.head === divergedAfter.head && sameBytes(divergedBefore.index, divergedAfter.index), "diverged rejection changed state")

  for (const [name, setup] of [["staged", "staged.txt"], ["untracked", "untracked.txt"]] as const) {
    const dirty = await createRepo(name, { "tracked.txt": "A\n" })
    if (name === "staged") { await FileManager.writeAsString(`${dirty.path}/tracked.txt`, "staged\n", "utf8"); await dirty.service.stageFile("tracked.txt") } else await FileManager.writeAsString(`${dirty.path}/${setup}`, "untracked\n", "utf8")
    const before = await capture(dirty)
    await expectReject(() => pullRepository(dirty).pullRemote(), "Working tree must be clean before pulling")
    const after = await capture(dirty); assert(before.head === after.head && sameBytes(before.index, after.index) && JSON.stringify(before.matrix) === JSON.stringify(after.matrix), `${name} rejection changed state`)
  }

  const fileDir = await createRepo("file-dir", { "tracked.txt": "A\n", foo: "file\n" })
  const fileDirTarget = await createNestedRemoteCommit(fileDir, fileDir.baseOid)
  await writeRemote(fileDir, fileDirTarget)
  const fileDirBefore = await capture(fileDir)
  await expectReject(() => pullRepository(fileDir).pullRemote(), "Pull path conflict")
  assert(await FileManager.readAsString(`${fileDir.path}/foo`, "utf8") === "file\n", "file-to-directory conflict partially changed")
  const fileDirAfter = await capture(fileDir); assert(fileDirBefore.head === fileDirAfter.head && sameBytes(fileDirBefore.index, fileDirAfter.index), "file-to-directory state changed")

  const dirFile = await createRepo("dir-file", { "tracked.txt": "A\n", "foo/bar.ts": "file\n" })
  const dirFileTarget = await createCommit(dirFile, { "tracked.txt": "A\n", foo: "remote\n" }, dirFile.baseOid, "dir-file")
  await writeRemote(dirFile, dirFileTarget)
  const dirFileBefore = await capture(dirFile)
  await expectReject(() => pullRepository(dirFile).pullRemote(), "Pull path conflict")
  assert(await FileManager.readAsString(`${dirFile.path}/foo/bar.ts`, "utf8") === "file\n", "directory-to-file conflict partially changed")
  const dirFileAfter = await capture(dirFile); assert(dirFileBefore.head === dirFileAfter.head && sameBytes(dirFileBefore.index, dirFileAfter.index), "directory-to-file state changed")

  const failing = await createRepo("checkout-failure", { "tracked.txt": "A\n", "other.txt": "old\n" })
  const failingTarget = await createCommit(failing, { "tracked.txt": "B\n", "other.txt": "new\n" }, failing.baseOid, "B")
  await writeRemote(failing, failingTarget)
  const failingBefore = await capture(failing)
  let checkoutCount = 0
  const failingAdapter = Object.create(failing.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(failingAdapter, "fetch", { value: async () => undefined })
  Object.defineProperty(failingAdapter, "checkout", { value: async () => { checkoutCount += 1; await FileManager.writeAsString(`${failing.path}/tracked.txt`, "B\n", "utf8"); if (checkoutCount === 1) throw new Error("injected checkout failure") } })
  await expectReject(() => new GitRepository(failing.path, failing.gitdir, failingAdapter, failing.repository.fs).pullRemote(), "Fast-forward Pull 失败")
  const failingAfter = await capture(failing); assert(checkoutCount >= 1 && failingBefore.head === failingAfter.head && sameBytes(failingBefore.index, failingAfter.index) && sameBytes(failingBefore.tracked, failingAfter.tracked) && sameBytes(failingBefore.other, failingAfter.other), `checkout rollback incomplete: before=${JSON.stringify(failingBefore)}, after=${JSON.stringify(failingAfter)}, count=${checkoutCount}`)

  const refFail = await createRepo("ref-failure", { "tracked.txt": "A\n" })
  const refTarget = await createCommit(refFail, { "tracked.txt": "B\n" }, refFail.baseOid, "B")
  await writeRemote(refFail, refTarget)
  const refAdapter = Object.create(refFail.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(refAdapter, "fetch", { value: async () => undefined })
  let refWriteCount = 0
  Object.defineProperty(refAdapter, "writeRef", { value: async (options: { ref: string; value: string; force?: boolean }) => { if (options.ref === `refs/heads/${refFail.branch}` && refWriteCount++ === 0) throw new Error("injected ref failure"); return refFail.repository.git.writeRef(options as never) } })
  const refBefore = await capture(refFail)
  await expectReject(() => new GitRepository(refFail.path, refFail.gitdir, refAdapter, refFail.repository.fs).pullRemote(), "Fast-forward Pull 失败")
  const refAfter = await capture(refFail); assert(refBefore.head === refAfter.head && sameBytes(refBefore.index, refAfter.index) && sameBytes(refBefore.tracked, refAfter.tracked), "ref rollback incomplete")

  const rollbackFailure = await createRepo("rollback-failure", { "tracked.txt": "A\n" })
  const rollbackTarget = await createCommit(rollbackFailure, { "tracked.txt": "B\n" }, rollbackFailure.baseOid, "B")
  await writeRemote(rollbackFailure, rollbackTarget)
  let rollbackStarted = false
  GitRepository.setPullTestHooks({ onRollbackStart: () => { rollbackStarted = true; throw new Error("injected rollback failure") } })
  const rollbackAdapter = Object.create(rollbackFailure.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(rollbackAdapter, "fetch", { value: async () => undefined })
  Object.defineProperty(rollbackAdapter, "checkout", { value: async () => { throw new Error("injected primary failure") } })
  try {
    await expectReject(() => new GitRepository(rollbackFailure.path, rollbackFailure.gitdir, rollbackAdapter, rollbackFailure.repository.fs).pullRemote(), "Pull failed and rollback was incomplete")
  } finally {
    GitRepository.setPullTestHooks(null)
  }
  assert(rollbackStarted, "rollback failure injection was not reached")

  const unborn = await createRepo("unborn", {}, false)
  const unbornB = await createCommit(unborn, { "tracked.txt": "B\n", "new.txt": "new\n" }, unborn.baseOid, "B")
  await writeRemote(unborn, unbornB)
  const unbornPull = pullRepository(unborn)
  const unbornResult = await unbornPull.pullRemote("origin", "master")
  assert(unbornResult.localOidAfter === unbornB && (await unborn.repository.git.resolveRef({ fs: unborn.repository.fs, dir: unborn.path, gitdir: unborn.gitdir, ref: "HEAD" })) === unbornB, "unborn Pull did not set branch")
  assert((await FileManager.readAsString(`${unborn.path}/tracked.txt`, "utf8")) === "B\n" && (await unborn.service.getStatus()).isClean, "unborn files/status incorrect")
  assert((await unborn.service.getHistory()).length === 2, "unborn Pull created an unexpected history")

  const detached = await createRepo("detached", { "tracked.txt": "A\n" })
  await FileManager.writeAsString(`${detached.gitdir}/HEAD`, `${detached.baseOid}\n`, "utf8")
  await expectReject(() => pullRepository(detached).pullRemote(), "Pull requires a local branch")
  const missing = await createRepo("missing-branch", { "tracked.txt": "A\n" })
  await expectReject(() => pullRepository(missing).pullRemote(), "Remote branch \"origin/master\" does not exist")

  Script.exit({ ok: true, scenarios: ["equal", "behind", "added", "modified", "deleted", "history", "ahead", "diverged", "staged", "untracked", "file-dir", "dir-file", "checkout-rollback", "ref-rollback", "rollback-failure", "unborn", "detached", "missing-branch"] })
}
run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
