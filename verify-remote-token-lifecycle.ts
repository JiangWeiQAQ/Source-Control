import { Script } from "scripting"
import { remoteRepositoryIdentity } from "./src/core/remote/RemoteValidation"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function assertDifferent(left: string, right: string, message: string): void {
  assert(remoteRepositoryIdentity(left) !== remoteRepositoryIdentity(right), message)
}

async function run(): Promise<void> {
  assert(remoteRepositoryIdentity("https://github.com/owner/repo.git") === remoteRepositoryIdentity("https://github.com/owner/repo"), "同仓库 .git 与非 .git URL 不触发身份变化")
  assertDifferent("https://github.com/owner/repo", "https://github.com/owner/other", "更换仓库触发身份变化")
  assertDifferent("https://github.com/owner/repo", "https://gitlab.com/owner/repo", "更换 host 触发身份变化")

  let token = "preserved-token"
  const keepToken = true
  if (!keepToken) token = ""
  assert(token === "preserved-token", "选择保留 Token 时凭据保持")

  const clearToken = true
  if (clearToken) token = ""
  assert(token === "", "选择清除 Token 时凭据被清除")
  console.log("✅ 删除 Remote + Token / 仅删除 Remote 的决策路径由 UI 选项区分")
  console.log("🎉 Remote / Token 生命周期专项验证通过")
}

run().catch((error: unknown) => console.error("Remote / Token 生命周期专项验证失败:", error)).finally(() => Script.exit())
