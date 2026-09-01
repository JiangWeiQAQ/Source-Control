/**
 * GitSafety.ts
 * Git 操作安全校验与路径清洗，保证文件操作不会越界或破坏系统
 */

export class GitSafetyError extends Error {
  readonly code: string
  readonly data?: Record<string, unknown>

  constructor(message: string, code = "SAFETY_ERROR", data?: Record<string, unknown>) {
    super(message)
    this.name = "GitSafetyError"
    this.code = code
    this.data = data
  }
}

export class GitSafety {
  /** 校验并规范化项目根目录路径 */
  static validateProjectPath(projectPath: string): string {
    if (!projectPath || typeof projectPath !== "string") {
      throw new GitSafetyError("项目路径不能为空", "INVALID_PROJECT_PATH", { projectPath })
    }
    const trimmed = projectPath.trim().replace(/\/+$/, "")
    if (!trimmed) {
      throw new GitSafetyError("项目路径格式无效", "INVALID_PROJECT_PATH", { projectPath })
    }
    return trimmed
  }

  /**
   * 校验并规范化仓库内部相对文件路径
   * 防止路径遍历攻击（如 ../ 或绝对路径泄露）
   */
  static sanitizeRelativeFilePath(filepath: string): string {
    if (!filepath || typeof filepath !== "string") {
      throw new GitSafetyError("文件路径不能为空", "INVALID_FILE_PATH", { filepath })
    }
    let clean = filepath.trim().replace(/\\/g, "/")
    // 移除开头的 ./ 或 /
    clean = clean.replace(/^(\.\/|\/)+/, "")

    if (!clean || clean === ".") {
      return "."
    }

    const segments = clean.split("/")
    for (const segment of segments) {
      if (segment === "..") {
        throw new GitSafetyError(
          `路径包含不安全的向上遍历字符: "${filepath}"`,
          "UNSAFE_PATH_TRAVERSAL",
          { filepath }
        )
      }
    }

    if (clean.startsWith(".git/") || clean === ".git") {
      throw new GitSafetyError(
        `禁止直接操作内部 .git 元数据路径: "${filepath}"`,
        "RESTRICTED_GIT_PATH",
        { filepath }
      )
    }

    return clean
  }

  /** 严格校验受控 Safety Snapshot ref，避免该 API 被用作通用 checkout。 */
  static validateSafetySnapshotRef(ref: string): string {
    const prefix = "refs/source-control/snapshots/"
    if (!ref || typeof ref !== "string" || !ref.startsWith(prefix)) {
      throw new GitSafetyError("仅允许恢复 refs/source-control/snapshots/* 下的 Safety Snapshot", "INVALID_SNAPSHOT_REF", { ref })
    }
    const suffix = ref.slice(prefix.length)
    if (!suffix || suffix.startsWith("/") || suffix.endsWith("/") || suffix.includes("..") || suffix.includes("//") || /[\\\\\u0000-\u001f]/.test(ref)) {
      throw new GitSafetyError("Safety Snapshot ref 格式不合法", "INVALID_SNAPSHOT_REF", { ref })
    }
    return ref
  }

  /** 严格校验来自 Git Tree 的恢复路径，不允许清洗后继续使用。 */
  static validateSnapshotTreePath(filepath: string): string {
    if (!filepath || typeof filepath !== "string" || filepath.startsWith("/") || filepath.includes("\\\\") || filepath.includes("//") || /[\u0000-\u001f]/.test(filepath)) {
      throw new GitSafetyError("Snapshot Tree 包含不安全路径", "INVALID_SNAPSHOT_TREE_PATH", { filepath })
    }
    const clean = this.sanitizeRelativeFilePath(filepath)
    if (clean === "." || clean !== filepath || clean.split("/").some((segment) => segment === "." || segment === ".git")) {
      throw new GitSafetyError("Snapshot Tree 包含不安全路径", "INVALID_SNAPSHOT_TREE_PATH", { filepath })
    }
    return clean
  }


  static validateCommitMessage(message: string): string {
    if (!message || typeof message !== "string") {
      throw new GitSafetyError("Commit 提交信息不能为空", "EMPTY_COMMIT_MESSAGE")
    }
    const trimmed = message.trim()
    if (!trimmed) {
      throw new GitSafetyError("Commit 提交信息不能为空", "EMPTY_COMMIT_MESSAGE")
    }
    return trimmed
  }

  /** 校验 Safety Snapshot 原因并限制 Commit message 长度。 */
  static validateSafetySnapshotReason(reason: string): string {
    if (!reason || typeof reason !== "string") {
      throw new GitSafetyError("Snapshot 原因不能为空", "EMPTY_SNAPSHOT_REASON")
    }
    const trimmed = reason.trim()
    if (!trimmed) {
      throw new GitSafetyError("Snapshot 原因不能为空", "EMPTY_SNAPSHOT_REASON")
    }
    if (trimmed.length > 160) {
      throw new GitSafetyError("Snapshot 原因不能超过 160 个字符", "SNAPSHOT_REASON_TOO_LONG")
    }
    return trimmed
  }


  static formatErrorMessage(error: unknown, fallbackAction: string): string {
    if (!error) return `${fallbackAction} 失败: 未知错误`
    if (error instanceof GitSafetyError) {
      return `[安全拦截] ${error.message}`
    }
    const msg = error instanceof Error ? error.message : String(error)
    const errCode = (error as { code?: string })?.code

    if (errCode === "NotFoundError" || msg.includes("ENOENT") || msg.includes("Could not find")) {
      return `${fallbackAction} 失败: 指定的文件或引用不存在`
    }
    if (errCode === "CheckoutConflictError" || msg.includes("CheckoutConflictError")) {
      return `${fallbackAction} 失败: 本地存在未提交的修改冲突，无法安全覆盖`
    }
    if (errCode === "MergeConflictError" || msg.includes("MergeConflictError")) {
      return `${fallbackAction} 失败: 存在代码冲突，请先解决冲突`
    }
    if (errCode === "InvalidRefNameError") {
      return `${fallbackAction} 失败: 分支或引用名称不合法`
    }
    if (errCode === "NoCommitError") {
      return `${fallbackAction} 失败: 当前仓库尚未创建任何提交`
    }
    return `${fallbackAction} 失败: ${msg}`
  }
}
