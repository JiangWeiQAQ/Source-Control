import { GitService } from "./src/core/GitService"

async function run() {
  const projectPath = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/Source Control"
  const service = new GitService()
  await service.openRepository(projectPath)
  await service.stageAll()
  const oid = await service.commit("docs: update README, docs landing page, and UI fixes for v1.0.0 release")
  console.log("Committed:", oid)
  const pushRes = await service.pushRemote("Source-Control", "master")
  console.log("Push result:", JSON.stringify(pushRes))
}

run().catch((e) => {
  console.error("执行失败:", e)
})
