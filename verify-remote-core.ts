import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const root = `${FileManager.scriptsDirectory}/Source Control Remote Core Test-${Date.now()}`

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

async function createRepository(name: string, commit = true): Promise<{ service: GitService; path: string; gitdir: string; repository: RepositoryInternals }> {
  const path = `${root}/${name}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "baseline\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `remote-core-${Date.now()}-${name}`)
  if (commit) {
    await service.stageAll()
    await service.commit("baseline")
  }
  return { service, path, gitdir, repository: await service.openRepository(path) as unknown as RepositoryInternals }
}

async function capture(state: { service: GitService; path: string; gitdir: string; repository: RepositoryInternals }) {
  const { path, gitdir, repository } = state
  const head = await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" })
  const index = await FileManager.readAsBytes(`${gitdir}/index`)
  const worktree = await FileManager.readAsBytes(`${path}/tracked.txt`)
  const matrix = await repository.git.statusMatrix({ fs: repository.fs, dir: path, gitdir })
  return { head, index, worktree, matrix }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

async function run(): Promise<void> {
  const empty = await createRepository("empty", false)
  assert((await empty.service.listRemotes()).length === 0, "新仓库应无 Remote")
  assert(await empty.service.getCurrentBranch() === "master", "unborn branch 应返回 master")

  const state = await createRepository("configured")
  assert(await state.service.getCurrentBranch() === "master", "正常仓库应返回 master")
  const before = await capture(state)

  await state.service.addRemote("origin", "https://github.com/example/test.git")
  assert((await state.service.listRemotes()).length === 1 && (await state.service.listRemotes())[0].url === "https://github.com/example/test.git", "origin 未正确保存")
  await expectReject(() => state.service.addRemote("origin", "https://github.com/example/duplicate.git"), "Remote 已存在")

  await state.service.setRemoteUrl("origin", "https://github.com/example/new.git")
  assert((await state.service.listRemotes())[0].url === "https://github.com/example/new.git", "origin URL 未更新")
  await expectReject(() => state.service.setRemoteUrl("missing", "https://github.com/example/missing.git"), "Remote 不存在")

  await state.service.addRemote("upstream", "git@github.com:example/upstream.git")
  const remotes = await state.service.listRemotes()
  assert(remotes.length === 2 && remotes.some((item) => item.name === "origin") && remotes.some((item) => item.name === "upstream" && item.url === "git@github.com:example/upstream.git"), "多个 Remote 或 SSH URL 错误")

  await state.service.removeRemote("origin")
  assert((await state.service.listRemotes()).length === 1 && (await state.service.listRemotes())[0].name === "upstream", "origin 未删除")
  await expectReject(() => state.service.removeRemote("missing"), "Remote 不存在")
  await state.service.removeRemote("upstream")
  assert((await state.service.listRemotes()).length === 0, "删除全部 Remote 后应为空")

  const after = await capture(state)
  assert(before.head === after.head, "Remote API 不应修改 HEAD")
  assert(sameBytes(before.index, after.index), "Remote API 不应修改 Index")
  assert(sameBytes(before.worktree, after.worktree), "Remote API 不应修改 Working Tree")
  assert(JSON.stringify(before.matrix) === JSON.stringify(after.matrix), "Remote API 不应修改 statusMatrix")

  Script.exit({ ok: true, scenarios: ["empty", "unborn-branch", "add", "duplicate", "update", "missing", "multiple", "https", "ssh", "remove", "integrity"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
