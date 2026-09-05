import { GitSyncRecord } from "./types"
import { hashString } from "./identity/hash"
import { JsonStore } from "./storage/JsonStore"

export { hashString } from "./identity/hash"

const SYNC_HISTORY_DIR = `${FileManager.appGroupDocumentsDirectory}/source-control-sync-history`
const SYNC_HISTORY_FILE = `${SYNC_HISTORY_DIR}/records.json`

type SyncHistoryStore = Record<string, GitSyncRecord[]>

export function resolveSyncIdentity(projectIdOrPath: string): string {
  if (projectIdOrPath.startsWith("proj_")) {
    return projectIdOrPath
  }
  return hashString(projectIdOrPath)
}

function key(projectIdOrPath: string, remoteName: string, branchName: string): string {
  return `${resolveSyncIdentity(projectIdOrPath)}:${remoteName}:${branchName}`
}

async function readStore(): Promise<SyncHistoryStore> {
  const value = await JsonStore.read<unknown>(SYNC_HISTORY_FILE, {})
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as SyncHistoryStore
}

async function writeStore(store: SyncHistoryStore): Promise<void> {
  await JsonStore.writeAtomic(SYNC_HISTORY_FILE, store)
}

/**
 * 迁移特定旧路径的同步历史到稳定的 projectId
 */
export async function migrateSyncHistory(oldPath: string, projectId: string): Promise<void> {
  const store = await readStore()
  const oldPrefix = `${hashString(oldPath)}:`
  const newPrefix = `${projectId}:`
  let changed = false

  for (const storeKey of Object.keys(store)) {
    if (storeKey.startsWith(oldPrefix)) {
      const remainder = storeKey.substring(oldPrefix.length)
      const newKey = `${newPrefix}${remainder}`
      const existing = store[newKey] || []
      const oldRecords = store[storeKey] || []
      // 合并并去重
      const mergedMap = new Map<string, GitSyncRecord>()
      for (const r of [...existing, ...oldRecords]) {
        mergedMap.set(r.targetOid, r)
      }
      store[newKey] = Array.from(mergedMap.values()).sort((a, b) => b.syncedAt - a.syncedAt)
      delete store[storeKey]
      changed = true
    }
  }

  if (changed) {
    await writeStore(store)
  }
}

function collectSyncRecords(store: SyncHistoryStore, id: string, remoteName?: string, branchName?: string): GitSyncRecord[] {
  const records: GitSyncRecord[] = []
  for (const [storeKey, values] of Object.entries(store)) {
    if (!storeKey.startsWith(`${id}:`)) continue
    if (remoteName && !storeKey.startsWith(`${id}:${remoteName}:`)) continue
    if (branchName && !storeKey.endsWith(`:${branchName}`)) continue
    records.push(...(Array.isArray(values) ? values : []))
  }
  return records.sort((a, b) => b.syncedAt - a.syncedAt)
}

export async function listSyncRecords(
  projectIdOrPath: string,
  remoteName?: string,
  branchName?: string,
  fallbackOldPath?: string
): Promise<GitSyncRecord[]> {
  const store = await readStore()
  const id = resolveSyncIdentity(projectIdOrPath)

  // 如果有 fallbackOldPath 且尚未迁移，先迁移
  if (fallbackOldPath && projectIdOrPath.startsWith("proj_")) {
    const oldPrefix = `${hashString(fallbackOldPath)}:`
    const hasOld = Object.keys(store).some((k) => k.startsWith(oldPrefix))
    if (hasOld) {
      await migrateSyncHistory(fallbackOldPath, projectIdOrPath)
      return collectSyncRecords(await readStore(), id, remoteName, branchName)
    }
  }

  return collectSyncRecords(store, id, remoteName, branchName)
}

export async function ensureBaseline(
  projectIdOrPath: string,
  remoteName: string,
  branchName: string,
  targetOid: string
): Promise<GitSyncRecord | null> {
  const store = await readStore()
  const storeKey = key(projectIdOrPath, remoteName, branchName)
  const current = Array.isArray(store[storeKey]) ? store[storeKey] : []
  if (current.length > 0) return null
  const baseline: GitSyncRecord = {
    id: `baseline-${targetOid}`,
    remoteName,
    branchName,
    targetOid,
    syncedAt: Math.floor(Date.now() / 1000),
    commitsUploaded: 0,
    kind: "baseline",
  }
  store[storeKey] = [baseline]
  await writeStore(store)
  return baseline
}

export async function recordSync(projectIdOrPath: string, record: GitSyncRecord): Promise<void> {
  const store = await readStore()
  const storeKey = key(projectIdOrPath, record.remoteName, record.branchName)
  const current = Array.isArray(store[storeKey]) ? store[storeKey] : []
  const existingIndex = current.findIndex((item) => item.targetOid === record.targetOid)
  if (existingIndex >= 0) current[existingIndex] = record
  else current.push(record)
  store[storeKey] = current.sort((a, b) => b.syncedAt - a.syncedAt)
  await writeStore(store)
}
