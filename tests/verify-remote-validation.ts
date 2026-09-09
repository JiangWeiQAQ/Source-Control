import { Script } from "scripting"
import { validateRemoteUrlSyntax, validateSupportedRemoteUrl } from "../src/core/remote/RemoteValidation"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function rejects(fn: () => unknown, message: string): void {
  let failed = false
  try { fn() } catch { failed = true }
  assert(failed, message)
}

async function run(): Promise<void> {
  rejects(() => validateRemoteUrlSyntax("not-a-url"), "拒绝无协议 URL")
  rejects(() => validateSupportedRemoteUrl("ftp://github.com/owner/repo"), "拒绝 ftp://")
  rejects(() => validateSupportedRemoteUrl("file://github.com/owner/repo"), "拒绝 file://")
  rejects(() => validateSupportedRemoteUrl("http://github.com/owner/repo"), "拒绝 http://")
  rejects(() => validateSupportedRemoteUrl("https://"), "拒绝空 hostname")
  rejects(() => validateSupportedRemoteUrl("https://github.com/owner/repo\n"), "拒绝控制字符/空白")
  assert(validateSupportedRemoteUrl("https://github.com/owner/repo.git").endsWith("repo.git"), "接受带 .git 的 HTTPS URL")
  assert(validateSupportedRemoteUrl("https://github.com/owner/repo").endsWith("repo"), "接受不带 .git 的 HTTPS URL")
  console.log("🎉 Remote URL 专项验证通过")
}

run().catch((error: unknown) => console.error("Remote URL 专项验证失败:", error)).finally(() => Script.exit())
