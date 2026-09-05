import { JsonStore } from "../storage/JsonStore"
import { normalizeProjectPath } from "../path/PathPolicy"

export function canonicalizeRepoPath(path: string): string {
  const normalized = normalizeProjectPath(path)
  if (normalized === "/private/var" || normalized.startsWith("/private/var/")) {
    return normalized.slice("/private".length)
  }
  return normalized
}

export const GIT_REPOS_DIR = `${FileManager.appGroupDocumentsDirectory}/git-repos`
export const REPO_MAP_FILE = `${GIT_REPOS_DIR}/repo-map.json`

export type RepoMap = Record<string, string>

function isStringRecord(value: unknown): value is RepoMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, item]) => typeof key === "string" && typeof item === "string" && item.length > 0
  )
}

export class RepoMapStore {
  /**
   * 读取 repo-map.json
   * 遇到格式损坏时抛出异常，防止以空对象覆盖损坏文件
   */
  static async read(): Promise<RepoMap> {
    if (!(await FileManager.exists(REPO_MAP_FILE))) {
      return {}
    }
    const content = await FileManager.readAsString(REPO_MAP_FILE, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error(`[RepoMapStore] repo-map.json 文件损坏 (JSON 解析失败)，拒绝以空数据覆盖`)
    }
    if (!isStringRecord(parsed)) {
      throw new Error(`[RepoMapStore] repo-map.json 格式非法 (期望 Record<string, string>)，拒绝以空数据覆盖`)
    }
    return parsed
  }

  /**
   * 原子安全写入 repo-map.json
   */
  static async write(map: RepoMap): Promise<void> {
    await JsonStore.writeAtomic(REPO_MAP_FILE, map)
  }

  /**
   * 在 repo-map 中查找匹配的项目 gitdir
   * 支持规范化路径比较，兼容 /var 与 /private/var
   */
  static findGitdir(map: RepoMap, projectPath: string): string | undefined {
    if (map[projectPath]) return map[projectPath]
    const targetKey = canonicalizeRepoPath(projectPath)
    for (const [key, gitdir] of Object.entries(map)) {
      if (canonicalizeRepoPath(key) === targetKey) {
        return gitdir
      }
    }
    return undefined
  }

  /**
   * 设置 mapping：写入前清理相同 canonical path 的旧条目，防止 /var 与 /private/var 重复键
   */
  static async set(projectPath: string, gitdir: string): Promise<void> {
    const map = await this.read()
    const targetKey = canonicalizeRepoPath(projectPath)
    for (const key of Object.keys(map)) {
      if (canonicalizeRepoPath(key) === targetKey) {
        delete map[key]
      }
    }
    map[projectPath] = gitdir
    await this.write(map)
  }

  /**
   * 路径变更：删除 oldPath 及其同义键，新增 newPath 映射
   */
  static async move(oldPath: string, newPath: string, gitdir: string): Promise<void> {
    const map = await this.read()
    const oldKey = canonicalizeRepoPath(oldPath)
    const newKey = canonicalizeRepoPath(newPath)
    for (const key of Object.keys(map)) {
      const k = canonicalizeRepoPath(key)
      if (k === oldKey || k === newKey) {
        delete map[key]
      }
    }
    map[newPath] = gitdir
    await this.write(map)
  }

  /**
   * 移除 mapping
   */
  static async remove(projectPath: string, gitdir?: string): Promise<void> {
    const map = await this.read()
    const targetKey = canonicalizeRepoPath(projectPath)
    for (const path of Object.keys(map)) {
      if (canonicalizeRepoPath(path) === targetKey) {
        delete map[path]
      }
    }
    await this.write(map)
  }

  /**
   * 解析相对 gitdir 为完整绝对路径
   */
  static resolveGitdir(gitdir: string): string {
    return resolveGitdir(gitdir)
  }
}

export function resolveGitdir(gitdir: string): string {
  return gitdir.startsWith("/") ? gitdir : `${GIT_REPOS_DIR}/${gitdir}`
}
