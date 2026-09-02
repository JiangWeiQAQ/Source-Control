/**
 * GitRepository.ts
 * 封装单个 Git 仓库的具体操作，隐藏 isomorphic-git 的低层调用细节
 */

import { GitAheadBehind, GitAuthor, GitBranchResetResult, GitChange, GitCommitChangedFile, GitCommitDetail, GitCommitInfo, GitCommitResult, GitCommitWorkingTreeRestoreResult, GitPullResult, GitPushResult, GitRemoteBranch, GitRemoteCredential, GitRemoteInfo, GitRepositoryStatus, GitSafetySnapshotInfo, GitSafetySnapshotRestoreResult, GitSafetySnapshotResult, IsomorphicGitAdapter, IsomorphicGitHttpClient } from "./types"
import { GitStatus } from "./GitStatus"
import { GitSafety, GitSafetyError } from "./GitSafety"
import { GitDiff } from "./GitDiff"

declare const fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<{
  url: string
  status: number
  statusText: string
  headers: { entries(): IterableIterator<[string, string]> }
  body: AsyncIterable<Uint8Array>
}>

async function requestBodyBytes(body?: AsyncIterable<Uint8Array>): Promise<Uint8Array | undefined> {
  if (!body) return undefined
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of body) {
    chunks.push(chunk)
    length += chunk.length
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function compareTreeFiles(previous: Map<string, string>, current: Map<string, string>): GitCommitChangedFile[] {
  const filepaths = new Set([...previous.keys(), ...current.keys()])
  return [...filepaths]
    .sort()
    .flatMap((filepath) => {
      const previousOid = previous.get(filepath)
      const currentOid = current.get(filepath)
      if (previousOid === currentOid) return []
      return [{
        filepath,
        changeType: previousOid === undefined ? "added" : currentOid === undefined ? "deleted" : "modified",
      }]
    })
}


const SNAPSHOT_MODE = "100644"

interface RevertOperation {
  filepath: string
  restoreOid: string | null
}

interface SnapshotRestoreOperation {
  filepath: string
  snapshotBytes: Uint8Array | null
  previousExists: boolean
  previousBytes: Uint8Array | null
}

interface CommitWorkingTreeRestoreOperation {
  filepath: string
  targetBytes: Uint8Array | null
  previousExists: boolean
  previousBytes: Uint8Array | null
}

interface CommitRestoreMetadata {
  headOid: string
  headContents: string
  branch: string | null
  branchOid: string | null
  remoteRefs: Map<string, string>
  historyOids: string[]
}

interface BranchResetMetadata {
  headContents: string
  branch: string
  branchRef: string
  branchOid: string
  index: Uint8Array
  workingTree: Map<string, Uint8Array>
  remoteRefs: Map<string, string>
  historyOids: string[]
}

/**
 * 仅在 HEAD 仍精确保留 target 引入后的 blob 时生成反向操作。
 * 若 HEAD 已对同一路径引入不同 blob，拒绝以避免覆盖后续提交内容。
 */
function getSafeRevertOperations(
  parentFiles: Map<string, string>,
  targetFiles: Map<string, string>,
  headFiles: Map<string, string>,
): RevertOperation[] {
  const operations: RevertOperation[] = []
  for (const change of compareTreeFiles(parentFiles, targetFiles)) {
    const parentOid = parentFiles.get(change.filepath) ?? null
    const targetOid = targetFiles.get(change.filepath) ?? null
    const headOid = headFiles.get(change.filepath) ?? null
    if (headOid !== targetOid) {
      throw new GitSafetyError(
        `无法安全 Revert："${change.filepath}" 已在当前 HEAD 中发生后续变化`,
        "REVERT_CONFLICT",
        { filepath: change.filepath },
      )
    }
    operations.push({ filepath: change.filepath, restoreOid: parentOid })
  }
  if (operations.length === 0) {
    throw new GitSafetyError("目标 Commit 没有可 Revert 的文件变更", "NO_REVERTABLE_CHANGES")
  }
  return operations
}

function validateRemoteName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new GitSafetyError("Remote 名称不能为空", "INVALID_REMOTE_NAME")
  }
  const trimmed = name.trim()
  if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new GitSafetyError("Remote 名称格式不合法", "INVALID_REMOTE_NAME")
  }
  return trimmed
}

function validateRemoteUrl(url: string): string {
  if (!url || typeof url !== "string") {
    throw new GitSafetyError("Remote URL 不能为空", "INVALID_REMOTE_URL")
  }
  const trimmed = url.trim()
  if (!trimmed || /[\u0000-\u001f\s]/.test(trimmed)) {
    throw new GitSafetyError("Remote URL 格式不合法", "INVALID_REMOTE_URL")
  }
  return trimmed
}

function validateRemoteCredential(credential: GitRemoteCredential): GitRemoteCredential {
  const username = credential?.username?.trim()
  const password = credential?.password
  if (!username) throw new GitSafetyError("Remote 用户名不能为空", "INVALID_REMOTE_CREDENTIAL")
  if (!password || !password.trim()) throw new GitSafetyError("Remote 密码或 Token 不能为空", "INVALID_REMOTE_CREDENTIAL")
  return { username, password }
}

function repositoryCredentialId(projectPath: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < projectPath.length; index += 1) {
    const code = projectPath.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`
}

function sanitizeRemoteErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^@\s/]+@/gi, "https://***@")
    .replace(/(password|token|authorization)=[^\s&]+/gi, "$1=***")
}

function createFetchHttpClient(): IsomorphicGitHttpClient {
  return {
    async request({ url, method, headers, body }) {
      const response = await fetch(url, {
        method,
        headers,
        body: await requestBodyBytes(body),
      })
      return {
        url: response.url,
        method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: response.body,
      }
    },
  }
}

export class GitRepository {
  private static pullTestHooks: { onRollbackStart?: () => void } | null = null

  static setPullTestHooks(hooks: { onRollbackStart?: () => void } | null): void {
    GitRepository.pullTestHooks = hooks
  }

  readonly projectPath: string
  readonly gitdir: string
  private readonly git: IsomorphicGitAdapter
  private readonly fs: unknown

  constructor(projectPath: string, gitdir: string, git: IsomorphicGitAdapter, fs: unknown) {
    this.projectPath = GitSafety.validateProjectPath(projectPath)
    this.gitdir = gitdir
    this.git = git
    this.fs = fs
  }

  private credentialKey(remoteName: string): string {
    return `source-control:remote-credential:v1:${repositoryCredentialId(this.projectPath)}:${remoteName}`
  }

  private async httpsRemote(remoteName: string): Promise<GitRemoteInfo> {
    const remote = (await this.listRemotes()).find((item) => item.name === remoteName)
    if (!remote) throw new GitSafetyError(`Remote 不存在: "${remoteName}"`, "REMOTE_NOT_FOUND", { name: remoteName })
    if (!/^https:\/\//i.test(remote.url)) {
      throw new GitSafetyError("HTTPS credentials are not used for SSH remotes.", "REMOTE_CREDENTIAL_UNSUPPORTED_URL", { name: remoteName })
    }
    return remote
  }

  /** Fetch HTTPS Remote，仅更新 objects 与 remote-tracking refs。 */
  async fetchRemote(name = "origin"): Promise<{ remote: string; branch: string | null; fetched: boolean }> {
    const remoteName = validateRemoteName(name)
    const remote = (await this.listRemotes()).find((item) => item.name === remoteName)
    if (!remote) throw new GitSafetyError(`Remote 不存在: "${remoteName}"`, "REMOTE_NOT_FOUND", { name: remoteName })
    if (!/^https:\/\//i.test(remote.url)) {
      throw new GitSafetyError("SSH remotes are not supported yet.", "FETCH_SSH_UNSUPPORTED", { name: remoteName })
    }
    try {
      const credential = await this.getRemoteCredential(remoteName)
      await this.git.fetch({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        remote: remoteName,
        http: createFetchHttpClient(),
        onAuth: credential ? () => credential : undefined,
      })
      const branches = await this.listRemoteBranches(remoteName)
      return { remote: remoteName, branch: branches[0]?.name ?? null, fetched: true }
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      const message = sanitizeRemoteErrorMessage(error)
      const lower = message.toLowerCase()
      const kind = /auth|401|403|unauthor/i.test(lower) ? "认证失败" : /network|fetch|enotfound|timed out|offline|internet|无法连接服务器|http error/i.test(lower) ? "网络失败" : "Fetch 失败"
      throw new Error(`${kind}: ${message}`)
    }
  }

  /** 仅读取本地 remote-tracking refs，不进行网络访问。 */
  async listRemoteBranches(name = "origin"): Promise<GitRemoteBranch[]> {
    const remote = validateRemoteName(name)
    const prefix = `refs/remotes/${remote}`
    try {
      const suffixes = await this.git.listRefs({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepath: prefix })
      const branches: GitRemoteBranch[] = []
      for (const suffix of suffixes) {
        if (suffix === "HEAD" || suffix.endsWith("/HEAD")) continue
        const ref = `${prefix}/${suffix}`
        branches.push({ remote, name: suffix, ref, oid: await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref }) })
      }
      return branches.sort((left, right) => left.name.localeCompare(right.name))
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "读取 Remote Branch"))
    }
  }

  /** 将 HTTPS Remote 凭据写入系统 Keychain，不修改 Git config 或 Remote URL。 */
  async setRemoteCredential(name: string, credential: GitRemoteCredential): Promise<void> {
    const remote = validateRemoteName(name)
    const value = validateRemoteCredential(credential)
    await this.httpsRemote(remote)
    try {
      if (!Keychain.set(this.credentialKey(remote), JSON.stringify(value))) {
        throw new Error("Keychain 写入失败")
      }
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      throw new Error(GitSafety.formatErrorMessage(error, "保存 Remote Credential"))
    }
  }

  /** 仅读取指定 Remote 是否存在已保存的 Keychain Credential。 */
  async hasRemoteCredential(name: string): Promise<boolean> {
    return Keychain.contains(this.credentialKey(validateRemoteName(name)))
  }

  /** 供后续网络操作内部使用；调用方不得记录或展示 password。 */
  async getRemoteCredential(name: string): Promise<GitRemoteCredential | null> {
    const value = Keychain.get(this.credentialKey(validateRemoteName(name)))
    if (value === null) return null
    try {
      const credential = JSON.parse(value) as GitRemoteCredential
      return validateRemoteCredential(credential)
    } catch {
      Keychain.remove(this.credentialKey(validateRemoteName(name)))
      return null
    }
  }

  /** 删除指定 Remote 的 Keychain Credential；不存在时保持幂等。 */
  async removeRemoteCredential(name: string): Promise<void> {
    Keychain.remove(this.credentialKey(validateRemoteName(name)))
  }

  /** 仅读取 repository config 中已配置的 Remote。 */
  async listRemotes(): Promise<GitRemoteInfo[]> {
    try {
      const remotes = await this.git.listRemotes({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir })
      return remotes.map((remote) => ({ name: remote.remote, url: remote.url }))
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "读取 Remote 列表"))
    }
  }

  /** 添加 Remote 配置；不进行任何网络访问。 */
  async addRemote(name: string, url: string): Promise<void> {
    const remote = validateRemoteName(name)
    const remoteUrl = validateRemoteUrl(url)
    try {
      if ((await this.listRemotes()).some((item) => item.name === remote)) {
        throw new GitSafetyError(`Remote 已存在: "${remote}"`, "REMOTE_ALREADY_EXISTS", { name: remote })
      }
      await this.git.addRemote({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, remote, url: remoteUrl })
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      throw new Error(GitSafety.formatErrorMessage(error, "添加 Remote"))
    }
  }

  /** 修改既有 Remote 的 URL；不进行任何网络访问。 */
  async setRemoteUrl(name: string, url: string): Promise<void> {
    const remote = validateRemoteName(name)
    const remoteUrl = validateRemoteUrl(url)
    try {
      if (!(await this.listRemotes()).some((item) => item.name === remote)) {
        throw new GitSafetyError(`Remote 不存在: "${remote}"`, "REMOTE_NOT_FOUND", { name: remote })
      }
      await this.git.setConfig({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, path: `remote.${remote}.url`, value: remoteUrl })
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      throw new Error(GitSafety.formatErrorMessage(error, "修改 Remote URL"))
    }
  }

  /** 删除既有 Remote 配置；不影响分支、提交、Index 或工作区。 */
  async removeRemote(name: string): Promise<void> {
    const remote = validateRemoteName(name)
    try {
      if (!(await this.listRemotes()).some((item) => item.name === remote)) {
        throw new GitSafetyError(`Remote 不存在: "${remote}"`, "REMOTE_NOT_FOUND", { name: remote })
      }
      await this.git.deleteRemote({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, remote })
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      throw new Error(GitSafety.formatErrorMessage(error, "删除 Remote"))
    }
  }

  /** 仅允许 clean working tree 上的 fast-forward Pull；不产生 merge commit。 */
  async pullRemote(remoteName = "origin", branchName?: string): Promise<GitPullResult> {
    const status = await this.getStatus()
    if (!status.isClean) throw new GitSafetyError("Working tree must be clean before pulling.", "PULL_DIRTY_WORKTREE")
    const currentBranch = await this.getCurrentBranch()
    if (!currentBranch) throw new GitSafetyError("Pull requires a local branch.", "PULL_DETACHED_HEAD")
    const branch = branchName?.trim() || currentBranch
    if (!branch) throw new GitSafetyError("Pull requires a local branch.", "PULL_INVALID_BRANCH")
    const remote = validateRemoteName(remoteName)
    await this.fetchRemote(remote)
    let comparison: GitAheadBehind
    try {
      comparison = await this.getAheadBehind(remote, branch)
    } catch (error) {
      if (error instanceof GitSafetyError && error.code === "REMOTE_BRANCH_NOT_FOUND") {
        throw new GitSafetyError(`Remote branch "${remote}/${branch}" does not exist.`, "PULL_REMOTE_BRANCH_NOT_FOUND", { remote, branch })
      }
      throw error
    }
    const remoteOid = comparison.remoteOid
    if (!remoteOid) throw new GitSafetyError(`Remote branch "${remote}/${branch}" does not exist.`, "PULL_REMOTE_BRANCH_NOT_FOUND", { remote, branch })
    if (comparison.ahead === 0 && comparison.behind === 0) {
      if (!comparison.localOid) throw new GitSafetyError("Cannot pull into an unborn branch without a remote commit.", "PULL_UNBORN_INVALID")
      return { remote, branch, pulled: false, localOidBefore: comparison.localOid, localOidAfter: comparison.localOid, remoteOid }
    }
    if (comparison.diverged) throw new GitSafetyError("Local and remote branches have diverged.", "PULL_DIVERGED", { remote, branch })
    if (comparison.ahead > 0) throw new GitSafetyError("Local branch is ahead. Push or resolve before pulling.", "PULL_LOCAL_AHEAD", { remote, branch })
    if (comparison.behind <= 0 || comparison.localOid !== null) {
      if (comparison.behind <= 0) throw new GitSafetyError("Pull requires the remote branch to be ahead.", "PULL_NOT_FAST_FORWARD")
    }
    const localRef = `refs/heads/${branch}`
    const remoteRef = `refs/remotes/${remote}/${branch}`
    const oldHead = await FileManager.readAsString(`${this.gitdir}/HEAD`, "utf8")
    const oldWorkingTree = await this.capturePullWorkingTree()
    const oldIndex = await FileManager.exists(`${this.gitdir}/index`) ? await FileManager.readAsBytes(`${this.gitdir}/index`) : new Uint8Array()
    const targetCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: remoteOid })
    const targetFiles = await this.readTreeContent(targetCommit.commit.tree)
    await this.preflightPullTarget(targetFiles)
    try {
      await this.git.checkout({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: remoteRef, force: false })
      await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: localRef, value: remoteOid, force: true })
      await FileManager.writeAsString(`${this.gitdir}/HEAD`, `ref: ${localRef}\n`, "utf8")
      return { remote, branch, pulled: true, localOidBefore: comparison.localOid || "", localOidAfter: remoteOid, remoteOid }
    } catch (applyError) {
      try {
        await this.restorePullWorkingTree(oldWorkingTree, targetFiles)
        if (oldIndex.length > 0) {
          await FileManager.writeAsBytes(`${this.gitdir}/index`, oldIndex)
        } else if (await FileManager.exists(`${this.gitdir}/index`)) {
          await FileManager.remove(`${this.gitdir}/index`)
        }
        await FileManager.writeAsString(`${this.gitdir}/HEAD`, oldHead, "utf8")
      } catch (rollbackError) {
        throw new Error(`Pull failed and rollback was incomplete. Repository requires manual inspection. Original error: ${sanitizeRemoteErrorMessage(applyError)}; rollback error: ${sanitizeRemoteErrorMessage(rollbackError)}`)
      }
      throw new Error(GitSafety.formatErrorMessage(applyError, "Fast-forward Pull"))
    }
  }

  private async capturePullWorkingTree(): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>()
    const matrix = await this.git.statusMatrix({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir })
    for (const [filepath] of matrix) {
      const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
      const fullPath = `${this.projectPath}/${cleanPath}`
      if (await FileManager.exists(fullPath) && !(await FileManager.isDirectory(fullPath))) {
        files.set(cleanPath, await FileManager.readAsBytes(fullPath))
      }
    }
    return files
  }

  private async restorePullWorkingTree(files: Map<string, Uint8Array>, targetFiles: Map<string, Uint8Array>): Promise<void> {
    GitRepository.pullTestHooks?.onRollbackStart?.()
    const paths = new Set([...files.keys(), ...targetFiles.keys()])
    for (const filepath of [...paths].sort((left, right) => right.length - left.length)) {
      const fullPath = `${this.projectPath}/${filepath}`
      if (await FileManager.exists(fullPath) && !(await FileManager.isDirectory(fullPath))) await FileManager.remove(fullPath)
    }
    for (const [filepath, bytes] of [...files.entries()].sort(([left], [right]) => left.length - right.length)) {
      const fullPath = `${this.projectPath}/${filepath}`
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
      if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
      await FileManager.writeAsBytes(fullPath, bytes)
    }
  }
  private async preflightPullTarget(targetFiles: Map<string, Uint8Array>): Promise<void> {
    for (const filepath of targetFiles.keys()) {
      const segments = filepath.split("/")
      for (let index = 1; index <= segments.length; index += 1) {
        const candidate = `${this.projectPath}/${segments.slice(0, index).join("/")}`
        if (!(await FileManager.exists(candidate))) continue
        const needsDirectory = index < segments.length
        if (needsDirectory && !(await FileManager.isDirectory(candidate))) {
          throw new GitSafetyError(`Pull path conflict: "${segments.slice(0, index).join("/")}" is a file but the remote requires a directory.`, "PULL_PATH_CONFLICT", { filepath })
        }
        if (!needsDirectory && await FileManager.isDirectory(candidate)) {
          throw new GitSafetyError(`Pull path conflict: "${filepath}" is a directory but the remote requires a file.`, "PULL_PATH_CONFLICT", { filepath })
        }
      }
    }
  }

  /** 仅执行 fast-forward HTTPS Push，不会 Force、Fetch、Merge 或修改工作区。 */
  async pushRemote(remoteName = "origin", branchName?: string): Promise<GitPushResult> {
    const remote = validateRemoteName(remoteName)
    const remoteInfo = (await this.listRemotes()).find((item) => item.name === remote)
    if (!remoteInfo) throw new GitSafetyError(`Remote 不存在: "${remote}"`, "REMOTE_NOT_FOUND", { name: remote })
    if (!/^https:\/\//i.test(remoteInfo.url)) {
      throw new GitSafetyError("SSH remotes are not supported yet.", "PUSH_SSH_UNSUPPORTED", { name: remote })
    }
    const branch = branchName?.trim() || await this.getCurrentBranch()
    if (!branch) throw new GitSafetyError("Push requires a local branch.", "PUSH_DETACHED_HEAD")
    const localRef = `refs/heads/${branch}`
    let localOid: string
    try {
      localOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: localRef })
    } catch {
      throw new GitSafetyError("Cannot push an unborn branch.", "PUSH_UNBORN_BRANCH", { branch })
    }
    const remoteRef = `refs/remotes/${remote}/${branch}`
    let remoteOidBefore: string | null = null
    try {
      remoteOidBefore = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: remoteRef })
    } catch {
      remoteOidBefore = null
    }
    if (remoteOidBefore === null) {
      try {
        const serverRefs = await this.git.listServerRefs({ http: createFetchHttpClient(), url: remoteInfo.url, prefix: `refs/heads/${branch}` })
        if (serverRefs.some((item) => item.ref === `refs/heads/${branch}`)) {
          throw new GitSafetyError(`Remote branch "${remote}/${branch}" is available on the server but has not been fetched. Fetch before pushing.`, "PUSH_REMOTE_BRANCH_NOT_FETCHED", { remote, branch })
        }
      } catch (error) {
        if (error instanceof GitSafetyError) throw error
        const message = sanitizeRemoteErrorMessage(error)
        const lower = message.toLowerCase()
        const kind = /auth|401|403|unauthor|permission denied|forbidden/i.test(lower) ? "Authentication or authorization failed" : /network|fetch|enotfound|timed out|offline|internet|无法连接服务器|http error/i.test(lower) ? "Network failed" : "Push failed"
        throw new Error(`${kind}: ${message}`)
      }
    }
    if (remoteOidBefore !== null) {
      const comparison = await this.getAheadBehind(remote, branch)
      if (comparison.ahead === 0 && comparison.behind === 0) {
        return { remote, branch, pushed: false, localOid, remoteOidBefore, remoteOidAfter: remoteOidBefore }
      }
      if (comparison.diverged) throw new GitSafetyError("Push rejected because local and remote branches have diverged.", "PUSH_DIVERGED", { remote, branch })
      if (comparison.behind > 0) throw new GitSafetyError("Push rejected because the remote branch is ahead. Fetch before pushing again.", "PUSH_REMOTE_AHEAD", { remote, branch })
      if (comparison.ahead === 0) return { remote, branch, pushed: false, localOid, remoteOidBefore, remoteOidAfter: remoteOidBefore }
    }
    try {
      const credential = await this.getRemoteCredential(remote)
      await this.git.push({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        remote,
        ref: localRef,
        remoteRef: localRef,
        http: createFetchHttpClient(),
        force: false,
        onAuth: credential ? () => credential : undefined,
      })
      await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: remoteRef, value: localOid, force: true })
      return { remote, branch, pushed: true, localOid, remoteOidBefore, remoteOidAfter: localOid }
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      const message = sanitizeRemoteErrorMessage(error)
      const lower = message.toLowerCase()
      const kind = /non-fast-forward|fast forward|remote.*changed|rejected/i.test(lower)
        ? "Remote changed. Fetch before pushing again."
        : /auth|401|403|unauthor|permission denied|forbidden/i.test(lower)
          ? "Authentication or authorization failed"
          : /network|fetch|enotfound|timed out|offline|internet|无法连接服务器|http error/i.test(lower)
            ? "Network failed"
            : "Push failed"
      throw new Error(`${kind}: ${message}`)
    }
  }

  /** 仅基于本地 commit graph 与 remote-tracking ref 计算 ahead/behind，不联网。 */
  async getAheadBehind(remoteName = "origin", branchName?: string): Promise<GitAheadBehind> {
    const remote = validateRemoteName(remoteName)
    if (!(await this.listRemotes()).some((item) => item.name === remote)) {
      throw new GitSafetyError(`Remote 不存在: "${remote}"`, "REMOTE_NOT_FOUND", { name: remote })
    }
    const localBranch = branchName?.trim() || await this.getCurrentBranch()
    if (!localBranch) throw new GitSafetyError("Ahead/behind requires a local branch.", "AHEAD_BEHIND_DETACHED_HEAD")
    const remoteRef = `refs/remotes/${remote}/${localBranch}`
    let remoteOid: string
    try {
      remoteOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: remoteRef })
    } catch {
      throw new GitSafetyError(`Remote branch "${remote}/${localBranch}" is not available. Fetch the remote first or verify the branch name.`, "REMOTE_BRANCH_NOT_FOUND", { remote, branch: localBranch })
    }
    let localOid: string | null = null
    try {
      localOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: `refs/heads/${localBranch}` })
    } catch {
      if (!await this.hasUnbornHead()) throw new Error("读取本地分支失败")
    }
    const reachable = async (start: string | null): Promise<Set<string>> => {
      const commits = new Set<string>()
      const pending = start ? [start] : []
      while (pending.length > 0) {
        const oid = pending.pop()!
        if (commits.has(oid)) continue
        if (commits.size >= 10000) throw new GitSafetyError("Commit history is too deep to calculate ahead/behind safely.", "AHEAD_BEHIND_HISTORY_TOO_DEEP")
        commits.add(oid)
        const commit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid })
        pending.push(...commit.commit.parent)
      }
      return commits
    }
    try {
      const [localCommits, remoteCommits] = await Promise.all([reachable(localOid), reachable(remoteOid)])
      const ahead = [...localCommits].filter((oid) => !remoteCommits.has(oid)).length
      const behind = [...remoteCommits].filter((oid) => !localCommits.has(oid)).length
      return { localBranch, remote, remoteBranch: localBranch, localOid, remoteOid, ahead, behind, diverged: ahead > 0 && behind > 0 }
    } catch (error) {
      if (error instanceof GitSafetyError) throw error
      throw new Error(GitSafety.formatErrorMessage(error, "计算 Ahead/Behind"))
    }
  }

  /** 返回当前分支；unborn branch 返回 HEAD 指向的分支名，detached HEAD 返回 null。 */
  async getCurrentBranch(): Promise<string | null> {
    try {
      return await this.git.currentBranch({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, fullname: false }) || null
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "读取当前分支"))
    }
  }

  /** 获取仓库当前分支及全部文件状态 */
  async getStatus(): Promise<GitRepositoryStatus> {
    try {
      let currentBranch: string | undefined
      try {
        currentBranch = await this.git.currentBranch({
          fs: this.fs,
          dir: this.projectPath,
          gitdir: this.gitdir,
          fullname: false,
        })
      } catch {
        currentBranch = undefined
      }

      const matrix = await this.git.statusMatrix({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
      })

      const allChanges = GitStatus.parseMatrix(matrix)
      const stagedChanges: GitChange[] = []
      const unstagedChanges: GitChange[] = []

      for (const change of allChanges) {
        if (change.staged) {
          stagedChanges.push(change)
        }
        // 如果工作区有未暂存修改或未跟踪文件，归入 unstaged
        if (
          change.worktreeStatus === "modified" ||
          change.worktreeStatus === "deleted" ||
          change.worktreeStatus === "untracked" ||
          !change.staged
        ) {
          unstagedChanges.push(change)
        }
      }

      return {
        currentBranch,
        changes: allChanges,
        stagedChanges,
        unstagedChanges,
        isClean: allChanges.length === 0,
      }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "获取仓库状态")
      throw new Error(formatted)
    }
  }

  /** 暂存单个文件 */
  async stageFile(filepath: string): Promise<void> {
    const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
    try {
      const fullPath = this.projectPath + "/" + cleanPath
      const exists = await FileManager.exists(fullPath)

      if (!exists) {
        // 工作区文件已删除，使用 remove 暂存删除状态
        try {
          await this.git.remove({
            fs: this.fs,
            dir: this.projectPath,
            gitdir: this.gitdir,
            filepath: cleanPath,
          })
          return
        } catch {
          // 如果 remove 失败再回退到 add
          await this.git.add({
            fs: this.fs,
            dir: this.projectPath,
            gitdir: this.gitdir,
            filepath: cleanPath,
          })
          return
        }
      }

      await this.git.add({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        filepath: cleanPath,
      })
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `暂存文件 "${cleanPath}"`)
      throw new Error(formatted)
    }
  }

  /** 取消暂存单个文件 (从 index 重置到 HEAD) */
  async unstageFile(filepath: string): Promise<void> {
    const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
    try {
      if (await this.hasUnbornHead()) {
        await this.git.updateIndex({
          fs: this.fs,
          dir: this.projectPath,
          gitdir: this.gitdir,
          filepath: cleanPath,
          remove: true,
          force: true,
        })
        return
      }
      await this.git.resetIndex({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        filepath: cleanPath,
        ref: "HEAD",
      })
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `取消暂存 "${cleanPath}"`)
      throw new Error(formatted)
    }
  }

  /** 暂存所有工作区变更 */
  async stageAll(): Promise<void> {
    try {
      const status = await this.getStatus()
      for (const item of status.unstagedChanges) {
        await this.stageFile(item.filepath)
      }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "暂存全部变更")
      throw new Error(formatted)
    }
  }

  /** 取消暂存所有已暂存文件 */
  async unstageAll(): Promise<void> {
    try {
      const status = await this.getStatus()
      for (const item of status.stagedChanges) {
        await this.unstageFile(item.filepath)
      }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "取消暂存全部")
      throw new Error(formatted)
    }
  }

  /** 仅提交当前暂存区的变更；不自动 Stage 或 Push。 */
  async commit(message: string, customAuthor?: GitAuthor): Promise<GitCommitResult> {
    const cleanMsg = GitSafety.validateCommitMessage(message)
    try {
      const status = await this.getStatus()
      if (status.stagedChanges.length === 0) {
        throw new GitSafetyError("没有已暂存的变更，无法创建 Commit", "NO_STAGED_CHANGES")
      }

      let author = customAuthor
      if (!author) {
        const cfgName = await this.git
          .getConfig({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, path: "user.name" })
          .catch(() => undefined)
        const cfgEmail = await this.git
          .getConfig({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, path: "user.email" })
          .catch(() => undefined)

        author = cfgName && cfgEmail
          ? { name: cfgName, email: cfgEmail }
          : { name: "Scripting User", email: "user@scripting.app" }
      }

      const oid = await this.git.commit({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        message: cleanMsg,
        author,
      })
      return { oid, shortOid: oid.slice(0, 7), message: cleanMsg }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "提交 Commit")
      throw new Error(formatted)
    }
  }

  /**
   * 将当前 Git 可见工作区写为独立 Commit/ref。
   * 只写对象数据库与 refs/source-control/snapshots/*，绝不更新 HEAD、Index 或工作区。
   */
  async createSafetySnapshot(reason: string): Promise<GitSafetySnapshotResult> {
    const cleanReason = GitSafety.validateSafetySnapshotReason(reason)
    const before = await this.getStatus()
    if (before.isClean) return { created: false }

    try {
      const headOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
      const headCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: headOid })
      const files = await this.readTreeContent(headCommit.commit.tree)
      const matrix = await this.git.statusMatrix({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir })

      // statusMatrix 仅包含 Git 可见文件：忽略文件不会进入快照。
      // worktree 为 0 代表创建瞬间文件不存在；其他状态均以磁盘 bytes 覆盖 HEAD 版本。
      for (const [filepath, , worktree] of matrix) {
        const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
        if (worktree === 0) {
          files.delete(cleanPath)
        } else {
          files.set(cleanPath, await FileManager.readAsBytes(`${this.projectPath}/${cleanPath}`))
        }
      }

      const tree = await this.buildTreeFromFiles(files)
      const author = await this.resolveAuthor()
      const timestamp = Math.floor(Date.now() / 1000)
      const timezoneOffset = -new Date().getTimezoneOffset()
      const message = `snapshot: ${cleanReason}`
      const oid = await this.git.writeCommit({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        commit: {
          message,
          tree,
          parent: [headOid],
          author: { ...author, timestamp, timezoneOffset },
          committer: { ...author, timestamp, timezoneOffset },
        },
      })
      const ref = `refs/source-control/snapshots/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref, value: oid })
      return { created: true, oid, shortOid: oid.slice(0, 7), message, ref }
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "创建 Safety Snapshot"))
    }
  }

  /**
   * 仅枚举 refs/source-control/snapshots/* 下可读且格式有效的 Snapshot Commit。
   * 损坏 ref 或非 Snapshot message 会被跳过，不影响其余 Snapshot 列表。
   */
  async listSafetySnapshots(limit = 50): Promise<GitSafetySnapshotInfo[]> {
    const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 200))
    const prefix = "refs/source-control/snapshots"
    try {
      const suffixes = await this.git.listRefs({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepath: prefix })
      const snapshots: GitSafetySnapshotInfo[] = []
      for (const suffix of suffixes) {
        const ref = `${prefix}/${suffix}`
        try {
          const oid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref })
          const entry = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid })
          const message = entry.commit.message.trim()
          if (!message.startsWith("snapshot: ")) continue
          snapshots.push({
            ref,
            oid: entry.oid,
            shortOid: entry.oid.slice(0, 7),
            message,
            reason: message.slice("snapshot: ".length),
            timestamp: entry.commit.author.timestamp,
            parentOid: entry.commit.parent[0] ?? "",
          })
        } catch {
          // 单个 ref 损坏或不可读时跳过，保留其余有效 Snapshot。
        }
      }
      return snapshots.sort((left, right) => right.timestamp - left.timestamp || right.ref.localeCompare(left.ref)).slice(0, safeLimit)
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "读取 Safety Snapshot 列表"))
    }
  }

  /**
   * 将独立 Snapshot Tree 应用到干净 Working Tree。
   * 不更新 HEAD、当前分支、Index 或 Snapshot ref，也不创建 Commit / Stage。
   */
  async restoreSafetySnapshot(ref: string): Promise<GitSafetySnapshotRestoreResult> {
    const cleanRef = GitSafety.validateSafetySnapshotRef(ref)

    try {
      const status = await this.getStatus()
      if (!status.isClean) throw new GitSafetyError("当前工作区存在未提交变更，无法恢复 Safety Snapshot", "DIRTY_WORKTREE")

      // 完成所有 ref、Commit、Tree、blob 与路径校验后才会触碰 Working Tree。
      const snapshotOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: cleanRef })
      const snapshotCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: snapshotOid })
      if (snapshotCommit.commit.parent.length !== 1 || !snapshotCommit.commit.message.trim().startsWith("snapshot: ")) {
        throw new GitSafetyError("引用未指向有效的 Safety Snapshot Commit", "INVALID_SNAPSHOT_COMMIT", { ref: cleanRef })
      }
      const headOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
      const headCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: headOid })
      const snapshotFiles = await this.readTreeContent(snapshotCommit.commit.tree)
      const headFiles = await this.readTreeContent(headCommit.commit.tree)
      const operations: SnapshotRestoreOperation[] = []

      for (const filepath of new Set([...headFiles.keys(), ...snapshotFiles.keys()])) {
        const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
        const headBytes = headFiles.get(cleanPath)
        const snapshotBytes = snapshotFiles.get(cleanPath)
        if (headBytes && snapshotBytes && this.areBytesEqual(headBytes, snapshotBytes)) continue
        const fullPath = `${this.projectPath}/${cleanPath}`
        const previousExists = await FileManager.exists(fullPath)
        if (snapshotBytes !== undefined && previousExists && await FileManager.isDirectory(fullPath)) {
          throw new GitSafetyError(`无法安全恢复 Snapshot：目标路径是目录 "${cleanPath}"`, "SNAPSHOT_RESTORE_PATH_CONFLICT", { filepath: cleanPath })
        }
        operations.push({ filepath: cleanPath, snapshotBytes: snapshotBytes ?? null, previousExists, previousBytes: previousExists ? await FileManager.readAsBytes(fullPath) : null })
      }

      try {
        for (const operation of operations.filter((item) => item.snapshotBytes === null).sort((a, b) => b.filepath.length - a.filepath.length)) await this.applySnapshotRestoreOperation(operation)
        for (const operation of operations.filter((item) => item.snapshotBytes !== null).sort((a, b) => a.filepath.length - b.filepath.length)) await this.applySnapshotRestoreOperation(operation)
      } catch (applyError) {
        try {
          await this.rollbackSnapshotRestoreOperations(operations)
        } catch (rollbackError) {
          throw new Error(`恢复 Safety Snapshot 写入失败，且回滚失败；Working Tree 可能需要检查。原始错误: ${String(applyError)}；回滚错误: ${String(rollbackError)}`)
        }
        throw applyError
      }
      return { restored: true, ref: cleanRef, snapshotOid, changedFiles: operations.length }
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "恢复 Safety Snapshot"))
    }
  }

  /** 直接将当前本地分支安全回退到指定祖先 Commit。 */
  async resetBranchToCommit(oid: string): Promise<GitBranchResetResult> {
    const targetOid = typeof oid === "string" ? oid.trim() : ""
    if (!/^[0-9a-f]{40}$/i.test(targetOid)) throw new GitSafetyError("Commit OID 格式不合法", "INVALID_COMMIT_OID")
    try {
      const status = await this.getStatus()
      if (!status.isClean) throw new GitSafetyError("Working tree must be clean before resetting the branch.", "RESET_DIRTY_WORKTREE")
      const branch = await this.getCurrentBranch()
      if (!branch) throw new GitSafetyError("Cannot reset a detached HEAD.", "RESET_DETACHED_HEAD")
      const branchRef = `refs/heads/${branch}`
      let fromOid: string
      try { fromOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" }) } catch { throw new GitSafetyError("Cannot reset an unborn branch.", "RESET_UNBORN_BRANCH") }
      const targetCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: targetOid })
      const headCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: fromOid })
      if (!await this.isCommitAncestor(targetOid, fromOid)) throw new GitSafetyError("Target commit is not an ancestor of the current branch.", "RESET_NON_ANCESTOR")
      const targetFiles = await this.readTreeContent(targetCommit.commit.tree)
      const currentFiles = await this.readTreeContent(headCommit.commit.tree)
      await this.preflightResetTarget(targetFiles, currentFiles)
      const metadata = await this.captureBranchResetMetadata(branch, branchRef, fromOid)
      if (targetOid === fromOid) return { reset: false, fromOid, toOid: targetOid, shortOid: targetOid.slice(0, 7) }
      const backupRef = `refs/source-control/reset-backups/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      try {
        await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: backupRef, value: fromOid, force: false })
        await this.git.checkout({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: targetOid, force: false })
        await FileManager.writeAsString(`${this.gitdir}/HEAD`, metadata.headContents, "utf8")
        await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: branchRef, value: targetOid, force: true })
        await this.assertBranchResetMetadata(metadata, branchRef, targetOid)
        if (!(await this.getStatus()).isClean) throw new Error("Reset did not produce a clean working tree")
        return { reset: true, fromOid, toOid: targetOid, shortOid: targetOid.slice(0, 7) }
      } catch (applyError) {
        try { await this.restoreBranchResetState(metadata) } catch { throw new Error("Reset failed and rollback was incomplete. Repository requires manual inspection.") }
        throw applyError
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Reset failed and rollback was incomplete. Repository requires manual inspection.") throw error
      throw new Error(GitSafety.formatErrorMessage(error, "回退本地分支"))
    }
  }

  private async isCommitAncestor(ancestorOid: string, descendantOid: string): Promise<boolean> {
    const pending = [descendantOid]; const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop()!
      if (current === ancestorOid) return true
      if (visited.has(current)) continue
      visited.add(current)
      const commit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: current })
      pending.push(...commit.commit.parent)
    }
    return false
  }

  private async captureBranchResetMetadata(branch: string, branchRef: string, branchOid: string): Promise<BranchResetMetadata> {
    const remoteRefs = new Map<string, string>()
    for (const remote of await this.listRemotes()) {
      const prefix = `refs/remotes/${remote.name}`
      for (const suffix of await this.git.listRefs({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepath: prefix })) {
        if (suffix === "HEAD" || suffix.endsWith("/HEAD")) continue
        const ref = `${prefix}/${suffix}`
        remoteRefs.set(ref, await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref }))
      }
    }
    const history = await this.git.log({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir })
    return { headContents: await FileManager.readAsString(`${this.gitdir}/HEAD`, "utf8"), branch, branchRef, branchOid, index: await FileManager.readAsBytes(`${this.gitdir}/index`), workingTree: await this.capturePullWorkingTree(), remoteRefs, historyOids: history.map((entry) => entry.oid) }
  }

  private async assertBranchResetMetadata(before: BranchResetMetadata, branchRef: string, targetOid: string): Promise<void> {
    if (await FileManager.readAsString(`${this.gitdir}/HEAD`, "utf8") !== before.headContents) throw new Error("Reset changed HEAD symbolic state")
    if (await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: branchRef }) !== targetOid) throw new Error("Reset did not update the requested branch")
    const remoteRefs = new Map<string, string>()
    for (const remote of await this.listRemotes()) {
      const prefix = `refs/remotes/${remote.name}`
      for (const suffix of await this.git.listRefs({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepath: prefix })) {
        if (suffix === "HEAD" || suffix.endsWith("/HEAD")) continue
        const ref = `${prefix}/${suffix}`; remoteRefs.set(ref, await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref }))
      }
    }
    if (!this.areStringMapsEqual(before.remoteRefs, remoteRefs)) throw new Error("Reset changed remote refs")
  }

  private async restoreBranchResetState(before: BranchResetMetadata): Promise<void> {
    await this.restorePullWorkingTree(before.workingTree, new Map())
    await FileManager.writeAsBytes(`${this.gitdir}/index`, before.index)
    await this.git.writeRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: before.branchRef, value: before.branchOid, force: true })
    await FileManager.writeAsString(`${this.gitdir}/HEAD`, before.headContents, "utf8")
  }

  private async preflightResetTarget(targetFiles: Map<string, Uint8Array>, currentFiles: Map<string, Uint8Array>): Promise<void> {
    const paths = new Set([...targetFiles.keys(), ...currentFiles.keys()])
    const targetPaths = [...targetFiles.keys()]
    const currentPaths = [...currentFiles.keys()]
    for (const targetPath of targetPaths) {
      if (currentPaths.some((currentPath) => currentPath.startsWith(`${targetPath}/`)) || currentPaths.some((currentPath) => targetPath.startsWith(`${currentPath}/`))) {
        throw new GitSafetyError(`Reset path conflict: tree file/directory layout differs at "${targetPath}".`, "RESET_PATH_CONFLICT")
      }
    }
    for (const filepath of paths) {
      const cleanPath = GitSafety.validateSnapshotTreePath(filepath); const parts = cleanPath.split("/")
      for (let index = 1; index <= parts.length; index += 1) {
        const candidate = `${this.projectPath}/${parts.slice(0, index).join("/")}`
        if (!(await FileManager.exists(candidate))) continue
        const needsDirectory = index < parts.length
        if (needsDirectory && !(await FileManager.isDirectory(candidate))) throw new GitSafetyError(`Reset path conflict: "${parts.slice(0, index).join("/")}" is a file but a directory is required.`, "RESET_PATH_CONFLICT")
        if (!needsDirectory && await FileManager.isDirectory(candidate)) throw new GitSafetyError(`Reset path conflict: "${cleanPath}" is a directory but a file is required.`, "RESET_PATH_CONFLICT")
      }
    }
  }
  /**
   * 将指定历史 Commit 的完整 Tree 非破坏性写入干净 Working Tree。
   * HEAD、分支、Index 和 Git refs 均保持不变；差异仅表现为未暂存变更。
   */
  async restoreCommitToWorkingTree(oid: string): Promise<GitCommitWorkingTreeRestoreResult> {
    const targetOid = typeof oid === "string" ? oid.trim() : ""
    if (!/^[0-9a-f]{40}$/i.test(targetOid)) throw new GitSafetyError("Commit OID 格式不合法", "INVALID_COMMIT_OID")
    try {
      const status = await this.getStatus()
      if (!status.isClean) throw new GitSafetyError("Working tree must be clean before restoring a historical version.", "DIRTY_WORKTREE")
      const metadataBefore = await this.captureCommitRestoreMetadata()
      const indexPath = `${this.gitdir}/index`
      const indexBefore = await FileManager.readAsBytes(indexPath)
      const targetCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: targetOid })
      const headCommit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: metadataBefore.headOid })
      const targetFiles = await this.readTreeContent(targetCommit.commit.tree)
      const headFiles = await this.readTreeContent(headCommit.commit.tree)
      const operations: CommitWorkingTreeRestoreOperation[] = []
      const createdDirectories = new Set<string>()

      for (const filepath of new Set([...headFiles.keys(), ...targetFiles.keys()])) {
        const cleanPath = GitSafety.validateSnapshotTreePath(filepath)
        const headBytes = headFiles.get(cleanPath)
        const targetBytes = targetFiles.get(cleanPath)
        if (headBytes && targetBytes && this.areBytesEqual(headBytes, targetBytes)) continue
        await this.assertCommitRestorePathSafe(cleanPath, targetBytes !== undefined, headFiles)
        const fullPath = `${this.projectPath}/${cleanPath}`
        const previousExists = await FileManager.exists(fullPath)
        if (previousExists && await FileManager.isDirectory(fullPath)) {
          throw new GitSafetyError(`无法安全恢复 Commit：目标路径是目录 "${cleanPath}"`, "COMMIT_RESTORE_PATH_CONFLICT", { filepath: cleanPath })
        }
        const previousBytes = previousExists ? await FileManager.readAsBytes(fullPath) : null
        if (headBytes !== undefined && (!previousExists || !previousBytes || !this.areBytesEqual(headBytes, previousBytes))) {
          throw new GitSafetyError(`恢复前工作区内容与当前 HEAD 不一致: "${cleanPath}"`, "COMMIT_RESTORE_RACE_CONFLICT", { filepath: cleanPath })
        }
        // HEAD 没有该文件时，磁盘上的同名文件可能是 ignored/untracked 数据，禁止覆盖。
        if (targetBytes !== undefined && headBytes === undefined && previousExists) {
          throw new GitSafetyError(`无法安全恢复 Commit：目标路径已有文件 "${cleanPath}"`, "COMMIT_RESTORE_PATH_CONFLICT", { filepath: cleanPath })
        }
        if (targetBytes !== undefined) {
          for (const directory of this.parentDirectories(cleanPath)) {
            const directoryPath = `${this.projectPath}/${directory}`
            if (!(await FileManager.exists(directoryPath))) createdDirectories.add(directoryPath)
          }
        }
        operations.push({ filepath: cleanPath, targetBytes: targetBytes ?? null, previousExists, previousBytes })
      }
      if (operations.length === 0) return { restored: false, oid: targetOid, shortOid: targetOid.slice(0, 7), changedFiles: 0 }

      const appliedOperations: CommitWorkingTreeRestoreOperation[] = []
      try {
        for (const operation of operations.filter((item) => item.targetBytes === null).sort((a, b) => b.filepath.length - a.filepath.length)) {
          await this.assertCommitRestoreOperationPrecondition(operation)
          appliedOperations.push(operation)
          await this.applyCommitWorkingTreeRestoreOperation(operation)
        }
        for (const operation of operations.filter((item) => item.targetBytes !== null).sort((a, b) => a.filepath.length - b.filepath.length)) {
          await this.assertCommitRestoreOperationPrecondition(operation)
          appliedOperations.push(operation)
          await this.applyCommitWorkingTreeRestoreOperation(operation)
        }
        await this.assertCommitRestoreMetadataUnchanged(metadataBefore)
        await this.assertWorkingTreeMatchesCommit(targetFiles, operations)
        const indexAfter = await FileManager.readAsBytes(indexPath)
        if (!this.areBytesEqual(indexBefore, indexAfter)) throw new Error("Restore unexpectedly changed the Index")
      } catch (applyError) {
        try {
          await this.rollbackCommitWorkingTreeRestoreOperations(appliedOperations, createdDirectories)
          await this.restoreIndexSnapshot(indexPath, indexBefore)
          await this.assertCommitRestoreMetadataUnchanged(metadataBefore)
          if (!this.areBytesEqual(indexBefore, await FileManager.readAsBytes(indexPath))) throw new Error("Index changed during restore")
        } catch {
          throw new Error("Restore failed and rollback was incomplete. Repository requires manual inspection.")
        }
        throw applyError
      }
      return { restored: true, oid: targetOid, shortOid: targetOid.slice(0, 7), changedFiles: operations.length }
    } catch (error) {
      if (error instanceof Error && error.message === "Restore failed and rollback was incomplete. Repository requires manual inspection.") throw error
      throw new Error(GitSafety.formatErrorMessage(error, "恢复历史 Commit"))
    }
  }

  private async captureCommitRestoreMetadata(): Promise<CommitRestoreMetadata> {
    const headOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
    const headContents = await FileManager.readAsString(`${this.gitdir}/HEAD`, "utf8")
    const branch = await this.getCurrentBranch()
    const branchOid = branch ? await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: `refs/heads/${branch}` }) : null
    const remoteRefs = new Map<string, string>()
    for (const remote of await this.listRemotes()) {
      const prefix = `refs/remotes/${remote.name}`
      const suffixes = await this.git.listRefs({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, filepath: prefix })
      for (const suffix of suffixes) {
        const ref = `${prefix}/${suffix}`
        remoteRefs.set(ref, await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref }))
      }
    }
    const history = await this.git.log({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir })
    return { headOid, headContents, branch, branchOid, remoteRefs, historyOids: history.map((entry) => entry.oid) }
  }

  private async assertCommitRestoreMetadataUnchanged(before: CommitRestoreMetadata): Promise<void> {
    const after = await this.captureCommitRestoreMetadata()
    if (before.headOid !== after.headOid || before.headContents !== after.headContents || before.branch !== after.branch || before.branchOid !== after.branchOid) throw new Error("Restore unexpectedly changed HEAD or branch")
    if (!this.areStringMapsEqual(before.remoteRefs, after.remoteRefs) || !this.areStringArraysEqual(before.historyOids, after.historyOids)) throw new Error("Restore unexpectedly changed refs or history")
  }

  private async assertWorkingTreeMatchesCommit(targetFiles: Map<string, Uint8Array>, operations: CommitWorkingTreeRestoreOperation[]): Promise<void> {
    const paths = new Set(operations.map((operation) => operation.filepath))
    for (const [filepath, bytes] of targetFiles) {
      const fullPath = `${this.projectPath}/${filepath}`
      if (!(await FileManager.exists(fullPath)) || await FileManager.isDirectory(fullPath) || !this.areBytesEqual(bytes, await FileManager.readAsBytes(fullPath))) throw new Error(`Working Tree 未匹配目标 Commit: "${filepath}"`)
    }
    for (const operation of operations.filter((item) => item.targetBytes === null)) {
      if (await FileManager.exists(`${this.projectPath}/${operation.filepath}`)) throw new Error(`Working Tree 未删除目标文件: "${operation.filepath}"`)
    }
    const status = await this.getStatus()
    if (status.isClean || status.stagedChanges.length > 0 || status.changes.some((change) => !paths.has(change.filepath))) throw new Error("恢复后工作区状态不符合预期")
  }

  private parentDirectories(filepath: string): string[] {
    const parts = filepath.split("/").slice(0, -1); const directories: string[] = []
    for (let index = 1; index <= parts.length; index++) directories.push(parts.slice(0, index).join("/"))
    return directories
  }

  private async assertCommitRestorePathSafe(filepath: string, willWriteFile: boolean, headFiles: Map<string, Uint8Array>): Promise<void> {
    if (willWriteFile && [...headFiles.keys()].some((headPath) => headPath.startsWith(`${filepath}/`))) {
      throw new GitSafetyError(`无法安全恢复 Commit：目标文件与当前目录冲突 "${filepath}"`, "COMMIT_RESTORE_FILE_DIRECTORY_CONFLICT", { filepath })
    }
    const parts = filepath.split("/")
    for (let index = 1; index < parts.length; index++) {
      const ancestorPath = `${this.projectPath}/${parts.slice(0, index).join("/")}`
      if (await FileManager.exists(ancestorPath) && !(await FileManager.isDirectory(ancestorPath))) {
        throw new GitSafetyError(`无法安全恢复 Commit：父路径是文件 "${parts.slice(0, index).join("/")}"`, "COMMIT_RESTORE_FILE_DIRECTORY_CONFLICT", { filepath })
      }
    }
    if (willWriteFile) {
      const fullPath = `${this.projectPath}/${filepath}`
      if (await FileManager.exists(fullPath) && await FileManager.isDirectory(fullPath)) {
        throw new GitSafetyError(`无法安全恢复 Commit：目标路径是目录 "${filepath}"`, "COMMIT_RESTORE_FILE_DIRECTORY_CONFLICT", { filepath })
      }
    }
  }

  private async applyCommitWorkingTreeRestoreOperation(operation: CommitWorkingTreeRestoreOperation): Promise<void> {
    const fullPath = `${this.projectPath}/${operation.filepath}`
    if (operation.targetBytes === null) { if (await FileManager.exists(fullPath)) await FileManager.remove(fullPath); return }
    const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
    if (await FileManager.exists(parentPath) && !(await FileManager.isDirectory(parentPath))) throw new GitSafetyError(`恢复期间检测到文件/目录冲突: "${operation.filepath}"`, "COMMIT_RESTORE_RACE_CONFLICT")
    if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
    if (await FileManager.exists(fullPath) && await FileManager.isDirectory(fullPath)) throw new GitSafetyError(`恢复期间检测到文件/目录冲突: "${operation.filepath}"`, "COMMIT_RESTORE_RACE_CONFLICT")
    await FileManager.writeAsBytes(fullPath, operation.targetBytes)
  }

  private async assertCommitRestoreOperationPrecondition(operation: CommitWorkingTreeRestoreOperation): Promise<void> {
    const fullPath = `${this.projectPath}/${operation.filepath}`
    const exists = await FileManager.exists(fullPath)
    if (exists !== operation.previousExists) throw new GitSafetyError(`恢复前后文件状态发生变化: "${operation.filepath}"`, "COMMIT_RESTORE_RACE_CONFLICT")
    if (!exists) return
    if (await FileManager.isDirectory(fullPath)) throw new GitSafetyError(`恢复期间检测到文件/目录冲突: "${operation.filepath}"`, "COMMIT_RESTORE_RACE_CONFLICT")
    if (!operation.previousBytes || !this.areBytesEqual(operation.previousBytes, await FileManager.readAsBytes(fullPath))) throw new GitSafetyError(`恢复前后文件内容发生变化: "${operation.filepath}"`, "COMMIT_RESTORE_RACE_CONFLICT")
  }

  private async rollbackCommitWorkingTreeRestoreOperations(operations: CommitWorkingTreeRestoreOperation[], createdDirectories: Set<string>): Promise<void> {
    for (const operation of [...operations].sort((a, b) => b.filepath.length - a.filepath.length)) {
      const fullPath = `${this.projectPath}/${operation.filepath}`
      const exists = await FileManager.exists(fullPath)
      if (operation.targetBytes !== null) {
        if (!exists) {
          if (operation.previousExists) throw new Error(`回滚文件丢失: ${operation.filepath}`)
          continue
        }
        if (await FileManager.isDirectory(fullPath)) throw new Error(`回滚路径是目录: ${operation.filepath}`)
        const currentBytes = await FileManager.readAsBytes(fullPath)
        if (!this.areBytesEqual(currentBytes, operation.targetBytes) && (!operation.previousExists || !operation.previousBytes || !this.areBytesEqual(currentBytes, operation.previousBytes))) throw new Error(`回滚路径内容未知: ${operation.filepath}`)
        if (this.areBytesEqual(currentBytes, operation.targetBytes)) await FileManager.remove(fullPath)
      } else if (exists) {
        if (!operation.previousExists || !operation.previousBytes || await FileManager.isDirectory(fullPath) || !this.areBytesEqual(await FileManager.readAsBytes(fullPath), operation.previousBytes)) throw new Error(`回滚删除路径内容未知: ${operation.filepath}`)
      }
    }
    for (const operation of operations.filter((item) => item.previousExists).sort((a, b) => a.filepath.length - b.filepath.length)) {
      const fullPath = `${this.projectPath}/${operation.filepath}`; const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
      if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
      if (await FileManager.exists(fullPath) && await FileManager.isDirectory(fullPath)) throw new Error(`回滚目标是目录: ${operation.filepath}`)
      await FileManager.writeAsBytes(fullPath, operation.previousBytes!)
    }
    for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
      if (await FileManager.exists(directory) && await FileManager.isDirectory(directory)) {
        const entries = await FileManager.readDirectory(directory)
        if (!entries || entries.length === 0) await FileManager.remove(directory)
      }
    }
  }

  private async restoreIndexSnapshot(indexPath: string, indexBefore: Uint8Array): Promise<void> {
    if (!this.areBytesEqual(indexBefore, await FileManager.readAsBytes(indexPath))) {
      await FileManager.writeAsBytes(indexPath, indexBefore)
      if (!this.areBytesEqual(indexBefore, await FileManager.readAsBytes(indexPath))) throw new Error("Index rollback failed")
    }
  }

  private areStringArraysEqual(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }

  private areStringMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
    if (left.size !== right.size) return false
    for (const [key, value] of left) if (right.get(key) !== value) return false
    return true
  }

  private areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private async applySnapshotRestoreOperation(operation: SnapshotRestoreOperation): Promise<void> {
    const fullPath = `${this.projectPath}/${operation.filepath}`
    if (operation.snapshotBytes === null) {
      if (await FileManager.exists(fullPath)) await FileManager.remove(fullPath)
      return
    }
    const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
    if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
    await FileManager.writeAsBytes(fullPath, operation.snapshotBytes)
  }

  private async rollbackSnapshotRestoreOperations(operations: SnapshotRestoreOperation[]): Promise<void> {
    for (const operation of [...operations].sort((a, b) => b.filepath.length - a.filepath.length)) {
      const fullPath = `${this.projectPath}/${operation.filepath}`
      if (await FileManager.exists(fullPath)) await FileManager.remove(fullPath)
    }
    for (const operation of [...operations].filter((item) => item.previousExists).sort((a, b) => a.filepath.length - b.filepath.length)) {
      const fullPath = `${this.projectPath}/${operation.filepath}`
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
      if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
      await FileManager.writeAsBytes(fullPath, operation.previousBytes!)
    }
  }

  private async readTreeContent(treeOid: string, prefix = ""): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>()
    const entries = await this.git.readTree({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: treeOid })
    for (const entry of entries.tree) {
      const filepath = GitSafety.validateSnapshotTreePath(prefix ? `${prefix}/${entry.path}` : entry.path)
      if (entry.type === "tree") {
        const nested = await this.readTreeContent(entry.oid, filepath)
        for (const [path, bytes] of nested) result.set(path, bytes)
      } else if (entry.type === "blob") {
        result.set(filepath, (await this.git.readObject({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: entry.oid, format: "content" })).object)
      } else {
        throw new GitSafetyError(`Snapshot Tree 包含不支持的条目类型: ${entry.type}`, "UNSUPPORTED_SNAPSHOT_TREE_ENTRY", { filepath, type: entry.type })
      }
    }
    return result
  }


  private async resolveAuthor(): Promise<GitAuthor> {
    const name = await this.git.getConfig({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, path: "user.name" }).catch(() => undefined)
    const email = await this.git.getConfig({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, path: "user.email" }).catch(() => undefined)
    return name && email ? { name, email } : { name: "Scripting User", email: "user@scripting.app" }
  }

  private async buildTreeFromFiles(files: Map<string, Uint8Array>): Promise<string> {
    const root = new Map<string, Uint8Array | Map<string, unknown>>()
    for (const [filepath, bytes] of files) {
      const segments = filepath.split("/")
      let directory = root
      for (const segment of segments.slice(0, -1)) {
        const existing = directory.get(segment)
        if (existing instanceof Map) {
          directory = existing as Map<string, Uint8Array | Map<string, unknown>>
        } else {
          const next = new Map<string, Uint8Array | Map<string, unknown>>()
          directory.set(segment, next)
          directory = next
        }
      }
      directory.set(segments[segments.length - 1], bytes)
    }

    const writeDirectory = async (directory: Map<string, Uint8Array | Map<string, unknown>>): Promise<string> => {
      const tree = [] as Array<{ mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" }>
      for (const [name, value] of directory) {
        if (value instanceof Uint8Array) {
          tree.push({ mode: SNAPSHOT_MODE, path: name, oid: await this.git.writeBlob({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, blob: value }), type: "blob" })
        } else {
          tree.push({ mode: "040000", path: name, oid: await writeDirectory(value as Map<string, Uint8Array | Map<string, unknown>>), type: "tree" })
        }
      }
      return this.git.writeTree({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, tree })
    }

    return writeDirectory(root)
  }

  /** 仅读取当前本地 HEAD 的最近提交历史，按最新优先返回。 */
  async getHistory(limit = 50): Promise<GitCommitInfo[]> {
    try {
      const safeLimit = Math.max(1, Math.min(limit, 200))
      let logs: Array<{
        oid: string
        commit: {
          message: string
          tree: string
          parent: string[]
          author: { name: string; email: string; timestamp: number; timezoneOffset: number }
          committer: { name: string; email: string; timestamp: number; timezoneOffset: number }
        }
      }> = []

      try {
        logs = await this.git.log({
          fs: this.fs,
          dir: this.projectPath,
          gitdir: this.gitdir,
          depth: safeLimit,
        })
      } catch (err: unknown) {
        if (await this.hasUnbornHead()) return []
        throw err
      }

      return this.toHistoryInfo(logs)
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "获取历史提交记录")
      throw new Error(formatted)
    }
  }

  /** 仅读取已 Fetch 的 remote-tracking ref，不访问网络或修改仓库状态。 */
  async getRemoteHistory(remoteName = "origin", branchName?: string, limit = 50): Promise<GitCommitInfo[]> {
    const remote = validateRemoteName(remoteName)
    const branch = branchName || await this.getCurrentBranch()
    if (!branch) throw new GitSafetyError("当前不在本地分支上，无法读取 GitHub 历史", "REMOTE_HISTORY_NO_BRANCH")
    const remoteBranch = (await this.listRemoteBranches(remote)).find((item) => item.name === branch)
    if (!remoteBranch) throw new GitSafetyError(`尚未获取远端分支: "${remote}/${branch}"`, "REMOTE_BRANCH_NOT_FOUND", { remote, branch })
    try {
      const logs = await this.git.log({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: remoteBranch.ref, depth: Math.max(1, Math.min(limit, 200)) })
      return this.toHistoryInfo(logs)
    } catch (error) {
      throw new Error(GitSafety.formatErrorMessage(error, "读取 GitHub 历史"))
    }
  }

  private toHistoryInfo(logs: Array<{
    oid: string
    commit: {
      message: string
      parent: string[]
      author: { name: string; email: string; timestamp: number; timezoneOffset: number }
    }
  }>): GitCommitInfo[] {
    return logs.map((entry) => ({
      oid: entry.oid,
      shortOid: entry.oid.slice(0, 7),
      message: entry.commit.message.trim(),
      authorName: entry.commit.author.name,
      authorEmail: entry.commit.author.email,
      timestamp: entry.commit.author.timestamp,
      parentOids: entry.commit.parent || [],
    }))
  }

  private async hasUnbornHead(): Promise<boolean> {
    try {
      const head = await FileManager.readAsString(`${this.gitdir}/HEAD`, "utf8")
      const ref = head.trim()
      if (!ref.startsWith("ref: refs/heads/")) return false
      await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
      return false
    } catch {
      return true
    }
  }

  /** 获取 Commit 元数据及与首个 parent 相比的文件变更。 */
  async getCommitDetail(oid: string): Promise<GitCommitDetail> {
    if (!oid || typeof oid !== "string" || !oid.trim()) {
      throw new GitSafetyError("Commit oid 不能为空", "INVALID_COMMIT_OID", { oid })
    }
    const cleanOid = oid.trim()
    try {
      const entry = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: cleanOid })
      const parents = entry.commit.parent || []
      const currentFiles = await this.readTreeFiles(entry.commit.tree)
      const parentFiles = parents.length > 0 ? await this.readCommitTreeFiles(parents[0]) : new Map<string, string>()
      const changedFiles = compareTreeFiles(parentFiles, currentFiles)
      return {
        oid: entry.oid,
        shortOid: entry.oid.slice(0, 7),
        message: entry.commit.message.trim(),
        author: { name: entry.commit.author.name, email: entry.commit.author.email },
        timestamp: entry.commit.author.timestamp,
        parents,
        changedFiles,
      }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `读取 Commit "${cleanOid}"`)
      throw new Error(formatted)
    }
  }

  /** 创建一个新的 Commit 以安全反向应用目标非合并 Commit。 */
  async revertCommit(oid: string): Promise<GitCommitResult> {
    if (!oid || typeof oid !== "string" || !oid.trim()) {
      throw new GitSafetyError("Commit oid 不能为空", "INVALID_COMMIT_OID", { oid })
    }
    const cleanOid = oid.trim()
    try {
      const status = await this.getStatus()
      if (!status.isClean) {
        throw new GitSafetyError("工作区存在未提交变更，无法安全 Revert Commit", "DIRTY_WORKTREE")
      }

      const target = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: cleanOid })
      const parents = target.commit.parent || []
      if (parents.length === 0) {
        throw new GitSafetyError("暂不支持 Revert root Commit", "ROOT_COMMIT_REVERT_UNSUPPORTED", { oid: cleanOid })
      }
      if (parents.length > 1) {
        throw new GitSafetyError("暂不支持 Revert merge Commit", "MERGE_COMMIT_REVERT_UNSUPPORTED", { oid: cleanOid })
      }

      const headOid = await this.git.resolveRef({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, ref: "HEAD" })
      const head = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: headOid })
      const parentFiles = await this.readCommitTreeFiles(parents[0])
      const targetFiles = await this.readTreeFiles(target.commit.tree)
      const headFiles = await this.readTreeFiles(head.commit.tree)
      const operations = getSafeRevertOperations(parentFiles, targetFiles, headFiles)

      for (const operation of operations) {
        const fullPath = `${this.projectPath}/${operation.filepath}`
        if (operation.restoreOid === null) {
          if (await FileManager.exists(fullPath)) await FileManager.remove(fullPath)
        } else {
          const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
          if (!(await FileManager.exists(parentPath))) await FileManager.createDirectory(parentPath, true)
          const { object } = await this.git.readObject({
            fs: this.fs,
            dir: this.projectPath,
            gitdir: this.gitdir,
            oid: operation.restoreOid,
            format: "content",
          })
          await FileManager.writeAsBytes(fullPath, object)
        }
      }
      for (const operation of operations) await this.stageFile(operation.filepath)

      const subject = target.commit.message.split("\n")[0].trim()
      return await this.commit(`Revert "${subject}"`)
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `Revert Commit "${cleanOid}"`)
      throw new Error(formatted)
    }
  }
  private async readCommitTreeFiles(oid: string): Promise<Map<string, string>> {
    const commit = await this.git.readCommit({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid })
    return this.readTreeFiles(commit.commit.tree)
  }

  private async readTreeFiles(treeOid: string, prefix = ""): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const entries = await this.git.readTree({ fs: this.fs, dir: this.projectPath, gitdir: this.gitdir, oid: treeOid })
    for (const entry of entries.tree) {
      const filepath = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === "tree") {
        const nested = await this.readTreeFiles(entry.oid, filepath)
        for (const [nestedPath, nestedOid] of nested) result.set(nestedPath, nestedOid)
      } else if (entry.type === "blob") {
        result.set(filepath, entry.oid)
      }
    }
    return result
  }

  /**
   * 恢复单个未暂存的工作区文件到 Index 版本。
   * 默认路径不使用强制 checkout；未跟踪文件和仅存在暂存删除的文件会被安全拒绝。
   */
  async restoreFile(filepath: string, options: { force?: boolean } = {}): Promise<void> {
    const cleanPath = GitSafety.sanitizeRelativeFilePath(filepath)
    if (cleanPath === ".") {
      throw new GitSafetyError("Restore 必须指定单个文件", "INVALID_RESTORE_PATH", { filepath })
    }

    try {
      const matrix = await this.git.statusMatrix({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        filepaths: [cleanPath],
      })
      const row = matrix.find((item) => item[0] === cleanPath)
      if (!row) {
        throw new GitSafetyError(`文件没有可恢复的变更: "${cleanPath}"`, "NO_FILE_CHANGE", { filepath: cleanPath })
      }

      const [, head, worktree, index] = row
      if (worktree !== 0 && worktree !== 2) {
        throw new GitSafetyError(`文件没有未暂存变更可恢复: "${cleanPath}"`, "NO_UNSTAGED_CHANGE", { filepath: cleanPath })
      }
      if (head === 0 && index === 0) {
        throw new GitSafetyError(`未跟踪文件不能通过 Restore 删除: "${cleanPath}"`, "UNTRACKED_RESTORE_FORBIDDEN", { filepath: cleanPath })
      }
      if (index === 0 && !options.force) {
        throw new GitSafetyError(
          `"${cleanPath}" 仅有暂存删除；默认 Restore 不会覆盖暂存区状态，请先 Unstage`,
          "STAGED_DELETE_RESTORE_FORBIDDEN",
          { filepath: cleanPath },
        )
      }

      if (options.force) {
        await this.git.checkout({
          fs: this.fs,
          dir: this.projectPath,
          gitdir: this.gitdir,
          filepaths: [cleanPath],
          ref: "HEAD",
          force: true,
        })
        return
      }

      // 以当前 Index 生成 tree 后直接恢复目标文件，不调用 force checkout。
      // 这会丢弃工作区未暂存内容，但保留任何已经 Stage 的版本。
      if (index === 0) {
        throw new GitSafetyError(`暂存区中不存在可恢复版本: "${cleanPath}"`, "NO_INDEX_VERSION", { filepath: cleanPath })
      }
      const indexOid = await this.readIndexBlobOid(cleanPath)
      if (!indexOid) {
        throw new GitSafetyError(`暂存区中不存在可恢复版本: "${cleanPath}"`, "NO_INDEX_VERSION", { filepath: cleanPath })
      }
      const { object: blob } = await this.git.readObject({
        fs: this.fs,
        dir: this.projectPath,
        gitdir: this.gitdir,
        oid: indexOid,
        format: "content",
      })
      const fullPath = `${this.projectPath}/${cleanPath}`
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"))
      if (!(await FileManager.exists(parentPath))) {
        await FileManager.createDirectory(parentPath, true)
      }
      await FileManager.writeAsBytes(fullPath, blob)
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `恢复文件 "${cleanPath}"`)
      throw new Error(formatted)
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
        if (walkPath !== filepath || !entry || await entry.type() !== "blob") return undefined
        oid = await entry.oid()
        return oid
      },
    })
    return oid
  }

  async getFileDiff(filepath: string, comparison: "unstaged" | "staged") {
    try {
      return await new GitDiff(this.projectPath, this.gitdir, this.git, this.fs).getFileDiff(filepath, comparison)
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, `读取文件 Diff "${filepath}"`)
      throw new Error(formatted)
    }
  }
}
