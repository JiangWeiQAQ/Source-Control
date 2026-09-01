import { GitDiffLine, GitDiffResult, IsomorphicGitAdapter } from "./types"
import { GitSafety, GitSafetyError } from "./GitSafety"

export const GIT_DIFF_MAX_BYTES = 512 * 1024
export const GIT_DIFF_MAX_LINES = 2_000

interface GitDiffSource {
  bytes: Uint8Array | null
  label: "HEAD" | "INDEX" | "WORKTREE" | "EMPTY"
}

export class GitDiff {
  constructor(
    private readonly projectPath: string,
    private readonly gitdir: string,
    private readonly git: IsomorphicGitAdapter,
    private readonly fs: unknown,
  ) {}

  async getFileDiff(filepath: string, comparison: "unstaged" | "staged"): Promise<GitDiffResult> {
    const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
    if (cleanPath === ".") {
      throw new GitSafetyError("Diff 必须指定单个文件", "INVALID_DIFF_PATH", { filepath })
    }

    const row = await this.getStatusRow(cleanPath)
    if (!row) {
      throw new GitSafetyError(`文件没有可显示的变更: "${cleanPath}"`, "NO_FILE_CHANGE", { filepath: cleanPath })
    }
    if (row[1] === 1 && row[2] === 1 && row[3] === 1) {
      return {
        filepath: cleanPath,
        comparison,
        oldText: null,
        newText: null,
        additions: 0,
        deletions: 0,
        isBinary: false,
        isTooLarge: false,
        message: null,
        hunks: [],
      }
    }

    const [_, head, worktree, index] = row
    const indexSource = await this.readIndexSource(cleanPath, index)
    const headSource = await this.readHeadSource(cleanPath, head)
    const worktreeSource = await this.readWorktreeSource(cleanPath, worktree)
    const oldSource = comparison === "staged" ? headSource : indexSource
    const newSource = comparison === "staged" ? indexSource : worktreeSource

    if (this.isTooLarge(oldSource.bytes) || this.isTooLarge(newSource.bytes)) {
      return this.toProtectedResult(cleanPath, comparison, "File is too large to display diff.")
    }
    if (this.isBinary(oldSource.bytes) || this.isBinary(newSource.bytes)) {
      return this.toProtectedResult(cleanPath, comparison, "Binary file cannot be displayed as text.", true)
    }

    const oldText = this.decodeText(oldSource.bytes)
    const newText = this.decodeText(newSource.bytes)
    const oldLines = this.splitLines(oldText)
    const newLines = this.splitLines(newText)
    if (oldLines.length > GIT_DIFF_MAX_LINES || newLines.length > GIT_DIFF_MAX_LINES) {
      return this.toProtectedResult(cleanPath, comparison, "File is too large to display diff.")
    }

    const lines = buildUnifiedLines(oldLines, newLines)
    const additions = lines.filter((line) => line.kind === "addition").length
    const deletions = lines.filter((line) => line.kind === "deletion").length
    return {
      filepath: cleanPath,
      comparison,
      oldText,
      newText,
      additions,
      deletions,
      isBinary: false,
      isTooLarge: false,
      message: null,
      hunks: lines.length === 0 ? [] : [{ header: makeHunkHeader(lines), lines }],
    }
  }

  private async getStatusRow(filepath: string): Promise<[string, number, number, number] | null> {
    const matrix = await this.git.statusMatrix({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepaths: [filepath] })
    return matrix.find((row) => row[0] === filepath) ?? null
  }

  private async readHeadSource(filepath: string, head: number): Promise<GitDiffSource> {
    if (head === 0) return { bytes: null, label: "EMPTY" }
    try {
      const oid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
      return { bytes: (await this.git.readBlob({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid, filepath })).blob, label: "HEAD" }
    } catch {
      return { bytes: null, label: "EMPTY" }
    }
  }

  private async readIndexSource(filepath: string, index: number): Promise<GitDiffSource> {
    if (index === 0) return { bytes: null, label: "EMPTY" }
    if (index === 1) return this.readHeadSource(filepath, 1)
    try {
      const oid = await this.readIndexBlobOid(filepath)
      if (!oid) return { bytes: null, label: "EMPTY" }
      return { bytes: (await this.git.readObject({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid, format: "content" })).object, label: "INDEX" }
    } catch {
      return { bytes: null, label: "EMPTY" }
    }
  }

  private async readIndexBlobOid(filepath: string): Promise<string | null> {
    let oid: string | null = null
    await this.git.walk({
      fs: this.fs,
      dir: this.projectPath,
      gitdir: this.gitdir,
      trees: [this.git.STAGE()],
      map: async (walkPath, [entry]) => {
        if (walkPath !== filepath || !entry) return undefined
        if (await entry.type() !== "blob") return undefined
        oid = await entry.oid()
        return oid
      },
    })
    return oid
  }

  private async readWorktreeSource(filepath: string, worktree: number): Promise<GitDiffSource> {
    if (worktree === 0) return { bytes: null, label: "EMPTY" }
    const fullPath = `${this.projectPath}/${filepath}`
    try {
      return { bytes: await FileManager.readAsBytes(fullPath), label: "WORKTREE" }
    } catch {
      return { bytes: null, label: "EMPTY" }
    }
  }

  private isTooLarge(bytes: Uint8Array | null): boolean {
    return bytes !== null && bytes.length > GIT_DIFF_MAX_BYTES
  }

  private isBinary(bytes: Uint8Array | null): boolean {
    return bytes !== null && bytes.some((byte) => byte === 0)
  }

  private decodeText(bytes: Uint8Array | null): string | null {
    return bytes === null ? null : new TextDecoder("utf-8").decode(bytes).replace(/\r\n/g, "\n")
  }

  private splitLines(text: string | null): string[] {
    if (text === null || text.length === 0) return []
    const lines = text.split("\n")
    if (lines[lines.length - 1] === "") lines.pop()
    return lines
  }

  private toProtectedResult(filepath: string, comparison: "unstaged" | "staged", message: string, isBinary = false): GitDiffResult {
    return { filepath, comparison, oldText: null, newText: null, additions: 0, deletions: 0, isBinary, isTooLarge: !isBinary, message, hunks: [] }
  }
}

function buildUnifiedLines(oldLines: string[], newLines: string[]): GitDiffLine[] {
  const rows = oldLines.length + 1
  const cols = newLines.length + 1
  const table: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1])
    }
  }

  const lines: GitDiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({ kind: "context", text: oldLines[oldIndex], oldLineNumber: ++oldIndex, newLineNumber: ++newIndex })
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
      lines.push({ kind: "addition", text: newLines[newIndex], oldLineNumber: null, newLineNumber: ++newIndex })
    } else {
      lines.push({ kind: "deletion", text: oldLines[oldIndex], oldLineNumber: ++oldIndex, newLineNumber: null })
    }
  }
  return lines
}

function makeHunkHeader(lines: GitDiffLine[]): string {
  const oldNumbers = lines.filter((line) => line.oldLineNumber !== null).map((line) => line.oldLineNumber as number)
  const newNumbers = lines.filter((line) => line.newLineNumber !== null).map((line) => line.newLineNumber as number)
  const oldStart = oldNumbers[0] ?? 0
  const newStart = newNumbers[0] ?? 0
  return `@@ -${oldStart},${oldNumbers.length} +${newStart},${newNumbers.length} @@`
}
