import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

async function run(): Promise<void> {
  const path = `${FileManager.scriptsDirectory}/Source Control Checkout Probe-${Date.now()}`
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/tracked.txt`, "A\n", "utf8")
  const service = new GitService()
  const { gitdir } = await service.initRepository(path, `checkout-probe-${Date.now()}`)
  await service.stageAll()
  const first = await service.commit("A")
  await FileManager.writeAsString(`${path}/tracked.txt`, "B\n", "utf8")
  await service.stageAll()
  const second = await service.commit("B")
  const repo = await service.openRepository(path) as unknown as { git: IsomorphicGitAdapter; fs: unknown }
  await repo.git.writeRef({ fs: repo.fs, dir: path, gitdir, ref: "refs/remotes/origin/master", value: first.oid, force: true })
  await repo.git.checkout({ fs: repo.fs, dir: path, gitdir, ref: "refs/remotes/origin/master", force: false })
  Script.exit({ head: await repo.git.resolveRef({ fs: repo.fs, dir: path, gitdir, ref: "HEAD" }), expectedHead: second.oid, content: await FileManager.readAsString(`${path}/tracked.txt`, "utf8"), index: await repo.git.statusMatrix({ fs: repo.fs, dir: path, gitdir }) })
}
run().catch((error) => Script.exit({ error: error instanceof Error ? error.message : String(error) }))
