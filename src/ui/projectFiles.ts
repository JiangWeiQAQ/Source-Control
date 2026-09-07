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

export async function enumerateProjectFiles(projectPath: string): Promise<ProjectFileScanResult> {
  return enumerateProjectFilesWithReader(projectPath, fileManagerScanReader)
}

export async function enumerateProjectFilesWithReader(projectPath: string, reader: ProjectFileScanReader): Promise<ProjectFileScanResult> {
  const files: ProjectFileEntry[] = []
  const skippedDirectories = new Set<string>()

  const visit = async (currentPath: string, relativeDirectory: string): Promise<void> => {
    let entries: string[]
    try {
      entries = await reader.readDirectory(currentPath)
    } catch {
      skippedDirectories.add(normalizePath(currentPath))
      console.error("[AllFiles] read failed")
      return
    }

    const results = await Promise.all(entries.map(async (entry): Promise<ProjectFileEntry[]> => {
      const fullPath = Path.join(currentPath, entry)
      if (isExcludedEntry(entry, fullPath)) return []

      const relativePath = relativeDirectory ? Path.join(relativeDirectory, entry) : entry
      try {
        if (await reader.isDirectory(fullPath)) {
          await visit(fullPath, relativePath)
          return []
        }
      } catch {
        skippedDirectories.add(normalizePath(fullPath))
        console.error("[AllFiles] read failed")
        return []
      }

      return [{
        name: entry,
        relativePath,
        fullPath,
        directory: relativeDirectory || "ROOT",
      }]
    }))

    for (const result of results) files.push(...result)
  }

  await visit(projectPath, "")
  return {
    files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    skippedDirectories: Array.from(skippedDirectories).sort((a, b) => a.localeCompare(b)),
    hasPartialFailure: skippedDirectories.size > 0,
  }
}
