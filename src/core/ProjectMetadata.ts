import { GitSafety } from "./GitSafety"
import {
  ProjectRegistry,
  ProjectMetadata,
  ProjectRecord,
  ProjectSource,
  RelocationCandidate,
  PROJECTS_FILE,
  MANAGED_PROJECTS_FILE,
  AUTOMATED_TEST_PROJECT_PREFIXES,
  generateProjectId,
  toSafeRepoName,
  isAutomatedTestDirectory,
  isRelocationFixtureProject,
  hasSourceControlConfiguration,
} from "./project/ProjectRegistry"
import { RepoMapStore, GIT_REPOS_DIR, REPO_MAP_FILE, resolveGitdir } from "./project/RepoMapStore"
import { normalizeProjectPath, sameProjectPath } from "./path/PathPolicy"

export {
  PROJECTS_FILE,
  MANAGED_PROJECTS_FILE,
  AUTOMATED_TEST_PROJECT_PREFIXES,
  generateProjectId,
  toSafeRepoName,
  isAutomatedTestDirectory,
  isRelocationFixtureProject,
  hasSourceControlConfiguration,
  resolveGitdir,
}
export type { ProjectMetadata, ProjectRecord, ProjectSource, RelocationCandidate }

export function samePath(a: string, b: string): boolean {
  return sameProjectPath(a, b)
}

export function canonicalizeProjectPath(path: string): string {
  return normalizeProjectPath(path)
}

/**
 * ProjectMetadataManager
 * 兼容包装层：所有操作全权委托给单例 ProjectRegistry 与 RepoMapStore，
 * 不再保留第二套独立的持久化与 mapping 写入逻辑。
 */
export class ProjectMetadataManager {
  private static get registry(): ProjectRegistry {
    return ProjectRegistry.getInstance()
  }

  /**
   * 读取 repo-map.json
   */
  static async readRepoMap(): Promise<Record<string, string>> {
    return RepoMapStore.read()
  }

  /**
   * 写入 repo-map.json（委托 RepoMapStore）
   */
  static async writeRepoMap(map: Record<string, string>): Promise<void> {
    await RepoMapStore.write(map)
  }

  static async loadConfiguredProjects(): Promise<Record<string, ProjectRecord>> {
    return this.registry.loadConfiguredProjects()
  }

  static async loadProjects(): Promise<Record<string, ProjectRecord>> {
    return this.registry.loadProjects()
  }

  /**
   * 原子写入 JSON 文件（委托 JsonStore）
   */
  static async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    const { JsonStore } = await import("./storage/JsonStore")
    await JsonStore.writeAtomic(filePath, data)
  }

  /**
   * 写入 projects.json（委托 ProjectRegistry）
   */
  static async writeProjects(records: Record<string, ProjectRecord>): Promise<void> {
    await this.registry.writeProjects(records)
  }

  /**
   * 从旧版 repo-map.json 和 managed-projects.json 迁移
   */
  static async migrateLegacyData(): Promise<Record<string, ProjectRecord>> {
    return this.registry.migrateLegacyData()
  }

  /**
   * 获取或注册项目的 ProjectRecord
   */
  static async getOrCreateProject(projectPath: string, customRepoName?: string): Promise<ProjectRecord> {
    return this.registry.getOrCreateProject(projectPath, customRepoName)
  }

  static async selectProjectFolder(
    projectPath: string,
    customDisplayName?: string,
    preferredProjectId?: string
  ): Promise<ProjectRecord> {
    const validPath = GitSafety.validateProjectPath(projectPath)
    if (!(await FileManager.exists(validPath)) || !(await FileManager.isDirectory(validPath))) {
      throw new Error("选择的路径不是可用文件夹")
    }
    const projects = await this.registry.loadProjects()
    const selectedName = validPath.split("/").filter(Boolean).pop() || "project"
    if (preferredProjectId && projects[preferredProjectId]) {
      return this.registry.updateProjectPath(preferredProjectId, validPath, customDisplayName || selectedName, { source: "manual" })
    }
    const exact = Object.values(projects).find((project) => this.registry.isSamePath(project.projectPath, validPath))
    if (exact) {
      const manual = await this.registry.markProjectManual(exact.projectId)
      if (customDisplayName && customDisplayName !== manual.displayName) {
        return this.registry.updateProjectPath(manual.projectId, validPath, customDisplayName, { source: "manual" })
      }
      return manual
    }

    let selectedScriptName: string | undefined
    const scriptPath = `${validPath}/script.json`
    if (await FileManager.exists(scriptPath)) {
      try {
        const script = JSON.parse(await FileManager.readAsString(scriptPath, "utf8")) as { name?: string }
        selectedScriptName = script.name
      } catch {
        selectedScriptName = undefined
      }
    }

    const matches: Array<{ project: ProjectRecord; score: number }> = []
    for (const project of Object.values(projects)) {
      if (isRelocationFixtureProject(project) || this.registry.isSamePath(project.projectPath, validPath)) continue
      const gitdir = resolveGitdir(project.gitdir)
      if (!(await FileManager.exists(`${gitdir}/HEAD`))) continue
      let score = 20
      if (selectedScriptName && selectedScriptName === project.displayName) score += 40
      if (selectedName.toLowerCase() === project.displayName.toLowerCase()) score += 25
      else if (
        selectedName.toLowerCase().includes(project.displayName.toLowerCase()) ||
        project.displayName.toLowerCase().includes(selectedName.toLowerCase())
      ) {
        score += 10
      }
      for (const file of ["script.json", "index.tsx", "README.md", "package.json"]) {
        if (await FileManager.exists(`${validPath}/${file}`)) score += 5
      }
      matches.push({ project, score })
    }

    matches.sort((left, right) => right.score - left.score)
    const best = matches[0]
    const second = matches[1]
    if (best && best.score >= 60 && (!second || best.score > second.score)) {
      return this.registry.updateProjectPath(best.project.projectId, validPath, customDisplayName || selectedName, { source: "manual" })
    }
    const created = await this.registry.getOrCreateProject(validPath)
    if (customDisplayName && customDisplayName !== created.displayName) {
      return this.registry.updateProjectPath(created.projectId, validPath, customDisplayName, { source: "manual" })
    }
    return this.registry.markProjectManual(created.projectId)
  }

  static async removeProjectRecord(projectId: string): Promise<void> {
    await this.registry.removeProject(projectId)
  }

  static async updateHeadOid(projectId: string, headOid: string): Promise<void> {
    const projects = await this.registry.loadProjects()
    if (projects[projectId]) {
      projects[projectId].lastKnownHeadOid = headOid
      projects[projectId].updatedAt = Date.now()
      await this.registry.writeProjects(projects)
    }
  }

  /**
   * 更新项目路径与重定位（委托 ProjectRegistry）
   */
  static async updateProjectRelocation(
    projectId: string,
    newPath: string,
    newDisplayName?: string,
    options?: { injectFailAt?: "projects" | "repo-map"; source?: ProjectSource }
  ): Promise<ProjectRecord> {
    return this.registry.updateProjectPath(projectId, newPath, newDisplayName, options)
  }

  /**
   * 扫描 scriptsDirectory，为失效的项目寻找候选目录并评分
   */
  static async findCandidates(
    record: ProjectRecord,
    baseScriptsDir?: string
  ): Promise<RelocationCandidate[]> {
    return this.registry.findCandidates(record, baseScriptsDir)
  }

  /**
   * 尝试自动重定位项目
   */
  static async attemptAutoRelocation(
    recordOrProjectId: ProjectRecord | string,
    baseScriptsDir?: string
  ): Promise<{ success: boolean; candidate?: RelocationCandidate; record?: ProjectRecord; reason?: string }> {
    const projects = await this.registry.loadProjects()
    const record =
      typeof recordOrProjectId === "string"
        ? projects[recordOrProjectId]
        : recordOrProjectId
    if (!record) {
      return { success: false, reason: "项目记录不存在" }
    }

    if (await FileManager.exists(record.projectPath)) {
      return { success: true, record }
    }

    const candidates = await this.findCandidates(record, baseScriptsDir)
    if (candidates.length === 0) {
      return { success: false, reason: "未发现任何候选重命名项目目录" }
    }

    const best = candidates[0]
    const second = candidates[1]

    if (best.score < 50) {
      return {
        success: false,
        candidate: best,
        reason: `最高分候选置信度不足 (${best.score} < 50)，放弃自动迁移`,
      }
    }

    if (second && best.score - second.score < 20) {
      return {
        success: false,
        candidate: best,
        reason: `存在多个高相似度候选（${best.displayName}: ${best.score} vs ${second.displayName}: ${second.score}），需人工确认`,
      }
    }

    try {
      const updated = await this.updateProjectRelocation(record.projectId, best.path, best.displayName)
      return {
        success: true,
        candidate: best,
        record: updated,
      }
    } catch (err) {
      return {
        success: false,
        candidate: best,
        reason: `重定位写入失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * 清理自动化测试 Fixture（委托 ProjectRegistry）
   */
  static async cleanupProjectFixture(
    projectIds: string[],
    fixturePaths: string[],
    gitdirs: string[]
  ): Promise<void> {
    await this.registry.cleanupProjectFixture(projectIds, fixturePaths, gitdirs)
    for (const path of fixturePaths) {
      if (await FileManager.exists(path)) await FileManager.remove(path)
    }
    for (const gitdir of gitdirs) {
      const resolved = resolveGitdir(gitdir)
      if (await FileManager.exists(resolved)) await FileManager.remove(resolved)
    }
  }

  static async convergeDuplicates(records?: Record<string, ProjectRecord>): Promise<Record<string, ProjectRecord>> {
    const projects = records || (await this.registry.loadProjects())
    return this.registry.convergeDuplicates(projects)
  }

  static async removeProject(idOrPath: string): Promise<void> {
    const projects = await this.registry.loadProjects()
    const target = Object.values(projects).find(
      (p) => p.projectId === idOrPath || sameProjectPath(p.projectPath, idOrPath)
    )
    if (target) {
      await this.registry.removeProject(target.projectId)
    }
  }
}

export const ensureProjectMetadata = ProjectMetadataManager.getOrCreateProject.bind(ProjectMetadataManager)
export const selectProjectFolder = ProjectMetadataManager.selectProjectFolder.bind(ProjectMetadataManager)
export const listAllProjects = async (): Promise<ProjectRecord[]> => {
  const map = await ProjectMetadataManager.loadConfiguredProjects()
  return Object.values(map)
}
export const findRelocationCandidates = ProjectMetadataManager.findCandidates.bind(ProjectMetadataManager)
export const tryAutoRelocateProject = async (
  recordOrProjectId: ProjectRecord | string,
  baseScriptsDir?: string
): Promise<ProjectRecord | null> => {
  const result = await ProjectMetadataManager.attemptAutoRelocation(recordOrProjectId, baseScriptsDir)
  return result.success && result.record ? result.record : null
}
export const manualRelocateProject = ProjectMetadataManager.updateProjectRelocation.bind(ProjectMetadataManager)

export { ProjectRegistry }
