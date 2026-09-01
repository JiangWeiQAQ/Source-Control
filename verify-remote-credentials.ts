import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control Remote Credential Test-${Date.now()}`
const token = "secret-test-token"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(!message.includes(token), "错误信息泄漏 Token")
    assert(message.includes(text), `错误不包含 “${text}”`)
    return
  }
  throw new Error(`预期操作被拒绝: ${text}`)
}

async function createRepository(name: string): Promise<{ service: GitService; path: string; gitdir: string; repository: RepositoryInternals }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `remote-credential-${Date.now()}-${name}`)
  await service.stageAll()
  await service.commit("baseline")
  await service.addRemote("origin", "https://github.com/example/test.git")
  return { service, path, gitdir, repository: await service.openRepository(path) as unknown as RepositoryInternals }
}

async function capture(state: { path: string; gitdir: string; repository: RepositoryInternals }) {
  const { path, gitdir, repository } = state
  return {
    head: await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" }),
    branch: await repository.git.currentBranch({ fs: repository.fs, dir: path, gitdir, fullname: true }),
    index: await FileManager.readAsBytes(`${gitdir}/index`),
    worktree: await FileManager.readAsBytes(`${path}/tracked.txt`),
    matrix: await repository.git.statusMatrix({ fs: repository.fs, dir: path, gitdir }),
    config: await FileManager.readAsString(`${gitdir}/config`, "utf8"),
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function run(): Promise<void> {
  const projectA = await createRepository("project-a")
  const projectB = await createRepository("project-b")
  const before = await capture(projectA)
  const remoteUrl = (await projectA.service.listRemotes()).find((item) => item.name === "origin")?.url

  assert(!(await projectA.service.hasRemoteCredential("origin")), "初始状态不应有 Credential")
  await projectA.service.setRemoteCredential("origin", { username: "test-user", password: token })
  assert(await projectA.service.hasRemoteCredential("origin"), "保存后应存在 Credential")
  const saved = await projectA.service.getRemoteCredential("origin")
  assert(saved?.username === "test-user" && saved.password === token, "保存的 Credential 不正确")

  await projectA.service.setRemoteCredential("origin", { username: "test-user", password: "replacement-token" })
  assert((await projectA.service.getRemoteCredential("origin"))?.password === "replacement-token", "Credential 覆盖失败")
  await projectB.service.setRemoteCredential("origin", { username: "other-user", password: "token-B" })
  assert((await projectA.service.getRemoteCredential("origin"))?.password === "replacement-token", "Project A Credential 被 Project B 串用")
  assert((await projectB.service.getRemoteCredential("origin"))?.password === "token-B", "Project B Credential 不正确")

  await projectA.service.addRemote("upstream", "https://gitlab.com/example/upstream.git")
  await projectA.service.setRemoteCredential("upstream", { username: "upstream-user", password: "token-upstream" })
  assert((await projectA.service.getRemoteCredential("origin"))?.password === "replacement-token", "origin/upstream Credential 串用")
  assert((await projectA.service.getRemoteCredential("upstream"))?.password === "token-upstream", "upstream Credential 不正确")

  await expectReject(() => projectA.service.setRemoteCredential("missing", { username: "user", password: token }), "Remote 不存在")
  await projectA.service.addRemote("ssh", "git@github.com:example/ssh.git")
  await expectReject(() => projectA.service.setRemoteCredential("ssh", { username: "user", password: token }), "HTTPS credentials are not used for SSH remotes.")

  await projectA.service.removeRemoteCredential("origin")
  assert(!(await projectA.service.hasRemoteCredential("origin")), "删除后 Credential 应不存在")
  await projectA.service.removeRemoteCredential("origin")
  assert((await projectA.service.getRemoteCredential("upstream"))?.password === "token-upstream", "幂等删除不应影响其他 Remote")

  const after = await capture(projectA)
  assert(before.head === after.head && before.branch === after.branch, "Credential API 不应修改 HEAD 或 branch")
  assert(sameBytes(before.index, after.index), "Credential API 不应修改 Index")
  assert(sameBytes(before.worktree, after.worktree), "Credential API 不应修改 Working Tree")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix), "Credential API 不应修改 statusMatrix")
  assert(remoteUrl === (await projectA.service.listRemotes()).find((item) => item.name === "origin")?.url, "Credential API 不应修改 Remote URL")
  assert(!after.config.includes(token) && !after.config.includes("replacement-token") && !after.config.includes("token-upstream"), "Token 不得进入 Git config")

  await projectA.service.removeRemoteCredential("upstream")
  await projectB.service.removeRemoteCredential("origin")
  Script.exit({ ok: true, scenarios: ["missing", "save", "overwrite", "project-isolation", "remote-isolation", "ssh-rejected", "idempotent-remove", "config-clean", "integrity", "token-redacted"] })
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  Script.exit({ ok: false, error: message.includes(token) ? "credential test failed without token disclosure" : message })
})
