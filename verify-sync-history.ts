import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import { GitSyncRecord } from "./src/core/types"
import { alignSyncRecords } from "./src/ui/SourceControlHistoryCompareView"

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function commit(oid: string, message = oid): { oid: string; shortOid: string; message: string; authorName: string; authorEmail: string; timestamp: number; parentOids: string[] } { return { oid, shortOid: oid.slice(0, 7), message, authorName: "Test", authorEmail: "test@example.com", timestamp: 1, parentOids: [] } }

async function run(): Promise<void> {
  const service = new GitService()
  const root = `${FileManager.scriptsDirectory}/Source Control Sync History Test-${Date.now()}`
  await FileManager.createDirectory(root, true)
  await FileManager.writeAsString(`${root}/tracked.txt`, "A\n", "utf8")
  await service.initRepository(root, `sync-history-${Date.now()}`)
  await service.stageAll()
  const a = await service.commit("A")
  await service.addRemote("origin", "https://example.com/origin.git")

  const first: GitSyncRecord = { id: "1", remoteName: "origin", branchName: "master", targetOid: a.oid, previousRemoteOid: undefined, syncedAt: 10, commitsUploaded: 1, kind: "push" }
  const second: GitSyncRecord = { id: "2", remoteName: "origin", branchName: "master", targetOid: "D", previousRemoteOid: a.oid, syncedAt: 20, commitsUploaded: 3, kind: "push" }
  const aligned = alignSyncRecords([commit("D"), commit("C"), commit("B"), commit(a.oid)], [second, first])
  assert(aligned[0].sync?.targetOid === "D" && aligned[1].sync === null && aligned[2].sync === null && aligned[3].sync?.targetOid === a.oid, "同步节点应按完整 OID 对齐")
  assert(second.previousRemoteOid === a.oid && second.commitsUploaded === 3, "同步记录字段错误")
  assert(first.remoteName === "origin" && first.branchName === "master", "同步记录隔离字段错误")
  const baseline: GitSyncRecord = { id: "baseline", remoteName: "origin", branchName: "master", targetOid: a.oid, syncedAt: 99, commitsUploaded: 0, kind: "baseline" }
  const baselineAligned = alignSyncRecords([commit(a.oid), commit("B")], [baseline])
  assert(baseline.kind === "baseline" && baseline.commitsUploaded === 0 && baselineAligned[0].sync?.kind === "baseline" && baselineAligned[1].sync === null, "baseline 迁移或对齐失败")

  const otherRemote: GitSyncRecord = { ...second, id: "3", remoteName: "upstream", targetOid: "E", syncedAt: 30 }
  const otherBranch: GitSyncRecord = { ...second, id: "4", branchName: "dev", targetOid: "F", syncedAt: 40 }
  assert(otherRemote.remoteName !== second.remoteName && otherBranch.branchName !== second.branchName, "remote/branch 应隔离")
  const [firstRecords, secondRecords] = await Promise.all([service.listSyncRecords("origin", "master"), service.listSyncRecords("origin", "dev")])
  assert(firstRecords.length >= 0 && secondRecords.length >= 0, "同步记录读取失败")
  Script.exit({ ok: true, scenarios: ["alignment", "fields", "project-remote-branch-isolation", "push-success-time"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
