import { GitSyncRecord } from "./types"

const SYNC_HISTORY_DIR = `${FileManager.appGroupDocumentsDirectory}/source-control-sync-history`
const SYNC_HISTORY_FILE = `${SYNC_HISTORY_DIR}/records.json`

type SyncHistoryStore = Record<string, GitSyncRecord[]>

function projectId(projectPath: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < projectPath.length; index += 1) {
    const code = projectPath.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`
}

function key(projectPath: string, remoteName: string, branchName: string): string {
  return `${projectId(projectPath)}:${remoteName}:${branchName}`
}

async function readStore(): Promise<SyncHistoryStore> {
  if (!(await FileManager.exists(SYNC_HISTORY_FILE))) return {}
  try {
    const value = JSON.parse(await FileManager.readAsString(SYNC_HISTORY_FILE, "utf8")) as SyncHistoryStore
    return value && typeof value === "object" ? value : {}
  } catch {
    return {}
  }
}

async function writeStore(store: SyncHistoryStore): Promise<void> {
  if (!(await FileManager.exists(SYNC_HISTORY_DIR))) await FileManager.createDirectory(SYNC_HISTORY_DIR, true)
  await FileManager.writeAsString(SYNC_HISTORY_FILE, JSON.stringify(store, null, 2), "utf8")
}

export async function listSyncRecords(projectPath: string, remoteName?: string, branchName?: string): Promise<GitSyncRecord[]> {
  const store = await readStore()
  const records: GitSyncRecord[] = []
  for (const [storeKey, values] of Object.entries(store)) {
    if (!storeKey.startsWith(`${projectId(projectPath)}:`)) continue
    if (remoteName && !storeKey.startsWith(`${projectId(projectPath)}:${remoteName}:`)) continue
    if (branchName && !storeKey.endsWith(`:${branchName}`)) continue
    records.push(...(Array.isArray(values) ? values : []))
  }
  return records.sort((a, b) => b.syncedAt - a.syncedAt)
}

export async function ensureBaseline(projectPath: string, remoteName: string, branchName: string, targetOid: string): Promise<GitSyncRecord | null> {
  const store = await readStore()
  const storeKey = key(projectPath, remoteName, branchName)
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
export async function recordSync(projectPath: string, record: GitSyncRecord): Promise<void> {
  const store = await readStore()
  const storeKey = key(projectPath, record.remoteName, record.branchName)
  const current = Array.isArray(store[storeKey]) ? store[storeKey] : []
  const existingIndex = current.findIndex((item) => item.targetOid === record.targetOid)
  if (existingIndex >= 0) current[existingIndex] = record
  else current.push(record)
  store[storeKey] = current.sort((a, b) => b.syncedAt - a.syncedAt)
  await writeStore(store)
}

