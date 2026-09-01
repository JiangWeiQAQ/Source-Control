import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control Fetch Core Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(!message.includes("secret-test-token"), "Fetch 错误泄漏 Token")
    assert(message.includes(text), `错误不包含 “${text}”: ${message}`)
    return
  }
  throw new Error(`预期操作被拒绝: ${text}`)
}

async function createRepository(name: string): Promise<{ service: GitService; path: string; gitdir: string; repository: RepositoryInternals }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `fetch-core-${Date.now()}-${name}`)
  await service.stageAll()
  await service.commit("baseline")
  return { service, path, gitdir, repository: await service.openRepository(path) as unknown as RepositoryInternals }
}

async function capture(state: { service: GitService; path: string; gitdir: string; repository: RepositoryInternals }) {
  const { service, path, gitdir, repository } = state
  return {
    head: await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" }),
    branch: await service.getCurrentBranch(),
    index: await FileManager.readAsBytes(`${gitdir}/index`),
    worktree: await FileManager.readAsBytes(`${path}/tracked.txt`),
    matrix: await repository.git.statusMatrix({ fs: repository.fs, dir: path, gitdir }),
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertUnchanged(before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>): void {
  assert(before.head === after.head && before.branch === after.branch, "Fetch 不应修改 local HEAD 或 branch")
  assert(sameBytes(before.index, after.index), "Fetch 不应修改 Index")
  assert(sameBytes(before.worktree, after.worktree), "Fetch 不应修改 Working Tree")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix), "Fetch 不应修改 statusMatrix")
}

async function run(): Promise<void> {
  const local = await createRepository("local")
  assert((await local.service.listRemoteBranches("origin")).length === 0, "未 Fetch 时 Remote Branch 应为空")
  await expectReject(() => local.service.fetchRemote("origin"), "Remote 不存在")
  await local.service.addRemote("ssh", "git@github.com:example/repo.git")
  await expectReject(() => local.service.fetchRemote("ssh"), "SSH remotes are not supported yet.")

  await local.service.addRemote("invalid", "https://127.0.0.1:1/unavailable.git")
  await local.service.setRemoteCredential("invalid", { username: "user", password: "secret-test-token" })
  const beforeFailure = await capture(local)
  await expectReject(() => local.service.fetchRemote("invalid"), "网络失败")
  assertUnchanged(beforeFailure, await capture(local))

  const unbornPath = `${root}/unborn`
  await FileManager.createDirectory(unbornPath, true)
  const unborn = new GitService()
  await unborn.initRepository(unbornPath, `fetch-unborn-${Date.now()}`)
  await unborn.addRemote("origin", "https://github.com/octocat/Hello-World.git")
  assert(await unborn.getCurrentBranch() === "master", "Fetch 前 unborn branch 应保持 master")
  try {
    const unbornFetch = await unborn.fetchRemote()
    assert(unbornFetch.fetched && (await unborn.listRemoteBranches()).length > 0, "unborn repository Fetch 后应存在 Remote Branch")
    assert(await unborn.getCurrentBranch() === "master", "Fetch 不应创建或切换 unborn local branch")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("网络失败")) throw error
  }

  const publicState = await createRepository("public")
  await publicState.service.addRemote("origin", "https://github.com/octocat/Hello-World.git")
  await publicState.service.removeRemoteCredential("origin")
  const beforePublic = await capture(publicState)
  try {
    const result = await publicState.service.fetchRemote()
    const branches = await publicState.service.listRemoteBranches()
    assert(result.fetched && branches.length > 0, "公开 Fetch 后应存在 Remote Branch")
    assert(branches.every((branch) => branch.ref.startsWith("refs/remotes/origin/") && branch.remote === "origin"), "Remote Branch ref 格式错误")
    assertUnchanged(beforePublic, await capture(publicState))
    Script.exit({ ok: true, network: "passed", scenarios: ["missing", "ssh", "empty-branches", "credential-callback", "failure-integrity", "public-fetch", "remote-branches", "unborn-fetch"] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assertUnchanged(beforePublic, await capture(publicState))
    Script.exit({ ok: true, network: "skipped", reason: message.replace(/https?:\/\/[^@\s/]+@/gi, "https://***@"), scenarios: ["missing", "ssh", "empty-branches", "credential-callback", "failure-integrity", "public-fetch-skipped", "unborn-fetch"] })
  }
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
