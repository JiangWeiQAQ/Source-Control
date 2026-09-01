import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control Ahead Behind Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(String(error).includes(text), `错误不包含 “${text}”: ${String(error)}`)
    return
  }
  throw new Error(`预期操作被拒绝: ${text}`)
}

async function createRepository(name: string, commit = true): Promise<{ service: GitService; path: string; gitdir: string; repository: RepositoryInternals; branch: string }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `ahead-behind-${Date.now()}-${name}`)
  const repository = await service.openRepository(path) as unknown as RepositoryInternals
  const branch = await service.getCurrentBranch()
  assert(branch, "初始化仓库应位于分支")
  if (commit) {
    await service.stageAll()
    await service.commit("A")
  }
  await service.addRemote("origin", "https://example.com/origin.git")
  return { service, path, gitdir, repository, branch }
}

async function commit(state: { service: GitService; path: string }, message: string): Promise<string> {
  await FileManager.writeAsString(`${state.path}/tracked.txt`, `${message}\n`, "utf8")
  await state.service.stageFile("tracked.txt")
  return (await state.service.commit(message)).oid
}

async function writeRemote(state: { repository: RepositoryInternals; path: string; gitdir: string; branch: string }, oid: string, remote = "origin"): Promise<void> {
  await state.repository.git.writeRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: `refs/remotes/${remote}/${state.branch}`, value: oid, force: true })
}

async function remoteCommit(state: { repository: RepositoryInternals; path: string; gitdir: string }, parent: string, message: string): Promise<string> {
  const base = await state.repository.git.readCommit({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, oid: parent })
  return state.repository.git.writeCommit({
    fs: state.repository.fs,
    dir: state.path,
    gitdir: state.gitdir,
    commit: {
      message,
      tree: base.commit.tree,
      parent: [parent],
      author: { name: "Remote", email: "remote@example.com", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
    },
  })
}

async function capture(state: { service: GitService; path: string; gitdir: string; repository: RepositoryInternals; branch: string }) {
  return {
    head: await state.repository.git.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: "HEAD" }),
    branch: await state.service.getCurrentBranch(),
    localRef: await state.repository.git.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: `refs/heads/${state.branch}` }),
    index: await FileManager.readAsBytes(`${state.gitdir}/index`),
    worktree: await FileManager.readAsBytes(`${state.path}/tracked.txt`),
    matrix: await state.repository.git.statusMatrix({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir }),
    remoteRefs: await state.repository.git.listRefs({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, filepath: "refs/remotes" }),
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertUnchanged(before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>): void {
  assert(before.head === after.head && before.branch === after.branch && before.localRef === after.localRef, "Ahead/Behind 不应修改 HEAD 或 local branch")
  assert(sameBytes(before.index, after.index), "Ahead/Behind 不应修改 Index")
  assert(sameBytes(before.worktree, after.worktree), "Ahead/Behind 不应修改 Working Tree")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix), "Ahead/Behind 不应修改 statusMatrix")
  assert(JSON.stringify(before.remoteRefs) === JSON.stringify(after.remoteRefs), "Ahead/Behind 不应修改 remote refs")
}

async function run(): Promise<void> {
  const equal = await createRepository("equal")
  const base = await equal.repository.git.resolveRef({ fs: equal.repository.fs, dir: equal.path, gitdir: equal.gitdir, ref: "HEAD" })
  await writeRemote(equal, base)
  const before = await capture(equal)
  const equalResult = await equal.service.getAheadBehind()
  assert(equalResult.ahead === 0 && equalResult.behind === 0 && !equalResult.diverged, "Equal 计算错误")
  assertUnchanged(before, await capture(equal))

  const ahead = await createRepository("ahead")
  const aheadBase = await ahead.repository.git.resolveRef({ fs: ahead.repository.fs, dir: ahead.path, gitdir: ahead.gitdir, ref: "HEAD" })
  await commit(ahead, "B")
  await commit(ahead, "C")
  await writeRemote(ahead, aheadBase)
  const aheadResult = await ahead.service.getAheadBehind()
  assert(aheadResult.ahead === 2 && aheadResult.behind === 0 && !aheadResult.diverged, "Local Ahead 计算错误")

  const behind = await createRepository("behind")
  const behindBase = await behind.repository.git.resolveRef({ fs: behind.repository.fs, dir: behind.path, gitdir: behind.gitdir, ref: "HEAD" })
  const remoteB = await remoteCommit(behind, behindBase, "B")
  const remoteC = await remoteCommit(behind, remoteB, "C")
  await writeRemote(behind, remoteC)
  const behindResult = await behind.service.getAheadBehind()
  assert(behindResult.ahead === 0 && behindResult.behind === 2 && !behindResult.diverged, "Local Behind 计算错误")

  const diverged = await createRepository("diverged")
  const divergedBase = await diverged.repository.git.resolveRef({ fs: diverged.repository.fs, dir: diverged.path, gitdir: diverged.gitdir, ref: "HEAD" })
  await commit(diverged, "B")
  await commit(diverged, "C")
  const remoteD = await remoteCommit(diverged, divergedBase, "D")
  const remoteE = await remoteCommit(diverged, remoteD, "E")
  await writeRemote(diverged, remoteE)
  const divergedResult = await diverged.service.getAheadBehind()
  assert(divergedResult.ahead === 2 && divergedResult.behind === 2 && divergedResult.diverged, "Diverged 计算错误")

  const missingBranch = await createRepository("missing-branch")
  await expectReject(() => missingBranch.service.getAheadBehind(), "Remote branch")
  await expectReject(() => missingBranch.service.getAheadBehind("missing"), "Remote 不存在")

  const unborn = await createRepository("unborn", false)
  const tree = await unborn.repository.git.writeTree({ fs: unborn.repository.fs, dir: unborn.path, gitdir: unborn.gitdir, tree: [] })
  const remoteRoot = await unborn.repository.git.writeCommit({
    fs: unborn.repository.fs,
    dir: unborn.path,
    gitdir: unborn.gitdir,
    commit: {
      message: "remote root",
      tree,
      parent: [],
      author: { name: "Remote", email: "remote@example.com", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
    },
  })
  const remoteNext = await remoteCommit(unborn, remoteRoot, "remote next")
  await writeRemote(unborn, remoteNext)
  const unbornResult = await unborn.service.getAheadBehind()
  assert(unbornResult.localOid === null && unbornResult.ahead === 0 && unbornResult.behind === 2, "Unborn local 计算错误")

  const multi = await createRepository("multi")
  const multiBase = await multi.repository.git.resolveRef({ fs: multi.repository.fs, dir: multi.path, gitdir: multi.gitdir, ref: "HEAD" })
  const originNext = await remoteCommit(multi, multiBase, "origin next")
  const upstreamNext = await remoteCommit(multi, originNext, "upstream next")
  await writeRemote(multi, originNext)
  await multi.service.addRemote("upstream", "https://example.com/upstream.git")
  await writeRemote(multi, upstreamNext, "upstream")
  assert((await multi.service.getAheadBehind("origin")).behind === 1, "origin 结果错误")
  assert((await multi.service.getAheadBehind("upstream")).behind === 2, "upstream 结果错误")

  await FileManager.writeAsString(`${equal.gitdir}/HEAD`, `${base}\n`, "utf8")
  await expectReject(() => equal.service.getAheadBehind(), "Ahead/behind requires a local branch.")

  Script.exit({ ok: true, scenarios: ["equal", "ahead", "behind", "diverged", "missing-branch", "missing-remote", "unborn", "detached", "multi-remote", "integrity"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
