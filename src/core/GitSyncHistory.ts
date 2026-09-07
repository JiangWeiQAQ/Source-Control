import { GitSyncRecord } from "./types"
import { hashString } from "./identity/hash"
import { JsonStore } from "./storage/JsonStore"

export { hashString } from "./identity/hash"

const SYNC_HISTORY_DIR = `${FileManager.appGroupDocumentsDirectory}/source-control-sync-history`
const SYNC_HISTORY_FILE = `${SYNC_HISTORY_DIR}/records.json`

type SyncHistoryStore = Record<string, GitSyncRecord[]>

let syncHistoryLock: Promise<void> = Promise.resolve()

async function withSyncHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = syncHistoryLock
  let release: () => void = () => undefined
  syncHistoryLock = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

export function resolveSyncIdentity(projectIdOrPath: string): string {
  if (projectIdOrPath.startsWith("proj_")) {
    return projectIdOrPath
  }
  return hashString(projectIdOrPath)
}

function key(projectIdOrPath: string, remoteName: string, branchName: string): string {
  return `${resolveSyncIdentity(projectIdOrPath)}:${remoteName}:${branchName}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isGitSyncRecord(value: unknown): value is GitSyncRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.remoteName) || !isNonEmptyString(record.branchName)) return false
  if (!isNonEmptyString(record.targetOid)) return false
  if (record.previousRemoteOid !== undefined && typeof record.previousRemoteOid !== "string") return false
  if (typeof record.syncedAt !== "number" || !Number.isFinite(record.syncedAt)) return false
  if (typeof record.commitsUploaded !== "number" || !Number.isFinite(record.commitsUploaded) || record.commitsUploaded < 0) return false
  if (record.kind !== undefined && record.kind !== "push" && record.kind !== "baseline" && record.kind !== "force-push") return false
  return true
}

function validateStore(value: unknown): SyncHistoryStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sync history root must be a JSON object")
  }

  const store: SyncHistoryStore = {}
  for (const [storeKey, bucket] of Object.entries(value)) {
    if (!Array.isArray(bucket)) {
      console.warn(`[GitSyncHistory] Skipping invalid bucket: ${storeKey}`)
      continue
    }
    const validRecords: GitSyncRecord[] = []
    for (const record of bucket) {
      if (isGitSyncRecord(record)) validRecords.push(record)
      else console.warn(`[GitSyncHistory] Skipping invalid record in bucket: ${storeKey}`)
    }
    store[storeKey] = validRecords
  }
  return store
}

async function readStore(): Promise<SyncHistoryStore> {
  if (!(await FileManager.exists(SYNC_HISTORY_FILE))) return {}
  return validateStore(await JsonStore.readStrict<unknown>(SYNC_HISTORY_FILE))
}

async function writeStore(store: SyncHistoryStore): Promise<void> {
  await JsonStore.writeAtomic(SYNC_HISTORY_FILE, store)
}

async function migrateSyncHistoryLocked(oldPath: string, projectId: string): Promise<void> {
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
      const mergedMap = new Map<string, GitSyncRecord>()
      for (const record of [...existing, ...oldRecords]) mergedMap.set(record.targetOid, record)
      store[newKey] = Array.from(mergedMap.values()).sort((a, b) => b.syncedAt - a.syncedAt)
      delete store[storeKey]
      changed = true
    }
  }

  if (changed) await writeStore(store)
}

/** 迁移特定旧路径的同步历史到稳定的 projectId。 */
export async function migrateSyncHistory(oldPath: string, projectId: string): Promise<void> {
  await withSyncHistoryLock(() => migrateSyncHistoryLocked(oldPath, projectId))
}

function collectSyncRecords(store: SyncHistoryStore, id: string, remoteName?: string, branchName?: string): GitSyncRecord[] {
  const records: GitSyncRecord[] = []
  for (const [storeKey, values] of Object.entries(store)) {
    if (!storeKey.startsWith(`${id}:`)) continue
    if (remoteName && !storeKey.startsWith(`${id}:${remoteName}:`)) continue
    if (branchName && !storeKey.endsWith(`:${branchName}`)) continue
    records.push(...values)
  }
  return records.sort((a, b) => b.syncedAt - a.syncedAt)
}

export async function listSyncRecords(
  projectIdOrPath: string,
  remoteName?: string,
  branchName?: string,
  fallbackOldPath?: string
): Promise<GitSyncRecord[]> {
  return withSyncHistoryLock(async () => {
    const store = await readStore()
    const id = resolveSyncIdentity(projectIdOrPath)
    if (fallbackOldPath && projectIdOrPath.startsWith("proj_")) {
      const oldPrefix = `${hashString(fallbackOldPath)}:`
      if (Object.keys(store).some((storeKey) => storeKey.startsWith(oldPrefix))) {
        await migrateSyncHistoryLocked(fallbackOldPath, projectIdOrPath)
        return collectSyncRecords(await readStore(), id, remoteName, branchName)
      }
    }
    return collectSyncRecords(store, id, remoteName, branchName)
  })
}

export async function ensureBaseline(
  projectIdOrPath: string,
  remoteName: string,
  branchName: string,
  targetOid: string
): Promise<GitSyncRecord | null> {
  return withSyncHistoryLock(async () => {
    const store = await readStore()
    const storeKey = key(projectIdOrPath, remoteName, branchName)
    const current = store[storeKey] || []
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
  })
}

export async function recordSync(projectIdOrPath: string, record: GitSyncRecord): Promise<void> {
  if (!isGitSyncRecord(record)) throw new Error("Invalid GitSyncRecord")
  await withSyncHistoryLock(async () => {
    const store = await readStore()
    const storeKey = key(projectIdOrPath, record.remoteName, record.branchName)
    const current = store[storeKey] || []
    const existingIndex = current.findIndex((item) => item.targetOid === record.targetOid)
    if (existingIndex >= 0) current[existingIndex] = record
    else current.push(record)
    store[storeKey] = current.sort((a, b) => b.syncedAt - a.syncedAt)
    await writeStore(store)
  })
}
