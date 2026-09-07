import { Script } from "scripting"
import { GithubTokenCheckResult } from "./src/core/remote/RemoteValidation"

type MockResponse = { status: number; json: () => Promise<unknown> }

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function mapStatus(response: MockResponse): GithubTokenCheckResult["status"] {
  if (response.status === 200) return "valid"
  if (response.status === 401) return "invalid"
  if (response.status === 403) return "insufficient-permission"
  return "insufficient-permission"
}

async function run(): Promise<void> {
  assert(mapStatus({ status: 200, json: async () => ({}) }) === "valid", "200 映射为验证成功")
  assert(mapStatus({ status: 401, json: async () => ({}) }) === "invalid", "401 映射为验证失败")
  assert(mapStatus({ status: 403, json: async () => ({}) }) === "insufficient-permission", "403 映射为权限不足")
  assert(mapStatus({ status: 404, json: async () => ({}) }) === "insufficient-permission", "仓库 404 映射为仓库不可访问")
  console.log("🎉 Token 状态映射专项验证通过")
}

run().catch((error: unknown) => console.error("Token 状态专项验证失败:", error)).finally(() => Script.exit())
