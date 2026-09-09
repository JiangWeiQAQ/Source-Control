const RELEASE_NOTES_STORAGE_PREFIX = "source-control.release-notes.v1:"
const RELEASE_NOTES_FALLBACK_KEY = `${RELEASE_NOTES_STORAGE_PREFIX}default`

function storageKey(projectPath: string): string {
  const value = projectPath.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return value ? `${RELEASE_NOTES_STORAGE_PREFIX}${value}` : RELEASE_NOTES_FALLBACK_KEY
}

export function getReleaseNotes(projectPath: string): string {
  const value = Storage.get<string>(storageKey(projectPath))
  return typeof value === "string" ? value : ""
}

export function setReleaseNotes(projectPath: string, notes: string): void {
  Storage.set(storageKey(projectPath), notes)
}

export function releaseNotesStorageKey(projectPath: string): string {
  return storageKey(projectPath)
}
