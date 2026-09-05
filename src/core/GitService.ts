/**
 * GitService.ts
 * 源码管理器的统一门面 (Facade)，负责生命周期管理、多仓库切换以及对外安全接口
 */

import { GitRepository } from "./GitRepository"
import { GitAheadBehind, GitAuthor, GitBranchResetResult, GitCommitDetail, GitCommitInfo, GitCommitResult, GitCommitWorkingTreeRestoreResult, GitDiffResult, GitPullResult, GitPushResult, GitRemoteBranch, GitRemoteCredential, GitRemoteInfo, GitRepositoryStatus, GitSafetySnapshotInfo, GitSafetySnapshotRestoreResult, GitSafetySnapshotResult, GitSyncRecord, IsomorphicGitAdapter } from "./types"
import { GitSafety, GitSafetyError } from "./GitSafety"
import { loadBufferPolyfill } from "../polyfills"
import { ensureBaseline, recordSync, listSyncRecords as readSyncRecords } from "./GitSyncHistory"
import {
  ensureProjectMetadata,
  findRelocationCandidates,
  listAllProjects,
  manualRelocateProject,
  ProjectMetadata,
  ProjectMetadataManager,
  ProjectRegistry,
  tryAutoRelocateProject,
} from "./ProjectMetadata"
declare const Buffer: any


export class GitService {
  private static cachedGitInstance: IsomorphicGitAdapter | null = null
  private currentRepo: GitRepository | null = null

  /**
   * 确保全局 Buffer polyfill 及 isomorphic-git 实例加载
   */
  private static async getGitAdapter(): Promise<IsomorphicGitAdapter> {
    if (this.cachedGitInstance) {
      return this.cachedGitInstance
    }

    await loadBufferPolyfill()

    const localBundle = FileManager.scriptsDirectory + "/Source Control/src/vendor/index.umd.min.js"
    const skillBundle = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git/vendor/index.umd.min.js"

    let bundlePath = ""
    if (await FileManager.exists(localBundle)) {
      bundlePath = localBundle
    } else if (await FileManager.exists(skillBundle)) {
      bundlePath = skillBundle
    } else {
      throw new Error(`isomorphic-git bundle 未找到，请检查 vendor 依赖`)
    }

    const bundleCode = await FileManager.readAsString(bundlePath, "utf8")
    const wrappedCode =
      "(function() {\n" +
      "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
      "var module = { exports: {} };\n" +
      "var exports = module.exports;\n" +
      bundleCode +
      "\n" +
      "return module.exports;\n" +
      "})()"

    const gitInstance = eval(wrappedCode)
    if (!gitInstance || typeof gitInstance.init !== "function") {
      throw new Error("加载 isomorphic-git 核心失败")
    }

    this.cachedGitInstance = gitInstance
    return gitInstance
  }

  /**
   * 获取项目的隔离 gitdir 存储路径（委托 ProjectRegistry）
   */
  static async getGitdir(projectDir: string, customRepoName?: string): Promise<string> {
    const validPath = GitSafety.validateProjectPath(projectDir)
    return ProjectRegistry.getInstance().getGitdir(validPath, customRepoName)
  }

  /**
   * 创建兼顾 workdir 和隔离 gitdir 的 FS 适配器
   */
  private static createFS(gitdir: string, workdir: string): unknown {
    const GIT_INTERNAL_PATTERNS = [
      "HEAD",
      "config",
      "index",
      "COMMIT_EDITMSG",
      "MERGE_HEAD",
      "FETCH_HEAD",
      "ORIG_HEAD",
      "packed-refs",
      "objects/",
      "refs/",
      "info/",
      "hooks/",
      "logs/",
      "description",
      "shallow",
      "deepen",
    ]

    function isGitInternal(filepath: string): boolean {
      if (!filepath) return false
      if (filepath.startsWith(".git/") || filepath === ".git") return true
      for (const pattern of GIT_INTERNAL_PATTERNS) {
        if (filepath === pattern || filepath.startsWith(pattern)) return true
      }
      return false
    }

    function resolvePath(filepath: string): string {
      const p = filepath == null ? "" : String(filepath)
      if (!p) return workdir
      if (p.startsWith("/")) return p
      const cleanPath = p.startsWith(".git/") ? p.substring(5) : p
      if (isGitInternal(cleanPath)) {
        return gitdir + "/" + cleanPath
      }
      return workdir + "/" + p
    }

    const rawFs = {
      async readFile(filepath: string, opts?: any): Promise<any> {
        const resolved = resolvePath(filepath)
        try {
          const encoding = typeof opts === "string" ? opts : opts?.encoding
          if (encoding === "utf8") {
            return await FileManager.readAsString(resolved, "utf8")
          }
          const bytes = await FileManager.readAsBytes(resolved)
          return Buffer.from(bytes)
        } catch {
          const err = new Error(`ENOENT: no such file or directory, open '${filepath}'`)
          ;(err as any).code = "ENOENT"
          throw err
        }
      },

      async writeFile(filepath: string, data: any, _opts?: any): Promise<void> {
        const resolved = resolvePath(filepath)
        const parentDir = resolved.substring(0, resolved.lastIndexOf("/"))
        try {
          if (!(await FileManager.exists(parentDir))) {
            await FileManager.createDirectory(parentDir, true)
          }
        } catch {
          /* 忽略 */
        }
        if (typeof data === "string") {
          await FileManager.writeAsString(resolved, data, "utf8")
          return
        }
        let bytes: Uint8Array
        if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        } else if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data)
        } else if (data instanceof Uint8Array) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        } else {
          bytes = new Uint8Array(data)
        }
        await FileManager.writeAsBytes(resolved, bytes)
      },

      async mkdir(filepath: string, _opts?: any): Promise<void> {
        const resolved = resolvePath(filepath)
        try {
          await FileManager.createDirectory(resolved, true)
        } catch {
          /* 目录已存在 */
        }
      },

      async rmdir(filepath: string): Promise<void> {
        const resolved = resolvePath(filepath)
        if (resolved === workdir) throw new GitSafetyError("禁止删除项目根目录", "PROJECT_ROOT_DELETE_BLOCKED")
        try {
          await FileManager.remove(resolved)
        } catch {
          /* 忽略 */
        }
      },

      async unlink(filepath: string): Promise<void> {
        const resolved = resolvePath(filepath)
        if (resolved === workdir) throw new GitSafetyError("禁止删除项目根目录", "PROJECT_ROOT_DELETE_BLOCKED")
        try {
          await FileManager.remove(resolved)
        } catch {
          /* 忽略 */
        }
      },

      async exists(filepath: string): Promise<boolean> {
        try {
          return await FileManager.exists(resolvePath(filepath))
        } catch {
          return false
        }
      },

      async readdir(filepath: string): Promise<string[]> {
        try {
          const list = await FileManager.readDirectory(resolvePath(filepath))
          return (list || []).map((item: any) => {
            if (typeof item === "string") {
              const idx = item.lastIndexOf("/")
              return idx >= 0 ? item.substring(idx + 1) : item
            }
            return item?.name || String(item)
          })
        } catch {
          return []
        }
      },

      async stat(filepath: string): Promise<any> {
        const resolved = resolvePath(filepath)
        try {
          const exists = await FileManager.exists(resolved)
          if (!exists) {
            const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`)
            ;(err as any).code = "ENOENT"
            throw err
          }
          const isDir = await FileManager.isDirectory(resolved)
          let size = 0
          let mtimeMs = Date.now()
          try {
            const statRes = await FileManager.stat(resolved)
            if (statRes) {
              size = statRes.size || 0
              if (statRes.modificationDate) {
                mtimeMs = statRes.modificationDate > 1e11 ? statRes.modificationDate : statRes.modificationDate * 1000
              }
            }
          } catch {
            /* 属性读取失败使用兜底值 */
          }

          const type = isDir ? 2 : 1
          const mode = isDir ? 0o040777 : 0o100666

          return {
            ctimeSeconds: Math.floor(mtimeMs / 1000),
            ctimeNanoseconds: 0,
            mtimeSeconds: Math.floor(mtimeMs / 1000),
            mtimeNanoseconds: 0,
            dev: 1,
            ino: 1,
            mode,
            uid: 1,
            gid: 1,
            size,
            type,
            isFile: () => !isDir,
            isDirectory: () => isDir,
            isSymbolicLink: () => false,
          }
        } catch (e: any) {
          if (e?.code === "ENOENT") throw e
          const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`)
          ;(err as any).code = "ENOENT"
          throw err
        }
      },

      async lstat(filepath: string): Promise<any> {
        return this.stat(filepath)
      },

      async readlink(filepath: string): Promise<string> {
        return FileManager.destinationOfSymbolicLink(resolvePath(filepath))
      },

      async symlink(target: string, filepath: string): Promise<void> {
        await FileManager.createLink(resolvePath(filepath), target)
      },

      async rename(oldPath: string, newPath: string): Promise<void> {
        const oldResolved = resolvePath(oldPath)
        const newResolved = resolvePath(newPath)
        if (oldResolved === workdir || newResolved === workdir) throw new GitSafetyError("禁止替换项目根目录", "PROJECT_ROOT_RENAME_BLOCKED")
        await FileManager.rename(oldResolved, newResolved)
      },
    }

    return rawFs
  }

  // ==================== 统一公开接口 ====================

  /** 检查指定路径是否已初始化 Git 仓库 */
  async isRepositoryInitialized(projectPath: string): Promise<boolean> {
    try {
      const validPath = GitSafety.validateProjectPath(projectPath)
      const gitdir = await GitService.getGitdir(validPath)
      const headFile = gitdir + "/HEAD"
      return await FileManager.exists(headFile)
    } catch {
      return false
    }
  }

  /** 获取当前打开的仓库实例，若未打开则抛出明确异常 */
  private ensureRepository(): GitRepository {
    if (!this.currentRepo) {
      throw new GitSafetyError("尚未打开任何 Git 仓库，请先调用 openRepository()", "NO_REPO_OPEN")
    }
    return this.currentRepo
  }

  /** 列出所有受管项目 */
  static async listAllProjects(): Promise<ProjectMetadata[]> {
    return listAllProjects()
  }

  /** 尝试自动重定位项目 */
  static async tryAutoRelocateProject(projectId: string): Promise<{ success: boolean; newPath?: string; candidates: any[] }> {
    const projects = await ProjectMetadataManager.loadProjects()
    const record = projects[projectId]
    if (!record) return { success: false, candidates: [] }
    const candidates = await ProjectMetadataManager.findCandidates(record)
    const strong = candidates.filter((c: any) => c.score >= 60)
    if (strong.length === 1) {
      const best = strong[0]
      await ProjectMetadataManager.updateProjectRelocation(projectId, best.path, best.displayName)
      return { success: true, newPath: best.path, candidates }
    }
    return { success: false, candidates }
  }

  /** 手动重定位项目 */
  static async manualRelocateProject(projectId: string, newPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await ProjectMetadataManager.updateProjectRelocation(projectId, newPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  }

  /** 查找候选重定位目录 */
  static async findRelocationCandidates(projectId: string): Promise<any[]> {
    const projects = await ProjectMetadataManager.loadProjects()
    const record = projects[projectId]
    if (!record) return []
    return ProjectMetadataManager.findCandidates(record)
  }

  /**
   * 打开指定路径的 Git 仓库
   */
  async openRepository(projectPath: string): Promise<GitRepository> {
    const validPath = GitSafety.validateProjectPath(projectPath)
    const gitAdapter = await GitService.getGitAdapter()
    const meta = await ensureProjectMetadata(validPath)
    const gitdir = await GitService.getGitdir(validPath)
    const fs = GitService.createFS(gitdir, validPath)

    const repo = new GitRepository(validPath, gitdir, gitAdapter, fs, meta.projectId)
    this.currentRepo = repo
    return repo
  }

  /**
   * 初始化指定路径的 Git 仓库
   */
  async initRepository(projectPath: string, repoName?: string): Promise<{ message: string; gitdir: string }> {
    const validPath = GitSafety.validateProjectPath(projectPath)
    const gitAdapter = await GitService.getGitAdapter()
    const gitdir = await GitService.getGitdir(validPath, repoName)
    const fs = GitService.createFS(gitdir, validPath)

    try {
      await gitAdapter.init({ fs, dir: validPath, gitdir })

      // 写入默认配置（仅当不存在时）
      const existingName = await gitAdapter
        .getConfig({ fs, dir: validPath, gitdir, path: "user.name" })
        .catch(() => undefined)
      const existingEmail = await gitAdapter
        .getConfig({ fs, dir: validPath, gitdir, path: "user.email" })
        .catch(() => undefined)

      if (!existingName) {
        await gitAdapter.setConfig({ fs, dir: validPath, gitdir, path: "user.name", value: "Scripting User" })
      }
      if (!existingEmail) {
        await gitAdapter.setConfig({ fs, dir: validPath, gitdir, path: "user.email", value: "user@scripting.app" })
      }

      const meta = await ensureProjectMetadata(validPath, repoName)
      this.currentRepo = new GitRepository(validPath, gitdir, gitAdapter, fs, meta.projectId)
      return { message: "仓库初始化成功", gitdir }
    } catch (error) {
      const formatted = GitSafety.formatErrorMessage(error, "初始化仓库")
      throw new Error(formatted)
    }
  }

  /** Fetch HTTPS Remote，仅更新远端对象与 remote-tracking refs。 */
  async fetchRemote(remoteName?: string): Promise<{ remote: string; branch: string | null; fetched: boolean }> {
    return this.ensureRepository().fetchRemote(remoteName)
  }

  /** 仅读取本地已 fetch 的 remote-tracking branches，不访问网络。 */
  async listRemoteBranches(remoteName?: string): Promise<GitRemoteBranch[]> {
    return this.ensureRepository().listRemoteBranches(remoteName)
  }

  /** 将 HTTPS Remote Credential 写入系统 Keychain，不修改 Git config 或 Remote URL。 */
  async setRemoteCredential(name: string, credential: GitRemoteCredential): Promise<void> {
    return this.ensureRepository().setRemoteCredential(name, credential)
  }

  /** 仅判断指定 Remote 是否已有 Keychain Credential。 */
  async hasRemoteCredential(name: string): Promise<boolean> {
    return this.ensureRepository().hasRemoteCredential(name)
  }

  /** 供未来网络操作调用；调用方不得记录或展示 password。 */
  async getRemoteCredential(name: string): Promise<GitRemoteCredential | null> {
    return this.ensureRepository().getRemoteCredential(name)
  }

  /** 删除指定 Remote Credential；不存在时保持幂等。 */
  async removeRemoteCredential(name: string): Promise<void> {
    return this.ensureRepository().removeRemoteCredential(name)
  }

  /** 仅读取当前仓库的 Remote 配置，不访问网络。 */
  async listRemotes(): Promise<GitRemoteInfo[]> {
    return this.ensureRepository().listRemotes()
  }

  /** 添加 Remote 配置，不访问网络。 */
  async addRemote(name: string, url: string): Promise<void> {
    return this.ensureRepository().addRemote(name, url)
  }

  /** 修改 Remote URL，不访问网络。 */
  async setRemoteUrl(name: string, url: string): Promise<void> {
    return this.ensureRepository().setRemoteUrl(name, url)
  }

  /** 删除 Remote 配置，不影响工作区或 Git 历史。 */
  async removeRemote(name: string): Promise<void> {
    return this.ensureRepository().removeRemote(name)
  }

  /** 仅允许 clean working tree 上的 fast-forward Pull；不产生 merge commit。 */
  async pullRemote(remoteName?: string, branchName?: string): Promise<GitPullResult> {
    return this.ensureRepository().pullRemote(remoteName, branchName)
  }

  /** 仅执行 fast-forward HTTPS Push，不会 Force、Fetch、Merge 或修改工作区。 */
  async pushRemote(remoteName?: string, branchName?: string): Promise<GitPushResult> {
    const repository = this.ensureRepository()
    const remote = remoteName || "origin"
    const branch = branchName || await repository.getCurrentBranch()
    let before: GitAheadBehind | null = null
    try {
      if (branch) before = await repository.getAheadBehind(remote, branch)
    } catch {
      before = null
    }
    const result = await repository.pushRemote(remoteName, branchName)
    if (result.pushed && branch) {
      const commitsUploaded = before ? before.ahead : (await repository.getHistory(200)).length
      const record: GitSyncRecord = {
        id: `${Date.now()}-${result.localOid}`,
        remoteName: result.remote,
        branchName: result.branch,
        targetOid: result.localOid,
        ...(result.remoteOidBefore ? { previousRemoteOid: result.remoteOidBefore } : {}),
        syncedAt: Math.floor(Date.now() / 1000),
        commitsUploaded,
        kind: "push",
      }
      try {
        await recordSync(repository.projectId || repository.projectPath, record)
      } catch (error) {
        console.error("[SyncHistory] record failed", error)
      }
    }
    return result
  }

  /** 明确以本地 HEAD 覆盖远端分支；仅用于用户二次确认后的危险操作。 */
  async forcePushLocalToRemote(remoteName = "origin", branchName?: string): Promise<{ pushed: boolean; localOid: string; previousRemoteOid?: string }> {
    const repository = this.ensureRepository()
    const remote = remoteName || "origin"
    const branch = branchName || await repository.getCurrentBranch()
    if (!branch) throw new GitSafetyError("Force Push requires a local branch.", "FORCE_PUSH_DETACHED_HEAD")
    const status = await repository.getStatus()
    if (!status.isClean) throw new GitSafetyError("Working tree must be clean before replacing GitHub history.", "FORCE_PUSH_DIRTY_WORKTREE")
    const comparison = await repository.getAheadBehind(remote, branch)
    if (comparison.localOid === null) throw new GitSafetyError("Cannot replace GitHub history from an unborn branch.", "PUSH_UNBORN_BRANCH", { branch })
    if (comparison.remoteOid === null) return { pushed: false, localOid: comparison.localOid }
    if (comparison.ahead === 0 && comparison.behind === 0) return { pushed: false, localOid: comparison.localOid, previousRemoteOid: comparison.remoteOid }
    if (!comparison.diverged && comparison.ahead === 0) throw new GitSafetyError("Force Push requires local commits that replace the remote branch.", "FORCE_PUSH_NOT_LOCAL_AHEAD", { remote, branch })
    const result = await repository.forcePushLocalToRemote(remote, branch)
    if (result.pushed) {
      const commitsUploaded = comparison.ahead
      const record: GitSyncRecord = {
        id: `${Date.now()}-${result.localOid}-force-push`,
        remoteName: result.remote,
        branchName: result.branch,
        targetOid: result.localOid,
        ...(result.previousRemoteOid ? { previousRemoteOid: result.previousRemoteOid } : {}),
        syncedAt: Math.floor(Date.now() / 1000),
        commitsUploaded,
        kind: "force-push",
      }
      try {
        await recordSync(repository.projectId || repository.projectPath, record)
      } catch (error) {
        console.error("[SyncHistory] force-push record failed", error)
      }
    }
    return { pushed: result.pushed, localOid: result.localOid, ...(result.previousRemoteOid ? { previousRemoteOid: result.previousRemoteOid } : {}) }
  }


  async ensureSyncHistoryBaseline(remoteName?: string, branchName?: string): Promise<GitSyncRecord | null> {
    const repository = this.ensureRepository()
    const remote = remoteName || "origin"
    const branch = branchName || await repository.getCurrentBranch()
    if (!branch) return null
    const remoteBranch = (await repository.listRemoteBranches(remote)).find((item) => item.name === branch)
    if (!remoteBranch || !remoteBranch.oid) return null
    const localHistory = await repository.getHistory(200)
    if (!localHistory.some((commit) => commit.oid === remoteBranch.oid)) return null
    return ensureBaseline(repository.projectId || repository.projectPath, remote, branch, remoteBranch.oid)
  }
  async listSyncRecords(remoteName?: string, branchName?: string): Promise<GitSyncRecord[]> {
    const repository = this.ensureRepository()
    return readSyncRecords(repository.projectId || repository.projectPath, remoteName, branchName)
  }

  /** 仅比较本地已有 commit graph 与 remote-tracking ref，不会自动 Fetch。 */
  async getAheadBehind(remoteName?: string, branchName?: string): Promise<GitAheadBehind> {
    return this.ensureRepository().getAheadBehind(remoteName, branchName)
  }

  /** 获取当前分支；detached HEAD 返回 null，unborn branch 返回其分支名。 */
  async getCurrentBranch(): Promise<string | null> {
    return this.ensureRepository().getCurrentBranch()
  }

  /** 获取当前仓库状态 */
  async getStatus(): Promise<GitRepositoryStatus> {
    return this.ensureRepository().getStatus()
  }

  /** 暂存单个文件 */
  async stageFile(filepath: string): Promise<void> {
    return this.ensureRepository().stageFile(filepath)
  }

  /** 取消暂存单个文件 */
  async unstageFile(filepath: string): Promise<void> {
    return this.ensureRepository().unstageFile(filepath)
  }

  /** 暂存全部更改 */
  async stageAll(): Promise<void> {
    return this.ensureRepository().stageAll()
  }

  /** 取消暂存全部更改 */
  async unstageAll(): Promise<void> {
    return this.ensureRepository().unstageAll()
  }

  /** 提交已暂存的变更。 */
  async commit(message: string, author?: GitAuthor): Promise<GitCommitResult> {
    return this.ensureRepository().commit(message, author)
  }

  /** 创建独立 Snapshot Commit/ref 归档当前变更，不改变 HEAD、index 或工作区。 */
  async createSafetySnapshot(reason: string): Promise<GitSafetySnapshotResult> {
    return this.ensureRepository().createSafetySnapshot(reason)
  }


  /** 仅读取独立 Snapshot refs，按 Commit timestamp 降序返回。 */
  async listSafetySnapshots(limit?: number): Promise<GitSafetySnapshotInfo[]> {
    return this.ensureRepository().listSafetySnapshots(limit)
  }

  /** 将独立 Snapshot Tree 恢复至干净 Working Tree，不移动 HEAD、Index 或分支。 */
  async restoreSafetySnapshot(ref: string): Promise<GitSafetySnapshotRestoreResult> {
    return this.ensureRepository().restoreSafetySnapshot(ref)
  }

  async getHistory(limit?: number): Promise<GitCommitInfo[]> {
    return this.ensureRepository().getHistory(limit)
  }

  /** 仅读取已 Fetch 的 remote-tracking ref 历史，不执行网络访问。 */
  async getRemoteHistory(remoteName?: string, branchName?: string, limit?: number): Promise<GitCommitInfo[]> {
    return this.ensureRepository().getRemoteHistory(remoteName, branchName, limit)
  }

  /** 将历史 Commit Tree 作为未暂存变更恢复到干净 Working Tree，不移动 HEAD/分支或修改 Index。 */
  async restoreCommitToWorkingTree(oid: string): Promise<GitCommitWorkingTreeRestoreResult> {
    return this.ensureRepository().restoreCommitToWorkingTree(oid)
  }

  async resetBranchToCommit(oid: string): Promise<GitBranchResetResult> {
    return this.ensureRepository().resetBranchToCommit(oid)
  }

  /** 获取单个 Commit 的元数据和文件变更。 */
  async getCommitDetail(oid: string): Promise<GitCommitDetail> {
    return this.ensureRepository().getCommitDetail(oid)
  }

  /** 安全创建一个新的 Commit 以反向应用目标 Commit。 */
  async revertCommit(oid: string): Promise<GitCommitResult> {
    return this.ensureRepository().revertCommit(oid)
  }


  async restoreFile(filepath: string, options?: { force?: boolean }): Promise<void> {
    return this.ensureRepository().restoreFile(filepath, options)
  }

  /** 获取单个文件的 Unified Diff。 */
  async getFileDiff(filepath: string, comparison: "unstaged" | "staged"): Promise<GitDiffResult> {
    return this.ensureRepository().getFileDiff(filepath, comparison)
  }

  /** 关闭当前打开的仓库上下文 */
  closeRepository(): void {
    this.currentRepo = null
  }
}
