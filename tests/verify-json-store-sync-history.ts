import { Script } from "scripting"
import { JsonStore } from "../src/core/storage/JsonStore"
import { listSyncRecords, recordSync } from "../src/core/GitSyncHistory"
import { GitSyncRecord } from "../src/core/types"

const historyDir = `${FileManager.appGroupDocumentsDirectory}/source-control-sync-history`
const historyFile = `${historyDir}/records.json`
const testFile = `${FileManager.appGroupDocumentsDirectory}/source-control-json-store-test-${Date.now()}.json`

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function validRecord(id: string): GitSyncRecord {
  return {
    id,
    remoteName: "origin",
    branchName: "main",
    targetOid: id,
    syncedAt: Date.now(),
    commitsUploaded: 1,
    kind: "push",
  }
}

async function run(): Promise<void> {
  let originalHistory: string | null = null
  try {
    if (await FileManager.exists(historyFile)) originalHistory = await FileManager.readAsString(historyFile, "utf8")

    await FileManager.writeAsString(testFile, "{\"before\":true}", "utf8")
    let malformedReadFailed = false
    await FileManager.writeAsString(testFile, "not-json", "utf8")
    try { await JsonStore.readOrFallback(testFile, {}) } catch { malformedReadFailed = true }
    assert(malformedReadFailed, "readOrFallback 对损坏 JSON 抛错")
    let strictMissingFailed = false
    try { await JsonStore.readStrict(testFile + ".missing") } catch { strictMissingFailed = true }
    assert(strictMissingFailed, "readStrict 对缺失文件抛错")

    await FileManager.writeAsString(testFile, "{\"before\":true}", "utf8")
    let stringifyFailed = false
    try {
      const cyclic: { self?: unknown } = {}
      cyclic.self = cyclic
      await JsonStore.writeAtomic(testFile, cyclic)
    } catch { stringifyFailed = true }
    assert(stringifyFailed, "JSON 序列化失败会抛错")
    assert((await FileManager.readAsString(testFile, "utf8")) === "{\"before\":true}", "序列化失败时原文件保持不变")

    await FileManager.writeAsString(historyFile, "{}", "utf8")
    await FileManager.writeAsString(`${historyFile}.tmp.expired-test`, "stale", "utf8")
    await Promise.all([
      recordSync("proj_concurrent_test", validRecord("a")),
      recordSync("proj_concurrent_test", validRecord("b")),
    ])
    const concurrentRecords = await listSyncRecords("proj_concurrent_test", "origin", "main")
    assert(concurrentRecords.length === 2, "并发 recordSync 不丢记录")

    await FileManager.writeAsString(historyFile, JSON.stringify({
      "proj_invalid_test:origin:main": [validRecord("good"), { id: "bad" }],
    }), "utf8")
    const validRecords = await listSyncRecords("proj_invalid_test", "origin", "main")
    assert(validRecords.length === 1 && validRecords[0].id === "good", "单条无效记录被跳过，合法记录仍可读")

    await FileManager.writeAsString(historyFile, "[]", "utf8")
    let invalidRootFailed = false
    try { await listSyncRecords("proj_invalid_root") } catch { invalidRootFailed = true }
    assert(invalidRootFailed, "整体 store 根结构损坏时抛错")

    await FileManager.remove(testFile)
    console.log("🎉 JsonStore / GitSyncHistory 专项验证通过")
  } finally {
    if (await FileManager.exists(testFile)) await FileManager.remove(testFile)
    if (originalHistory === null) {
      if (await FileManager.exists(historyFile)) await FileManager.remove(historyFile)
    } else {
      await FileManager.writeAsString(historyFile, originalHistory, "utf8")
    }
    if (await FileManager.exists(`${historyFile}.tmp.expired-test`)) await FileManager.remove(`${historyFile}.tmp.expired-test`)
  }
}

run().catch((error: unknown) => {
  console.error("JsonStore / GitSyncHistory 专项验证失败:", error)
}).finally(() => Script.exit())
