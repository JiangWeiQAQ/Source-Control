import { Path } from "scripting"

export interface ProjectFileEntry {
  name: string
  relativePath: string
  fullPath: string
  directory: string
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "")
}

function isExcludedEntry(name: string, fullPath: string): boolean {
  const normalizedPath = normalizePath(fullPath)
  const gitStorageRoot = normalizePath(Path.join(FileManager.appGroupDocumentsDirectory, "git-repos"))
  if (normalizedPath === gitStorageRoot || normalizedPath.startsWith(`${gitStorageRoot}/`)) return true
  const metadataNames = new Set([".git", ".ds_store", "thumbs.db", "desktop.ini", "__macosx", ".spotlight-v100", ".trashes", ".temporaryitems"])
  if (metadataNames.has(name.toLowerCase()) || name.startsWith("._")) return true
  return false
}

export interface ProjectFileScanResult {
  files: ProjectFileEntry[]
  skippedDirectories: string[]
  hasPartialFailure: boolean
}

export interface ProjectFileScanReader {
  readDirectory(path: string): Promise<string[]>
  isDirectory(path: string): Promise<boolean>
}

const fileManagerScanReader: ProjectFileScanReader = {
  readDirectory: (path) => FileManager.readDirectory(path),
  isDirectory: (path) => FileManager.isDirectory(path),
}

export const PROJECT_FILE_SCAN_CONCURRENCY = 12

interface ProjectFileScanTask {
  currentPath: string
  relativeDirectory: string
}

export async function enumerateProjectFiles(projectPath: string): Promise<ProjectFileScanResult> {
  return enumerateProjectFilesWithReader(projectPath, fileManagerScanReader)
}

export async function enumerateProjectFilesWithReader(projectPath: string, reader: ProjectFileScanReader): Promise<ProjectFileScanResult> {
  const files: ProjectFileEntry[] = []
  const skippedDirectories = new Set<string>()
  const queue: ProjectFileScanTask[] = [{ currentPath: projectPath, relativeDirectory: "" }]
  const waiters: Array<() => void> = []
  let queueCursor = 0
  let pendingTasks = 1

  const wakeWorker = () => {
    waiters.shift()?.()
  }

  const wakeAllWorkers = () => {
    while (waiters.length > 0) waiters.shift()?.()
  }

  const enqueue = (task: ProjectFileScanTask) => {
    pendingTasks += 1
    queue.push(task)
    wakeWorker()
  }

  const takeTask = async (): Promise<ProjectFileScanTask | null> => {
    while (queueCursor >= queue.length && pendingTasks > 0) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
    if (queueCursor >= queue.length) return null
    return queue[queueCursor++]
  }

  const processTask = async ({ currentPath, relativeDirectory }: ProjectFileScanTask): Promise<void> => {
    let entries: string[]
    try {
      entries = await reader.readDirectory(currentPath)
    } catch {
      skippedDirectories.add(normalizePath(currentPath))
      console.error("[AllFiles] read failed")
      return
    }

    for (const entry of entries) {
      const fullPath = Path.join(currentPath, entry)
      if (isExcludedEntry(entry, fullPath)) continue

      const relativePath = relativeDirectory ? Path.join(relativeDirectory, entry) : entry
      try {
        if (await reader.isDirectory(fullPath)) {
          enqueue({ currentPath: fullPath, relativeDirectory: relativePath })
          continue
        }
      } catch {
        skippedDirectories.add(normalizePath(fullPath))
        console.error("[AllFiles] read failed")
        continue
      }

      files.push({
        name: entry,
        relativePath,
        fullPath,
        directory: relativeDirectory || "ROOT",
      })
    }
  }

  const worker = async (): Promise<void> => {
    while (true) {
      const task = await takeTask()
      if (task === null) return
      try {
        await processTask(task)
      } finally {
        pendingTasks -= 1
        if (pendingTasks === 0) wakeAllWorkers()
        else wakeWorker()
      }
    }
  }

  await Promise.all(Array.from({ length: PROJECT_FILE_SCAN_CONCURRENCY }, () => worker()))
  return {
    files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    skippedDirectories: Array.from(skippedDirectories).sort((a, b) => a.localeCompare(b)),
    hasPartialFailure: skippedDirectories.size > 0,
  }
}
