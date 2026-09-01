import { Script } from "scripting"
import { GitRepository } from "./src/core/GitRepository"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control Push Core Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(!message.includes("secret-test-token"), "Push 错误泄漏 Token")
    assert(message.includes(text), `错误不包含 “${text}”: ${message}`)
    return
  }
  throw new Error(`预期操作被拒绝: ${text}`)
}

async function createRepository(name: string, commit = true) {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "A\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `push-core-${Date.now()}-${name}`)
  const repository = await service.openRepository(path) as unknown as RepositoryInternals
  const branch = await service.getCurrentBranch()
  assert(branch, "应有当前分支")
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

async function writeRemote(state: { repository: RepositoryInternals; path: string; gitdir: string; branch: string }, oid: string): Promise<void> {
  await state.repository.git.writeRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: `refs/remotes/origin/${state.branch}`, value: oid, force: true })
}

async function capture(state: { service: GitService; path: string; gitdir: string; repository: RepositoryInternals; branch: string }) {
  return {
    head: await state.repository.git.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: "HEAD" }),
    branch: await state.service.getCurrentBranch(),
    localRef: await state.repository.git.resolveRef({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir, ref: `refs/heads/${state.branch}` }),
    index: await FileManager.readAsBytes(`${state.gitdir}/index`),
    worktree: await FileManager.readAsBytes(`${state.path}/tracked.txt`),
    matrix: await state.repository.git.statusMatrix({ fs: state.repository.fs, dir: state.path, gitdir: state.gitdir }),
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertUnchanged(before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>): void {
  assert(before.head === after.head && before.branch === after.branch && before.localRef === after.localRef, "Push 不应修改 HEAD 或 local branch")
  assert(sameBytes(before.index, after.index), "Push 不应修改 Index")
  assert(sameBytes(before.worktree, after.worktree), "Push 不应修改 Working Tree")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix), "Push 不应修改 statusMatrix")
}

async function run(): Promise<void> {
  const equal = await createRepository("equal")
  const equalOid = await equal.repository.git.resolveRef({ fs: equal.repository.fs, dir: equal.path, gitdir: equal.gitdir, ref: "HEAD" })
  await writeRemote(equal, equalOid)
  let equalPushCalled = false
  equal.repository.git.push = async () => { equalPushCalled = true }
  const equalResult = await equal.service.pushRemote()
  assert(!equalResult.pushed && !equalPushCalled, "Equal 不应发起网络 Push")

  const ahead = await createRepository("ahead")
  const base = await ahead.repository.git.resolveRef({ fs: ahead.repository.fs, dir: ahead.path, gitdir: ahead.gitdir, ref: "HEAD" })
  const localOid = await commit(ahead, "B")
  await writeRemote(ahead, base)
  const auth: Array<{ username: string; password: string }> = []
  const pushAdapter = Object.create(ahead.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(pushAdapter, "push", {
    value: async (options: { force: false; ref: string; remoteRef: string; onAuth?: () => { username: string; password: string } | void }) => {
      assert(options.force === false && options.ref === `refs/heads/${ahead.branch}` && options.remoteRef === `refs/heads/${ahead.branch}`, "Push ref 或 force 不安全")
      const credential = options.onAuth?.()
      if (credential) auth.push(credential)
    },
  })
  const pushRepository = new GitRepository(ahead.path, ahead.gitdir, pushAdapter, ahead.repository.fs)
  await ahead.service.setRemoteCredential("origin", { username: "test-user", password: "secret-test-token" })
  const aheadBefore = await capture(ahead)
  const aheadResult = await pushRepository.pushRemote()
  assert(aheadResult.pushed && aheadResult.remoteOidBefore === base && aheadResult.remoteOidAfter === localOid, "Local Ahead Push 结果错误")
  assert(auth[0]?.username === "test-user" && auth[0].password === "secret-test-token", "Credential onAuth 未正确接线")
  assert(await ahead.repository.git.resolveRef({ fs: ahead.repository.fs, dir: ahead.path, gitdir: ahead.gitdir, ref: `refs/remotes/origin/${ahead.branch}` }) === localOid, "成功后 remote-tracking ref 未更新")
  const afterPush = await ahead.service.getAheadBehind()
  assert(afterPush.ahead === 0 && afterPush.behind === 0 && !afterPush.diverged, "成功 Push 后 Ahead/Behind 应归零")
  assertUnchanged(aheadBefore, await capture(ahead))

  const initial = await createRepository("initial")
  const initialOid = await initial.repository.git.resolveRef({ fs: initial.repository.fs, dir: initial.path, gitdir: initial.gitdir, ref: "HEAD" })
  const initialAdapter = Object.create(initial.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(initialAdapter, "listServerRefs", { value: async () => [] })
  Object.defineProperty(initialAdapter, "push", { value: async () => undefined })
  const initialRepository = new GitRepository(initial.path, initial.gitdir, initialAdapter, initial.repository.fs)
  const initialResult = await initialRepository.pushRemote()
  assert(initialResult.pushed && initialResult.remoteOidBefore === null && initialResult.remoteOidAfter === initialOid, "首次新远端分支 Push 结果错误")
  assert(await initial.repository.git.resolveRef({ fs: initial.repository.fs, dir: initial.path, gitdir: initial.gitdir, ref: `refs/remotes/origin/${initial.branch}` }) === initialOid, "首次 Push 应更新 remote-tracking ref")

  const behind = await createRepository("behind")
  const behindBase = await behind.repository.git.resolveRef({ fs: behind.repository.fs, dir: behind.path, gitdir: behind.gitdir, ref: "HEAD" })
  await writeRemote(behind, await remoteCommit(behind, behindBase, "remote"))
  await expectReject(() => behind.service.pushRemote(), "remote branch is ahead")

  const diverged = await createRepository("diverged")
  const divergedBase = await diverged.repository.git.resolveRef({ fs: diverged.repository.fs, dir: diverged.path, gitdir: diverged.gitdir, ref: "HEAD" })
  await commit(diverged, "local")
  await writeRemote(diverged, await remoteCommit(diverged, divergedBase, "remote"))
  await expectReject(() => diverged.service.pushRemote(), "diverged")

  const unborn = await createRepository("unborn", false)
  await expectReject(() => unborn.service.pushRemote(), "Cannot push an unborn branch.")
  const missing = new GitService()
  await expectReject(() => missing.pushRemote(), "尚未打开任何 Git 仓库")

  const ssh = await createRepository("ssh")
  await ssh.service.setRemoteUrl("origin", "git@github.com:example/repo.git")
  await expectReject(() => ssh.service.pushRemote(), "SSH remotes are not supported yet.")

  const failure = await createRepository("failure")
  const failureBase = await failure.repository.git.resolveRef({ fs: failure.repository.fs, dir: failure.path, gitdir: failure.gitdir, ref: "HEAD" })
  await commit(failure, "local")
  await writeRemote(failure, failureBase)
  const failureAdapter = Object.create(failure.repository.git) as IsomorphicGitAdapter
  Object.defineProperty(failureAdapter, "push", {
    value: async () => { throw new Error("non-fast-forward rejected https://user:secret-test-token@example.com/repo.git") },
  })
  const failureRepository = new GitRepository(failure.path, failure.gitdir, failureAdapter, failure.repository.fs)
  const failureBefore = await capture(failure)
  await expectReject(() => failureRepository.pushRemote(), "Remote changed. Fetch before pushing again.")
  assertUnchanged(failureBefore, await capture(failure))
  assert(await failure.repository.git.resolveRef({ fs: failure.repository.fs, dir: failure.path, gitdir: failure.gitdir, ref: `refs/remotes/origin/${failure.branch}` }) === failureBase, "失败 Push 不得伪更新 remote-tracking ref")

  await ahead.service.removeRemoteCredential("origin")
  Script.exit({ ok: true, scenarios: ["equal", "ahead", "initial-branch", "behind", "diverged", "unborn", "missing", "ssh", "credential", "non-fast-forward", "integrity", "tracking-ref"] })
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  Script.exit({ ok: false, error: message.includes("secret-test-token") ? "push test failed without token disclosure" : message })
})
