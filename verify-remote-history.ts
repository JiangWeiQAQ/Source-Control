import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type RepositoryInternals = { git: IsomorphicGitAdapter; fs: unknown }
const path = `${FileManager.scriptsDirectory}/Source Control Remote History Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }

async function run(): Promise<void> {
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "first\n", "utf8")
  const service = new GitService(); const { gitdir } = await service.initRepository(path, `remote-history-${Date.now()}`)
  await service.stageAll(); await service.commit("remote baseline")
  await FileManager.writeAsString(`${path}/tracked.txt`, "second\n", "utf8")
  await service.stageAll(); await service.commit("local only")
  const repository = await service.openRepository(path) as unknown as RepositoryInternals
  const remoteOid = (await service.getHistory(2))[1]?.oid
  assert(remoteOid, "缺少基线 Commit")
  await repository.git.writeRef({ fs: repository.fs, dir: path, gitdir, ref: "refs/remotes/origin/master", value: remoteOid, force: true })
  const beforeHead = await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" })
  const beforeIndex = await FileManager.readAsBytes(`${gitdir}/index`); const beforeWorktree = await FileManager.readAsBytes(`${path}/tracked.txt`)
  const beforeRemote = await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "refs/remotes/origin/master" })
  const history = await service.getRemoteHistory("origin", "master", 10)
  assert(history.length === 1 && history[0].message === "remote baseline", "远端历史必须从 remote-tracking ref 读取，且不应包含本地未上传 Commit")
  assert(beforeHead === await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "HEAD" }), "读取远端历史不应修改 HEAD")
  assert(sameBytes(beforeIndex, await FileManager.readAsBytes(`${gitdir}/index`)), "读取远端历史不应修改 Index")
  assert(sameBytes(beforeWorktree, await FileManager.readAsBytes(`${path}/tracked.txt`)), "读取远端历史不应修改 Working Tree")
  assert(beforeRemote === await repository.git.resolveRef({ fs: repository.fs, dir: path, gitdir, ref: "refs/remotes/origin/master" }), "读取远端历史不应修改 remote ref")
  Script.exit({ ok: true, localHistory: (await service.getHistory(10)).map((item) => item.message), remoteHistory: history.map((item) => item.message) })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
