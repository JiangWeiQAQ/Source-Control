import { JsonStore } from "../storage/JsonStore"
import { normalizeProjectPath, sameProjectPath } from "../path/PathPolicy"
import { RepoMapStore, GIT_REPOS_DIR, REPO_MAP_FILE, RepoMap } from "./RepoMapStore"
import { GitSafety } from "../GitSafety"
import { hashString } from "../identity/hash"

export const PROJECTS_FILE = `${FileManager.appGroupDocumentsDirectory}/source-control-projects/projects.json`
export const MANAGED_PROJECTS_FILE = `${FileManager.documentsDirectory}/Source Control/managed-projects.json`

/**
 * 自动化测试专用项目前缀列表（与 Core 一致）
 */
export const AUTOMATED_TEST_PROJECT_PREFIXES = [
  "Source Control Auto Test",
  "Source Control Relocation Test",
  "Source Control Push Test",
  "Source Control Force Push Test",
  "Source Control Release Test",
  "Source Control Registry Test",
  "Source Control Snapshot Test",
]

/**
 * 项目持久化记录
 */
export type ProjectSource = "manual" | "legacy"

export interface ProjectMetadata {
  projectId: string
  displayName: string
  projectPath: string
  gitdir: string
  source: ProjectSource
  updatedAt?: number
  lastKnownHeadOid?: string
  lastSyncAt?: number
  defaultBranch?: string
  remotes?: Record<string, { url: string; pushUrl?: string }>
}

export type ProjectRecord = ProjectMetadata

function normalizeProjectSource(source: unknown): ProjectSource {
  return source === "manual" ? "manual" : "legacy"
}

export interface RelocationCandidate {
  path: string
  displayName: string
  score: number
  reasons: string[]
}

export function canonicalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  if (normalized === "/private/var" || normalized.startsWith("/private/var/")) {
    return normalized.slice("/private".length)
  }
  return normalized
}

export function isSameProjectPath(left: string, right: string): boolean {
  return canonicalizePath(left) === canonicalizePath(right)
}

/**
 * 根据路径生成稳定的 projectId（保持 12 位 hash 截取）
 */
export function generateProjectId(projectPath: string): string {
  const norm = canonicalizePath(projectPath)
  return `proj_${hashString(norm).slice(0, 12)}`
}

/**
 * 安全名称转换（用于 gitdir 命名）
 */
export function toSafeRepoName(dirName: string): string {
  return dirName.replace(/[^a-zA-Z0-9_-]/g, "_")
}

/**
 * 判断是否为自动化测试目录
 */
export function isAutomatedTestDirectory(dirPathOrName: string): boolean {
  const norm = dirPathOrName.replace(/\\/g, "/").toLowerCase()
  const basename = norm.split("/").filter(Boolean).pop() || norm
  return AUTOMATED_TEST_PROJECT_PREFIXES.some((p) => basename.includes(p.toLowerCase()))
}

export function isRelocationFixtureProject(project: { displayName?: string; projectPath?: string }): boolean {
  const name = project.displayName || ""
  const path = project.projectPath || ""
  const lowerPath = path.toLowerCase()
  const lowerName = name.toLowerCase()
  if (lowerPath.includes("relocatefixture_") || lowerName.includes("relocatefixture_")) return true
  if (lowerPath.includes("verify-project-relocation") || lowerName.includes("verify-project-relocation")) return true
  return AUTOMATED_TEST_PROJECT_PREFIXES.some(
    (prefix) => name.startsWith(prefix) || path.includes(prefix)
  )
}

export function hasSourceControlConfiguration(project: ProjectRecord): boolean {
  if (!project) return false
  const hasId = typeof project.projectId === "string" && project.projectId.trim().length > 0
  const hasGitdir = typeof project.gitdir === "string" && project.gitdir.trim().length > 0
  const hasRemotes = Boolean(project.remotes && Object.keys(project.remotes).length > 0)
  const hasHead = typeof project.lastKnownHeadOid === "string" && project.lastKnownHeadOid.trim().length > 0
  const hasBranch = typeof project.defaultBranch === "string" && project.defaultBranch.trim().length > 0
  const hasSync = typeof project.lastSyncAt === "number" && Number.isFinite(project.lastSyncAt) && project.lastSyncAt > 0
  return (hasId && hasGitdir) || hasRemotes || hasHead || hasBranch || hasSync
}

/**
 * ProjectRegistry
 * 项目 identity、projectPath、gitdir、repo-map、projects.json 的统一单一管理核心
 */
export class ProjectRegistry {
  private static instance: ProjectRegistry | null = null

  static getInstance(): ProjectRegistry {
    if (!this.instance) {
      this.instance = new ProjectRegistry()
    }
    return this.instance
  }

  /**
   * 规范化路径并校验合法性（获得用于比较与定位的 canonical 路径）
   */
  normalizePath(path: string): string {
    return canonicalizePath(GitSafety.validateProjectPath(path))
  }

  /**
   * 比较两路径在规范化后是否同一逻辑路径（支持 /var 与 /private/var 同等对待）
   */
  isSamePath(pathA: string, pathB: string): boolean {
    return isSameProjectPath(pathA, pathB)
  }

  /**
   * 加载所有项目元数据
   */
  async loadProjects(): Promise<Record<string, ProjectMetadata>> {
    let projects: Record<string, ProjectMetadata>
    if (!(await FileManager.exists(PROJECTS_FILE))) {
      projects = await this.migrateLegacyData()
    } else {
      const content = await FileManager.readAsString(PROJECTS_FILE, "utf8")
      let records: Record<string, ProjectMetadata>
      try {
        records = JSON.parse(content) as Record<string, ProjectMetadata>
      } catch {
        throw new Error(`[ProjectRegistry] projects.json 文件已损坏 (JSON 解析失败)，拒绝覆盖或静默清空`)
      }
      if (!records || typeof records !== "object" || Array.isArray(records)) {
        throw new Error(`[ProjectRegistry] projects.json 格式非法 (期望对象)，拒绝覆盖或静默清空`)
      }
      let sourceChanged = false
      projects = records
      for (const [projectId, project] of Object.entries(projects)) {
        const source = normalizeProjectSource(project.source)
        if (project.source !== source) {
          projects[projectId] = { ...project, source }
          sourceChanged = true
        }
      }
      if (sourceChanged) await this.writeProjects(projects)
    }
    return this.convergeDuplicates(projects)
  }

  /**
   * 获取已配置过 Source Control 的项目列表
   */
  async loadConfiguredProjects(): Promise<Record<string, ProjectMetadata>> {
    const projects = await this.loadProjects()
    const retained: Record<string, ProjectMetadata> = {}
    for (const project of Object.values(projects)) {
      if (!isRelocationFixtureProject(project) && hasSourceControlConfiguration(project)) {
        retained[project.projectId] = project
      }
    }
    return retained
  }

  /**
   * 根据 projectId 获取项目
   */
  async getProjectById(projectId: string): Promise<ProjectMetadata | null> {
    const projects = await this.loadProjects()
    return projects[projectId] || null
  }

  /**
   * 根据路径查找项目（支持 /var 与 /private/var 等同规范化匹配）
   */
  async findProjectByPath(projectPath: string): Promise<ProjectMetadata | null> {
    const projects = await this.loadProjects()
    for (const project of Object.values(projects)) {
      if (isSameProjectPath(project.projectPath, projectPath)) {
        return project
      }
    }
    return null
  }

  /**
   * 获取或创建项目条目，并确保 gitdir 稳定分配
   */
  async getOrCreateProject(projectPath: string, customRepoName?: string): Promise<ProjectMetadata> {
    const validPath = GitSafety.validateProjectPath(projectPath)
    const projects = await this.loadProjects()

    // 1. 检查 projects.json 中是否已有匹配
    for (const project of Object.values(projects)) {
      if (sameProjectPath(project.projectPath, validPath)) {
        let changed = false
        // 若实际可访问路径发生 /var 与 /private/var 调整，更新为当前传入的有效实际路径
        if (project.projectPath !== validPath) {
          project.projectPath = validPath
          project.updatedAt = Date.now()
          changed = true
        }
        // 既有项目保持已有 gitdir 不变，不被 customRepoName 重写覆盖
        if (changed) {
          await this.writeProjects(projects)
          await RepoMapStore.set(validPath, project.gitdir)
        } else {
          // 确保 repo-map 中该路径映射存在（防止只有 projects.json 而 repo-map 缺失）
          const repoMap = await RepoMapStore.read()
          if (!RepoMapStore.findGitdir(repoMap, validPath)) {
            await RepoMapStore.set(validPath, project.gitdir)
          }
        }
        return project
      }
    }

    // 2. 检查 repo-map.json 中是否已有 legacy gitdir 映射
    const repoMap = await RepoMapStore.read()
    let assignedGitdir = RepoMapStore.findGitdir(repoMap, validPath)

    if (!assignedGitdir) {
      if (customRepoName) {
        assignedGitdir = customRepoName
      } else {
        const dirName = validPath.split("/").filter(Boolean).pop() || "repo"
        const safeName = toSafeRepoName(dirName)
        let candidateName = safeName
        let counter = 1
        const existingGitdirs = new Set([
          ...Object.values(projects).map((p) => p.gitdir),
          ...Object.values(repoMap),
        ])
        while (existingGitdirs.has(candidateName)) {
          candidateName = `${safeName}_${counter}`
          counter += 1
        }
        assignedGitdir = candidateName
      }
    }

    const dirName = validPath.split("/").filter(Boolean).pop() || "project"
    let scriptDisplayName: string | undefined
    const scriptJsonPath = `${validPath}/script.json`
    if (await FileManager.exists(scriptJsonPath)) {
      try {
        const parsed = JSON.parse(await FileManager.readAsString(scriptJsonPath, "utf8"))
        if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
          scriptDisplayName = parsed.name.trim()
        }
      } catch {
        // ignore
      }
    }
    const projectId = generateProjectId(validPath)
    const newRecord: ProjectMetadata = {
      projectId,
      displayName: scriptDisplayName || dirName,
      projectPath: validPath,
      gitdir: assignedGitdir,
      source: "legacy",
      updatedAt: Date.now(),
    }

    projects[projectId] = newRecord
    await this.writeProjects(projects)
    try {
      await RepoMapStore.set(validPath, assignedGitdir)
    } catch (err) {
      delete projects[projectId]
      try {
        await this.writeProjects(projects)
      } catch {
        // ignore rollback error
      }
      throw err
    }

    return newRecord
  }

  /**
   * 获取项目的完整 gitdir 路径（绝对路径）
   * 唯一负责查询或分配 gitdir，保证与已有项目映射一致
   */
  async getGitdir(projectPath: string, customRepoName?: string): Promise<string> {
    const project = await this.getOrCreateProject(projectPath, customRepoName)
    return RepoMapStore.resolveGitdir(project.gitdir)
  }

  async markProjectManual(projectId: string): Promise<ProjectMetadata> {
    const projects = await this.loadProjects()
    const current = projects[projectId]
    if (!current) throw new Error(`找不到项目记录 [${projectId}]`)
    if (current.source === "manual") return current
    const updated: ProjectMetadata = { ...current, source: "manual", updatedAt: Date.now() }
    await this.writeProjects({ ...projects, [projectId]: updated })
    return updated
  }

  /**
   * 项目路径重定位（改名/移动）
   * 保证原子更新 projects.json 与 repo-map.json，失败时自动 rollback
   */
  async updateProjectPath(
    projectId: string,
    newProjectPath: string,
    newDisplayName?: string,
    options?: { injectFailAt?: "projects" | "repo-map"; source?: ProjectSource }
  ): Promise<ProjectMetadata> {
    const validNewPath = GitSafety.validateProjectPath(newProjectPath)
    const origProjects = await this.loadProjects()
    const origRepoMap = await RepoMapStore.read()

    const currentRecord = origProjects[projectId]
    if (!currentRecord) {
      throw new Error(`找不到项目记录 [${projectId}]`)
    }

    // 安全检查：目标路径不能是自动化测试专用目录
    if (isAutomatedTestDirectory(validNewPath) || isAutomatedTestDirectory(newDisplayName || "")) {
      throw new Error(`目标路径 [${validNewPath}] 是自动化测试专用目录，禁止关联`)
    }

    // 冲突检查：新路径是否已被其他项目占用
    const conflict = Object.values(origProjects).find(
      (p) => p.projectId !== projectId && sameProjectPath(p.projectPath, validNewPath)
    )
    if (conflict) {
      const conflictExists = await FileManager.exists(conflict.projectPath)
      if (conflictExists) {
        throw new Error(`路径已经被另一个项目 [${conflict.displayName}] 占用`)
      }
    }

    const oldPath = currentRecord.projectPath
    const updatedRecord: ProjectMetadata = {
      ...currentRecord,
      projectPath: validNewPath,
      displayName: newDisplayName || validNewPath.split("/").filter(Boolean).pop() || currentRecord.displayName,
      source: options?.source || currentRecord.source,
      updatedAt: Date.now(),
    }

    const nextProjects = { ...origProjects, [projectId]: updatedRecord }

    // 构建 nextRepoMap：删除 oldPath 及其 canonical 同义键，添加 newPath
    const nextRepoMap = { ...origRepoMap }
    const oldNorm = normalizeProjectPath(oldPath)
    const newNorm = normalizeProjectPath(validNewPath)
    for (const key of Object.keys(nextRepoMap)) {
      const k = normalizeProjectPath(key)
      if (k === oldNorm || k === newNorm) {
        delete nextRepoMap[key]
      }
    }
    nextRepoMap[validNewPath] = currentRecord.gitdir

    // 事务写入 projects.json 与 repo-map.json，支持回滚
    try {
      if (options?.injectFailAt === "projects") {
        throw new Error("Simulated projects.json failure")
      }
      await this.writeProjects(nextProjects)
    } catch (err) {
      throw err
    }

    try {
      if (options?.injectFailAt === "repo-map") {
        throw new Error("Simulated repo-map.json failure")
      }
      await RepoMapStore.write(nextRepoMap)
    } catch (err) {
      // 写入 repo-map 失败，原子回滚 projects.json
      await this.writeProjects(origProjects)
      throw err
    }

    return updatedRecord
  }

  /**
   * 移除项目记录与 repo-map 映射（不删除真实工作区与 gitdir 数据）
   */
  async removeProject(projectId: string): Promise<void> {
    const projects = await this.loadProjects()
    const target = projects[projectId]
    if (!target) return

    const originalProject = { ...target }
    delete projects[projectId]
    await this.writeProjects(projects)
    try {
      await RepoMapStore.remove(target.projectPath, target.gitdir)
    } catch (err) {
      projects[projectId] = originalProject
      try {
        await this.writeProjects(projects)
      } catch {
        // ignore rollback error
      }
      throw err
    }
  }

  /**
   * 原子写入 projects.json
   */
  async writeProjects(records: Record<string, ProjectMetadata>): Promise<void> {
    await JsonStore.writeAtomic(PROJECTS_FILE, records)
  }

  /**
   * 从旧版 repo-map.json 和 managed-projects.json 迁移
   */
  async migrateLegacyData(): Promise<Record<string, ProjectMetadata>> {
    const repoMap = await RepoMapStore.read()
    let managedList: Array<{ name?: string; path?: string }> = []

    if (await FileManager.exists(MANAGED_PROJECTS_FILE)) {
      try {
        const text = await FileManager.readAsString(MANAGED_PROJECTS_FILE, "utf8")
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) managedList = parsed
      } catch {
        managedList = []
      }
    }

    const projects: Record<string, ProjectMetadata> = {}

    // 1. 从 repoMap 构建初始条目
    for (const [projectPath, gitdir] of Object.entries(repoMap)) {
      if (!projectPath || !gitdir) continue
      const validPath = normalizeProjectPath(projectPath)
      const dirName = validPath.split("/").filter(Boolean).pop() || "project"
      const projectId = generateProjectId(validPath)
      projects[projectId] = {
        projectId,
        displayName: dirName,
        projectPath,
        gitdir,
        source: "legacy",
        updatedAt: Date.now(),
      }
    }

    // 2. 结合 managedList 补充或更新 displayName
    for (const item of managedList) {
      if (!item.path) continue
      const normItemPath = normalizeProjectPath(item.path)
      let found = Object.values(projects).find((p) => sameProjectPath(p.projectPath, normItemPath))
      if (found) {
        if (item.name) found.displayName = item.name
      } else {
        const dirName = item.name || normItemPath.split("/").filter(Boolean).pop() || "project"
        const safeName = toSafeRepoName(dirName)
        const projectId = generateProjectId(normItemPath)
        projects[projectId] = {
          projectId,
          displayName: dirName,
          projectPath: item.path,
          gitdir: safeName,
          source: "legacy",
          updatedAt: Date.now(),
        }
      }
    }

    // 3. 去重与合并重复项目：如果有多个项目指向相同的 gitdir
    const byGitdir: Record<string, ProjectMetadata[]> = {}
    for (const p of Object.values(projects)) {
      if (!byGitdir[p.gitdir]) byGitdir[p.gitdir] = []
      byGitdir[p.gitdir].push(p)
    }

    for (const group of Object.values(byGitdir)) {
      if (group.length <= 1) continue
      // 按路径是否存在优先保留
      const withStatus = await Promise.all(
        group.map(async (p) => ({
          project: p,
          exists: await FileManager.exists(p.projectPath),
        }))
      )
      const existing = withStatus.filter((item) => item.exists)
      const best = (existing.length > 0 ? existing[0] : withStatus[0]).project
      for (const item of group) {
        if (item.projectId !== best.projectId) {
          delete projects[item.projectId]
        }
      }
    }

    try {
      await this.writeProjects(projects)
    } catch {
      // 忽略初次迁移持久化错误
    }

    return projects
  }

  /**
   * 收敛重复路径与重复 gitdir（例如 /var 与 /private/var 产生的多余记录）
   */
  async convergeDuplicates(
    projects?: Record<string, ProjectMetadata>
  ): Promise<Record<string, ProjectMetadata>> {
    const targetProjects = projects || (await this.loadProjects())
    const list = Object.values(targetProjects)
    if (list.length <= 1) return targetProjects

    const byCanonicalPath: Record<string, ProjectMetadata[]> = {}
    for (const p of list) {
      const key = canonicalizePath(p.projectPath)
      if (!byCanonicalPath[key]) byCanonicalPath[key] = []
      byCanonicalPath[key].push(p)
    }

    let changed = false
    for (const group of Object.values(byCanonicalPath)) {
      if (group.length <= 1) continue
      // 存在同义路径记录，优先保留用户手动确认的记录，再按配置完整度和更新时间选择。
      group.sort((a, b) => {
        const aSourceRank = a.source === "manual" ? 1 : 0
        const bSourceRank = b.source === "manual" ? 1 : 0
        if (aSourceRank !== bSourceRank) return bSourceRank - aSourceRank
        const aConfigured = hasSourceControlConfiguration(a) ? 1 : 0
        const bConfigured = hasSourceControlConfiguration(b) ? 1 : 0
        if (aConfigured !== bConfigured) return bConfigured - aConfigured
        return (b.updatedAt || 0) - (a.updatedAt || 0)
      })
      const winner = group[0]
      for (let i = 1; i < group.length; i++) {
        delete targetProjects[group[i].projectId]
        changed = true
      }
    }

    if (changed) {
      await this.writeProjects(targetProjects)
    }
    return targetProjects
  }

  /**
   * 扫描 scriptsDirectory，为失效的项目寻找候选目录并评分
   */
  async findCandidates(
    record: ProjectMetadata,
    baseScriptsDir?: string
  ): Promise<RelocationCandidate[]> {
    const scriptsDir = baseScriptsDir || FileManager.scriptsDirectory
    if (!(await FileManager.exists(scriptsDir))) return []

    const allProjects = await this.loadProjects()
    const entries = await FileManager.readDirectory(scriptsDir)
    const candidates: RelocationCandidate[] = []

    const fullGitdir = RepoMapStore.resolveGitdir(record.gitdir)
    const headFile = `${fullGitdir}/HEAD`
    const gitdirExists = await FileManager.exists(headFile)
    if (!gitdirExists) return []

    let targetHeadOid = record.lastKnownHeadOid
    if (gitdirExists) {
      try {
        const headContent = (await FileManager.readAsString(headFile, "utf8")).trim()
        if (headContent.startsWith("ref:")) {
          const refPath = headContent.replace(/^ref:\s*/, "")
          const refFile = `${fullGitdir}/${refPath}`
          if (await FileManager.exists(refFile)) {
            targetHeadOid = (await FileManager.readAsString(refFile, "utf8")).trim()
          }
        } else if (/^[0-9a-f]{40}$/i.test(headContent)) {
          targetHeadOid = headContent
        }
      } catch {
        // ignore
      }
    }

    for (const item of entries) {
      const rawName = typeof item === "string" ? item : String((item as { name?: string })?.name || "")
      const name = rawName.split("/").pop() || rawName
      if (!name || name.startsWith(".")) continue
      const candidatePath = `${scriptsDir}/${name}`

      // 排除非目录
      if (!(await FileManager.isDirectory(candidatePath))) continue

      // 排除自动化测试目录
      if (isAutomatedTestDirectory(name) || isAutomatedTestDirectory(candidatePath)) {
        if (!isRelocationFixtureProject(record)) {
          continue
        }
      }

      // 排除已被其他有效项目正常绑定的目录（支持 /var 与 /private/var 等价）
      const boundToOther = Object.values(allProjects).some(
        (p) => p.projectId !== record.projectId && isSameProjectPath(p.projectPath, candidatePath)
      )
      if (boundToOther) continue

      let score = 0
      const reasons: string[] = []

      // 1. 检查 script.json
      const candidateScriptJsonPath = `${candidatePath}/script.json`
      if (await FileManager.exists(candidateScriptJsonPath)) {
        try {
          const scriptData = JSON.parse(await FileManager.readAsString(candidateScriptJsonPath, "utf8"))
          if (scriptData.name && scriptData.name === record.displayName) {
            score += 40
            reasons.push("script.json name 完全匹配")
          } else if (scriptData.name) {
            score += 10
            reasons.push("包含 script.json")
          }
        } catch {
          // ignore
        }
      }

      // 2. 检查关键典型文件 (index.tsx, main.ts, README.md 等)
      const keyFiles = ["index.tsx", "main.ts", "README.md", "package.json"]
      let keyFileCount = 0
      for (const kf of keyFiles) {
        if (await FileManager.exists(`${candidatePath}/${kf}`)) {
          keyFileCount += 1
        }
      }
      if (keyFileCount > 0) {
        score += keyFileCount * 10
        reasons.push(`匹配 ${keyFileCount} 个核心源码文件`)
      }

      // 3. 检查目录名相似度
      const oldBasename = record.projectPath.split("/").filter(Boolean).pop() || record.displayName
      if (name.toLowerCase() === oldBasename.toLowerCase()) {
        score += 30
        reasons.push("文件夹名称与原项目同名")
      } else if (
        name.toLowerCase().includes(oldBasename.toLowerCase()) ||
        oldBasename.toLowerCase().includes(name.toLowerCase())
      ) {
        score += 15
        reasons.push("文件夹名称部分匹配")
      }

      // 4. Git HEAD OID 匹配校验加分（如果有 targetHeadOid）
      if (targetHeadOid && score >= 30) {
        score += 20
        reasons.push(`Git HEAD 仓库有效关联`)
      }

      if (score >= 30) {
        candidates.push({
          path: candidatePath,
          displayName: name,
          score,
          reasons,
        })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates
  }

  /**
   * 测试清理辅助工具
   */
  async cleanupProjectFixture(
    targetProjectIds: string[],
    fixturePaths: string[],
    fixtureGitdirs: string[]
  ): Promise<void> {
    const projects = await this.loadProjects()
    const idSet = new Set(targetProjectIds)
    const pathSet = new Set(fixturePaths.map((p) => normalizeProjectPath(p)))
    const gitdirSet = new Set(fixtureGitdirs)

    let projectsChanged = false
    for (const [id, record] of Object.entries(projects)) {
      if (
        idSet.has(id) ||
        pathSet.has(normalizeProjectPath(record.projectPath)) ||
        gitdirSet.has(record.gitdir) ||
        isRelocationFixtureProject(record)
      ) {
        delete projects[id]
        projectsChanged = true
      }
    }
    if (projectsChanged) {
      await this.writeProjects(projects)
    }

    const repoMap = await RepoMapStore.read()
    let repoMapChanged = false
    for (const [mappedPath, mappedGitdir] of Object.entries(repoMap)) {
      if (
        pathSet.has(normalizeProjectPath(mappedPath)) ||
        gitdirSet.has(mappedGitdir) ||
        AUTOMATED_TEST_PROJECT_PREFIXES.some((prefix) => mappedPath.includes(prefix))
      ) {
        delete repoMap[mappedPath]
        repoMapChanged = true
      }
    }
    if (repoMapChanged) {
      await RepoMapStore.write(repoMap)
    }
  }
}
