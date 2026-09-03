/**
 * types.ts
 * Git Core 基础层类型定义
 */

/** 工作区/暂存区中单个文件的综合状态分类 */
export type GitFileStatus =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "staged"
  | "unstaged"
  | "conflict"
  | "unknown"

/** 工作区具体状态 */
export type GitWorktreeStatus =
  | "absent"
  | "unmodified"
  | "modified"
  | "deleted"
  | "untracked"

/** 暂存区 (Index) 相对于 HEAD 的状态 */
export type GitIndexStatus =
  | "absent"
  | "unmodified"
  | "added"
  | "modified"
  | "deleted"

/** 统一的 Change 变更数据模型 */
export interface GitChange {
  /** 仓库内相对路径，例如 "src/index.ts" */
  filepath: string
  /** 综合状态分类，供 UI 快速展示与过滤 */
  status: GitFileStatus
  /** 是否存在暂存内容 (stage !== 0 且与 HEAD 或 worktree 状态相关) */
  staged: boolean
  /** 工作区物理文件状态 */
  worktreeStatus: GitWorktreeStatus
  /** 暂存区 Index 状态 */
  indexStatus: GitIndexStatus
  /** 状态矩阵原始标记，如 [1, 2, 2] */
  matrix?: [number, number, number]
}

export interface GitRemoteInfo {
  name: string
  url: string
}

export interface GitPullResult {
  remote: string
  branch: string
  pulled: boolean
  localOidBefore: string
  localOidAfter: string
  remoteOid: string
}

export interface GitPushResult {
  remote: string
  branch: string
  pushed: boolean
  localOid: string
  remoteOidBefore: string | null
  remoteOidAfter: string | null
}

export interface GitSyncRecord {
  id: string
  remoteName: string
  branchName: string
  targetOid: string
  previousRemoteOid?: string
  syncedAt: number
  commitsUploaded: number
  kind?: "push" | "baseline"
}
export interface GitAheadBehind {
  localBranch: string
  remote: string
  remoteBranch: string
  localOid: string | null
  remoteOid: string | null
  ahead: number
  behind: number
  diverged: boolean
}

export interface GitRemoteBranch {
  remote: string
  name: string
  ref: string
  oid: string
}

export interface GitRemoteCredential {
  username: string
  password: string
}

export interface GitRepositoryStatus {
  /** 当前分支名，如 "main" 或 "master" 或 "detached" */
  currentBranch?: string
  /** 变更文件列表 */
  changes: GitChange[]
  /** 已暂存文件列表 */
  stagedChanges: GitChange[]
  /** 未暂存文件列表（包含 untracked） */
  unstagedChanges: GitChange[]
  /** 是否为干净的工作区（无任何变更） */
  isClean: boolean
}

/** Commit 调用成功后的摘要。 */
export interface GitCommitResult {
  oid: string
  shortOid: string
  message: string
}

export interface GitSafetySnapshotResult {
  created: boolean
  oid?: string
  shortOid?: string
  message?: string
  /** 独立 Snapshot ref；仅在实际创建快照时提供。 */
  ref?: string
}

export interface GitSafetySnapshotRestoreResult {
  restored: boolean
  ref: string
  snapshotOid: string
  changedFiles: number
}

/** 将历史 Commit Tree 非破坏性应用为未暂存 Working Tree 变更的结果。 */
export interface GitCommitWorkingTreeRestoreResult {
  restored: boolean
  oid: string
  shortOid: string
  changedFiles: number
}

export interface GitBranchResetResult {
  reset: boolean
  fromOid: string
  toOid: string
  shortOid: string
}

export interface GitSafetySnapshotInfo {
  ref: string
  oid: string
  shortOid: string
  message: string
  reason: string
  timestamp: number
  parentOid: string
}

export interface GitCommitInfo {
  oid: string
  shortOid: string
  message: string
  authorName: string
  authorEmail: string
  timestamp: number
  parentOids: string[]
}

/** Commit 中单个文件相对首个 parent 的变更类型。 */
export interface GitCommitChangedFile {
  filepath: string
  changeType: "added" | "modified" | "deleted"
}

/** 单个 Commit 的完整审查数据。 */
export interface GitCommitDetail {
  oid: string
  shortOid: string
  message: string
  author: GitAuthor
  timestamp: number
  parents: string[]
  changedFiles: GitCommitChangedFile[]
}

/** 基础作者/提交者身份 */
export interface GitAuthor {
  name: string
  email: string
}

export interface GitDiffLine {
  kind: "context" | "addition" | "deletion"
  text: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}

export interface GitDiffResult {
  filepath: string
  comparison: "unstaged" | "staged"
  oldText: string | null
  newText: string | null
  additions: number
  deletions: number
  isBinary: boolean
  isTooLarge: boolean
  message: string | null
  hunks: GitDiffHunk[]
}

export interface IsomorphicGitHttpClient {
  request(options: {
    url: string
    method: string
    headers: Record<string, string>
    body?: AsyncIterable<Uint8Array>
  }): Promise<{
    url: string
    method: string
    statusCode: number
    statusMessage: string
    headers: Record<string, string>
    body: AsyncIterable<Uint8Array>
  }>
}

export interface IsomorphicGitAdapter {
  init(options: { fs: unknown; dir: string; gitdir?: string; defaultBranch?: string; bare?: boolean }): Promise<void>
  statusMatrix(options: { fs: unknown; dir: string; gitdir: string; filepaths?: string[]; filter?: (filepath: string) => boolean }): Promise<Array<[string, number, number, number]>>
  add(options: { fs: unknown; dir: string; gitdir: string; filepath: string }): Promise<void>
  remove(options: { fs: unknown; dir: string; gitdir: string; filepath: string }): Promise<void>
  resetIndex(options: { fs: unknown; dir: string; gitdir: string; filepath: string; ref?: string }): Promise<void>
  commit(options: { fs: unknown; dir: string; gitdir: string; message: string; author?: GitAuthor; committer?: GitAuthor; tree?: string; parent?: string[] }): Promise<string>
  log(options: { fs: unknown; dir: string; gitdir: string; depth?: number; ref?: string }): Promise<Array<{
    oid: string
    commit: {
      message: string
      parent: string[]
      tree: string
      author: { name: string; email: string; timestamp: number; timezoneOffset: number }
      committer: { name: string; email: string; timestamp: number; timezoneOffset: number }
    }
  }>>
  readCommit(options: { fs: unknown; dir: string; gitdir: string; oid: string }): Promise<{
    oid: string
    commit: {
      message: string
      tree: string
      parent: string[]
      author: { name: string; email: string; timestamp: number; timezoneOffset: number }
    }
  }>
  readTree(options: { fs: unknown; dir: string; gitdir: string; oid: string; filepath?: string }): Promise<{ tree: Array<{ mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" }> }>
  walk(options: {
    fs: unknown
    dir: string
    gitdir: string
    trees: unknown[]
    map: (filepath: string, entries: Array<{ type: () => Promise<string>; oid: () => Promise<string> }>) => Promise<unknown>
  }): Promise<unknown>
  STAGE: () => unknown
  writeBlob(options: { fs: unknown; dir: string; gitdir: string; blob: Uint8Array }): Promise<string>
  writeCommit(options: {
    fs: unknown
    dir: string
    gitdir: string
    commit: {
      message: string
      tree: string
      parent: string[]
      author: GitAuthor & { timestamp?: number; timezoneOffset?: number }
      committer?: GitAuthor & { timestamp?: number; timezoneOffset?: number }
    }
  }): Promise<string>
  writeRef(options: { fs: unknown; dir: string; gitdir: string; ref: string; value: string; force?: boolean; symbolic?: boolean }): Promise<void>
  updateIndex(options: { fs: unknown; dir: string; gitdir: string; filepath: string; oid?: string; mode?: string; add?: boolean; remove?: boolean; force?: boolean }): Promise<string | void>
  writeTree(options: { fs: unknown; dir: string; gitdir: string; tree: Array<{ mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" }> }): Promise<string>
  checkout(options: { fs: unknown; dir: string; gitdir: string; filepaths?: string[]; ref?: string; force?: boolean }): Promise<void>
  currentBranch(options: { fs: unknown; dir: string; gitdir: string; fullname?: boolean }): Promise<string | undefined>
  listRefs(options: { fs: unknown; dir: string; gitdir: string; filepath: string }): Promise<string[]>
  listServerRefs(options: { http: IsomorphicGitHttpClient; url: string; prefix?: string }): Promise<Array<{ ref: string; oid: string }>>
  resolveRef(options: { fs: unknown; dir: string; gitdir: string; ref: string }): Promise<string>
  readBlob(options: { fs: unknown; dir: string; gitdir: string; oid: string; filepath: string }): Promise<{ oid: string; blob: Uint8Array }>
  readObject(options: { fs: unknown; dir: string; gitdir: string; oid: string; format?: "parsed" | "content" }): Promise<{ oid: string; type: string; object: Uint8Array }>
  getConfig(options: { fs: unknown; dir: string; gitdir: string; path: string }): Promise<string | undefined>
  fetch(options: { fs: unknown; dir: string; gitdir: string; remote: string; http: IsomorphicGitHttpClient; singleBranch?: boolean; onAuth?: () => { username: string; password: string } | void }): Promise<void>
  push(options: { fs: unknown; dir: string; gitdir: string; remote: string; ref: string; remoteRef: string; http: IsomorphicGitHttpClient; force: false; onAuth?: () => { username: string; password: string } | void }): Promise<void>
  listRemotes(options: { fs: unknown; dir: string; gitdir: string }): Promise<Array<{ remote: string; url: string }>>
  addRemote(options: { fs: unknown; dir: string; gitdir: string; remote: string; url: string }): Promise<void>
  deleteRemote(options: { fs: unknown; dir: string; gitdir: string; remote: string }): Promise<void>
  setConfig(options: { fs: unknown; dir: string; gitdir: string; path: string; value: string }): Promise<void>
}

