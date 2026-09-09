import { Script } from "scripting"
import { listSyncRecords, recordSync, trimSyncRecords } from "../src/core/GitSyncHistory"
import { GitSyncRecord } from "../src/core/types"

const historyDir = `${FileManager.appGroupDocumentsDirectory}/source-control-sync-history`
const historyFile = `${historyDir}/records.json`
const testSuffix = Date.now()

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function makeRecord(
  id: string,
  syncedAt: number,
  options: { remoteName?: string; branchName?: string; kind?: GitSyncRecord["kind"] } = {},
): GitSyncRecord {
  return {
    id,
    remoteName: options.remoteName || "origin",
    branchName: options.branchName || "main",
    targetOid: `oid-${id}`,
    syncedAt,
    commitsUploaded: options.kind === "baseline" ? 0 : 1,
    kind: options.kind || "push",
  }
}

function bucketKey(projectId: string, remoteName = "origin", branchName = "main"): string {
  return `${projectId}:${remoteName}:${branchName}`
}

async function writeStore(store: Record<string, GitSyncRecord[]>): Promise<void> {
  if (!(await FileManager.exists(historyDir))) await FileManager.createDirectory(historyDir, true)
  await FileManager.writeAsString(historyFile, JSON.stringify(store), "utf8")
}

async function run(): Promise<void> {
  let originalHistory: string | null = null
  try {
    if (await FileManager.exists(historyFile)) originalHistory = await FileManager.readAsString(historyFile, "utf8")

    const shortRecords = Array.from({ length: 199 }, (_, index) => makeRecord(`short-${index + 1}`, index + 1))
    const shortTrimmed = trimSyncRecords(shortRecords)
    assert(shortTrimmed.length === 199, "少于 200 条记录时不裁剪")
    assert(shortTrimmed[0].syncedAt === 199 && shortTrimmed[198].syncedAt === 1, "少于 200 条记录仍按 syncedAt 倒序")

    const recentProject = `proj_sync_retention_recent_${testSuffix}`
    const recentSeed = Array.from({ length: 205 }, (_, index) => makeRecord(`recent-${index + 1}`, index + 1))
    await writeStore({ [bucketKey(recentProject)]: recentSeed })
    await recordSync(recentProject, makeRecord("recent-206", 206))
    const recentRecords = await listSyncRecords(recentProject, "origin", "main")
    assert(recentRecords.length === 200, "超过 200 条记录时最多保留 200 条")
    assert(recentRecords[0].id === "recent-206" && recentRecords[199].id === "recent-7", "裁剪后记录按 syncedAt 倒序并保留最近记录")
    assert(!recentRecords.some((record) => record.id === "recent-6"), "裁剪后最旧记录被移除")

    const orderedProject = `proj_sync_retention_order_${testSuffix}`
    await writeStore({})
    await recordSync(orderedProject, makeRecord("push-1", 300, { kind: "push" }))
    await recordSync(orderedProject, makeRecord("force-1", 301, { kind: "force-push" }))
    await recordSync(orderedProject, makeRecord("push-2", 302, { kind: "push" }))
    const orderedRecords = await listSyncRecords(orderedProject, "origin", "main")
    assert(orderedRecords.map((record) => record.kind).join(",") === "push,force-push,push", "push / force-push 记录顺序按 syncedAt 倒序")
    assert(orderedRecords.map((record) => record.id).join(",") === "push-2,force-1,push-1", "push / force-push 记录内容顺序正确")

    const baselineProject = `proj_sync_retention_baseline_${testSuffix}`
    const baselineSeed = [
      makeRecord("baseline-old", 1, { kind: "baseline" }),
      makeRecord("baseline-latest", 2, { kind: "baseline" }),
      ...Array.from({ length: 203 }, (_, index) => makeRecord(`baseline-recent-${index + 3}`, index + 3)),
    ]
    await writeStore({ [bucketKey(baselineProject)]: baselineSeed })
    await recordSync(baselineProject, makeRecord("baseline-recent-206", 206))
    const baselineRecords = await listSyncRecords(baselineProject, "origin", "main")
    assert(baselineRecords.length === 201, "最近 200 条中没有 baseline 时允许额外保留一条 baseline")
    assert(baselineRecords.filter((record) => record.kind === "baseline").length === 1, "只保留最近一条有效 baseline")
    assert(baselineRecords.some((record) => record.id === "baseline-latest"), "最近一条 baseline 未被裁剪")
    assert(!baselineRecords.some((record) => record.id === "baseline-old"), "更旧 baseline 不被额外保留")

    const groupedProject = `proj_sync_retention_grouped_${testSuffix}`
    const otherProject = `proj_sync_retention_other_${testSuffix}`
    await writeStore({
      [bucketKey(groupedProject, "origin", "main")]: [makeRecord("group-main-1", 1)],
      [bucketKey(groupedProject, "upstream", "main")]: [makeRecord("group-upstream-1", 1, { remoteName: "upstream" })],
      [bucketKey(groupedProject, "origin", "dev")]: [makeRecord("group-dev-1", 1, { branchName: "dev" })],
      [bucketKey(otherProject, "origin", "main")]: [makeRecord("other-project-1", 1)],
    })
    await recordSync(groupedProject, makeRecord("group-main-2", 2))
    assert((await listSyncRecords(groupedProject, "origin", "main")).length === 2, "目标 project + remote + branch 正常写入")
    assert((await listSyncRecords(groupedProject, "upstream", "main")).length === 1, "不同 remote 的记录互不影响")
    assert((await listSyncRecords(groupedProject, "origin", "dev")).length === 1, "不同 branch 的记录互不影响")
    assert((await listSyncRecords(otherProject, "origin", "main")).length === 1, "不同 project 的记录互不影响")

    const concurrentProject = `proj_sync_retention_concurrent_${testSuffix}`
    const concurrentSeed = Array.from({ length: 195 }, (_, index) => makeRecord(`concurrent-old-${index + 1}`, index + 1))
    await writeStore({ [bucketKey(concurrentProject)]: concurrentSeed })
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => recordSync(concurrentProject, makeRecord(`concurrent-new-${index + 1}`, 1000 + index))),
    )
    const concurrentRecords = await listSyncRecords(concurrentProject, "origin", "main")
    assert(concurrentRecords.length === 200, "并发 recordSync 后仍最多保留 200 条")
    assert(concurrentRecords.every((record) => record.id.startsWith("concurrent-new-") || record.syncedAt >= 6), "并发裁剪保留正确的最新记录")
    assert(concurrentRecords.filter((record) => record.id.startsWith("concurrent-new-")).length === 10, "并发 recordSync 不丢新记录")

    console.log("🎉 GitSyncHistory 长期存储裁剪专项验证通过")
  } finally {
    if (originalHistory === null) {
      if (await FileManager.exists(historyFile)) await FileManager.remove(historyFile)
    } else {
      await FileManager.writeAsString(historyFile, originalHistory, "utf8")
    }
  }
}

run().catch((error: unknown) => {
  console.error("GitSyncHistory 长期存储裁剪专项验证失败:", error)
}).finally(() => Script.exit())
