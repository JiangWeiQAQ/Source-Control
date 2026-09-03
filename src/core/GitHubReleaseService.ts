import { fetch } from "scripting"
import { GitSafety } from "./GitSafety"
import { GitService } from "./GitService"
import { GitHubReleaseManifest, GitHubReleaseResult } from "./types"

export const GITHUB_RELEASE_TEMP_ROOT = `${FileManager.appGroupDocumentsDirectory}/source-control-release-temp`

export interface GitHubReleaseTransportResponse {
  status: number
  ok: boolean
  json(): Promise<unknown>
  text?(): Promise<string>
}

export interface GitHubReleaseTransport {
  request(options: {
    url: string
    method: "GET" | "POST"
    headers: Record<string, string>
    body?: string | ArrayBuffer
  }): Promise<GitHubReleaseTransportResponse>
}

interface GitHubRepositoryRef {
  owner: string
  repository: string
}

interface ProjectMetadata {
  name: string
  version: string
}

interface ReleaseAsset {
  id: number
  name: string
  browserDownloadUrl: string
  size: number
}

interface ReleaseRecord {
  id: number
  releaseUrl: string
  uploadUrl: string | null
  assets: ReleaseAsset[]
}

interface JsonObject {
  [key: string]: unknown
}

function createFetchTransport(): GitHubReleaseTransport {
  return {
    async request(options) {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
      })
      return {
        status: response.status,
        ok: response.ok,
        json: () => response.json(),
        text: () => response.text(),
      }
    },
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function parseVersion(value: unknown): string | null {
  const version = nonEmptyString(value)
  if (!version || version.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) return null
  return version
}

function parseProjectMetadata(value: unknown, fallbackName: string): ProjectMetadata | null {
  if (!isObject(value)) return null
  const name = nonEmptyString(value.name) || fallbackName
  const directVersion = parseVersion(value.version)
  if (directVersion) return { name, version: directVersion }
  if (isObject(value.metadata)) {
    const nestedVersion = parseVersion(value.metadata.version)
    if (nestedVersion) return { name, version: nestedVersion }
  }
  return null
}

function projectDirectoryName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean)
  return segments[segments.length - 1] || "Source Control"
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  return slug || "Source-Control"
}

function archiveDirectoryName(value: string): string {
  const name = value.trim().replace(/[\\/:?%*|"<>]/g, "-").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "")
  return name || "Source Control"
}

function parseGithubHttpsRemote(url: string): GitHubRepositoryRef | null {
  try {
    const parsed = new URL(url.trim())
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol.toLowerCase() !== "https:" || hostname !== "github.com") return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null
    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length !== 2) return null
    const repository = segments[1].replace(/\.git$/i, "")
    if (!segments[0] || !repository || !/^[A-Za-z0-9_.-]+$/.test(segments[0]) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return null
    return { owner: segments[0], repository }
  } catch {
    return null
  }
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/")
  return index > 0 ? path.slice(0, index) : path
}

function isReleaseAllowlisted(relativePath: string): boolean {
  if (relativePath === "index.tsx" || relativePath === "script.json" || relativePath === "README.md") return true
  return relativePath === "src" || relativePath.startsWith("src/") || relativePath === "assets" || relativePath.startsWith("assets/")
}

function shouldExclude(relativePath: string): boolean {
  const segments = relativePath.split("/")
  const lowerSegments = segments.map((segment) => segment.toLowerCase())
  const basename = lowerSegments[lowerSegments.length - 1] || ""
  if (lowerSegments.some((segment) => segment === ".git" || segment === ".svn" || segment === ".hg")) return true
  if (lowerSegments.some((segment) => segment === "source-control-sync-history" || segment === "source-control-release-temp" || segment === "source-control-metadata")) return true
  if (lowerSegments.some((segment) => segment === ".github" || segment === "docs" || segment === "tests" || segment === "__tests__")) return true
  if (lowerSegments.some((segment) => segment === "node_modules" || segment === "coverage" || segment === "dist" || segment === "build")) return true
  if (basename === ".ds_store" || basename === "thumbs.db" || basename === "desktop.ini" || basename === "release.json") return true
  if (basename.startsWith("._") || basename.startsWith(".source-control-") || basename === ".source-control") return true
  if (/^verify-.*\.ts$/i.test(basename) || /^(?:.*\.)?(?:test|spec)\.[cm]?[jt]sx?$/i.test(basename)) return true
  if (/^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|passwords?(?:\..*)?|auth(?:\..*)?|cookies?(?:\..*)?)$/i.test(basename)) return true
  if (/(?:\.pem|\.key)$/i.test(basename) || /^id_(?:rsa|ed25519)$/i.test(basename)) return true
  return false
}

function textFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function headerValue(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

function parseAsset(value: unknown): ReleaseAsset | null {
  if (!isObject(value)) return null
  const id = positiveNumber(value.id)
  const name = nonEmptyString(value.name)
  const browserDownloadUrl = nonEmptyString(value.browser_download_url)
  const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? value.size : null
  if (id === null || !name || !browserDownloadUrl || size === null) return null
  try {
    const parsed = new URL(browserDownloadUrl)
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password) return null
  } catch {
    return null
  }
  return { id, name, browserDownloadUrl, size }
}

function parseRelease(value: unknown): ReleaseRecord | null {
  if (!isObject(value)) return null
  const id = positiveNumber(value.id)
  const releaseUrl = nonEmptyString(value.html_url)
  const uploadUrl = nonEmptyString(value.upload_url)
  if (id === null || !releaseUrl || !uploadUrl || !Array.isArray(value.assets)) return null
  try {
    const parsed = new URL(releaseUrl)
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password) return null
  } catch {
    return null
  }
  const assets: ReleaseAsset[] = []
  for (const item of value.assets) {
    const asset = parseAsset(item)
    if (!asset) return null
    assets.push(asset)
  }
  return { id, releaseUrl, uploadUrl, assets }
}

function safeApiError(status: number): Error {
  return new Error(`GitHub Release API request failed with status ${status}.`)
}

export class GitHubReleaseService {
  private readonly transport: GitHubReleaseTransport

  constructor(
    private readonly gitService: GitService,
    projectPath: string,
    transport?: GitHubReleaseTransport,
  ) {
    this.projectPath = GitSafety.validateProjectPath(projectPath)
    this.transport = transport || createFetchTransport()
  }

  readonly projectPath: string

  async getProjectVersion(): Promise<string> {
    const metadata = await this.readProjectMetadata()
    if (!metadata) throw new Error("Project version is missing.")
    return metadata.version
  }

  async publishCurrentProject(): Promise<GitHubReleaseResult> {
    await this.gitService.openRepository(this.projectPath)
    const preflight = await this.preflight()
    const metadata = await this.readProjectMetadata()
    if (!metadata) throw new Error("Project version is missing.")

    const tagName = `v${metadata.version}`
    const assetName = `${slugify(metadata.name)}-${metadata.version}.zip`
    const releasedAt = Math.floor(Date.now() / 1000)
    const manifest: GitHubReleaseManifest = {
      name: metadata.name,
      version: metadata.version,
      commitOid: preflight.commitOid,
      releasedAt,
      minimumScriptingVersion: null,
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const runDirectory = `${GITHUB_RELEASE_TEMP_ROOT}/${runId}`
    try {
      const zipPath = await this.createZip(runDirectory, assetName, manifest, preflight.token)
      const zipBytes = await FileManager.readAsBytes(zipPath)
      const release = await this.findOrCreateRelease(preflight.repository, preflight.token, tagName, `${metadata.name} ${metadata.version}`, preflight.commitOid)
      const existingAsset = release.assets.find((asset) => asset.name === assetName)
      if (existingAsset) {
        return {
          version: metadata.version,
          tagName,
          releaseId: release.id,
          releaseUrl: release.releaseUrl,
          assetName: existingAsset.name,
          assetId: existingAsset.id,
           assetUrl: existingAsset.browserDownloadUrl,
          assetSize: existingAsset.size,
          commitOid: preflight.commitOid,
          existingRelease: true,
          assetUploaded: false,
        }
      }

      let uploaded: ReleaseAsset
      try {
        uploaded = await this.uploadAsset(release, preflight.token, assetName, zipBytes)
      } catch {
        if (release.wasCreated) throw new Error("Release created but ZIP upload failed.")
        throw new Error("ZIP upload failed for the existing GitHub Release.")
      }
      return {
        version: metadata.version,
        tagName,
        releaseId: release.id,
        releaseUrl: release.releaseUrl,
        assetName: uploaded.name,
        assetId: uploaded.id,
         assetUrl: uploaded.browserDownloadUrl,
        assetSize: uploaded.size,
        commitOid: preflight.commitOid,
        existingRelease: release.wasCreated ? false : true,
        assetUploaded: true,
      }
    } finally {
      try {
        if (await FileManager.exists(runDirectory)) await FileManager.remove(runDirectory)
        if (await FileManager.exists(GITHUB_RELEASE_TEMP_ROOT) && (await FileManager.readDirectory(GITHUB_RELEASE_TEMP_ROOT)).length === 0) await FileManager.remove(GITHUB_RELEASE_TEMP_ROOT)
      } catch {
        // 临时目录清理失败不能泄露凭据，也不覆盖发布结果。
      }
    }
  }

  private async readProjectMetadata(): Promise<ProjectMetadata | null> {
    const fallbackName = projectDirectoryName(this.projectPath)
    const candidates = [`${this.projectPath}/script.json`, `${this.projectPath}/metadata.json`]
    for (const path of candidates) {
      if (!(await FileManager.exists(path))) continue
      try {
        const parsed: unknown = JSON.parse(await FileManager.readAsString(path, "utf8"))
        const metadata = parseProjectMetadata(parsed, fallbackName)
        if (metadata) return metadata
      } catch {
        // 继续检查下一个 metadata 文件，最终统一报告缺少 version。
      }
    }
    return null
  }

  private async preflight(): Promise<{
    repository: GitHubRepositoryRef
    token: string
    branch: string
    commitOid: string
  }> {
    const status = await this.gitService.getStatus()
    if (!status.isClean) throw new Error("Working tree must be clean before publishing a Release.")

    const branch = await this.gitService.getCurrentBranch()
    if (!branch) throw new Error("Release requires a symbolic local branch.")
    const history = await this.gitService.getHistory(1)
    const commitOid = history[0]?.oid
    if (!commitOid) throw new Error("Cannot publish a Release from an unborn branch.")

    const metadata = await this.readProjectMetadata()
    if (!metadata) throw new Error("Project version is missing.")

    const remotes = await this.gitService.listRemotes()
    const remote = remotes.find((item) => item.name === "origin") || remotes[0]
    if (!remote) throw new Error("A GitHub HTTPS remote is required before publishing a Release.")
    const repository = parseGithubHttpsRemote(remote.url)
    if (!repository) throw new Error("Release requires a GitHub HTTPS remote.")

    const credential = await this.gitService.getRemoteCredential(remote.name)
    const token = credential?.password?.trim()
    if (!token) throw new Error("GitHub access token is not configured.")

    let comparison
    try {
      comparison = await this.gitService.getAheadBehind(remote.name, branch)
    } catch {
      throw new Error("请先将当前版本同步到 GitHub，再发布 Release。")
    }
    if (comparison.localOid !== commitOid || comparison.ahead !== 0 || comparison.behind !== 0 || comparison.diverged) {
      throw new Error("请先将当前版本同步到 GitHub，再发布 Release。")
    }

    return { repository, token, branch, commitOid }
  }

  private async createZip(runDirectory: string, assetName: string, manifest: GitHubReleaseManifest, token: string): Promise<string> {
    const archiveRoot = archiveDirectoryName(manifest.name)
    const stagingProject = `${runDirectory}/${archiveRoot}`
    const zipPath = `${runDirectory}/${assetName}`
    await FileManager.createDirectory(stagingProject, true)
    await this.copyReleaseFiles(this.projectPath, stagingProject, "", token)
    await FileManager.writeAsString(`${stagingProject}/release.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await FileManager.zip(stagingProject, zipPath, true)
    return zipPath
  }

  private async copyReleaseFiles(sourceDirectory: string, targetDirectory: string, relativeDirectory: string, token: string): Promise<void> {
    const entries = await FileManager.readDirectory(sourceDirectory)
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry}` : entry
      if (!isReleaseAllowlisted(relativePath) || shouldExclude(relativePath)) continue
      const sourcePath = `${sourceDirectory}/${entry}`
      const targetPath = `${targetDirectory}/${relativePath}`
      if (await FileManager.isDirectory(sourcePath)) {
        await FileManager.createDirectory(targetPath, true)
        await this.copyReleaseFiles(sourcePath, targetDirectory, relativePath, token)
      } else {
        const bytes = await FileManager.readAsBytes(sourcePath)
        if (relativePath.includes(token) || new TextDecoder().decode(bytes).includes(token)) throw new Error("Project files contain the GitHub access token and cannot be packaged.")
        await FileManager.createDirectory(parentPath(targetPath), true)
        await FileManager.copyFile(sourcePath, targetPath)
      }
    }
  }

  private apiBase(repository: GitHubRepositoryRef): string {
    return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`
  }

  private async requestRelease(url: string, token: string, method: "GET" | "POST", body?: string): Promise<GitHubReleaseTransportResponse> {
    try {
      return await this.transport.request({ url, method, headers: { ...headerValue(token), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body } : {}) })
    } catch {
      throw new Error("Unable to reach the GitHub Release API.")
    }
  }

  private async findOrCreateRelease(
    repository: GitHubRepositoryRef,
    token: string,
    tagName: string,
    title: string,
    targetCommitish: string,
  ): Promise<ReleaseRecord & { wasCreated: boolean }> {
    const existingResponse = await this.requestRelease(`${this.apiBase(repository)}/releases/tags/${encodeURIComponent(tagName)}`, token, "GET")
    if (existingResponse.status !== 404) {
      if (!existingResponse.ok) throw safeApiError(existingResponse.status)
      const existing = parseRelease(await existingResponse.json())
      if (!existing) throw new Error("GitHub returned an invalid Release response.")
      return { ...existing, wasCreated: false }
    }

    const payload = JSON.stringify({ tag_name: tagName, target_commitish: targetCommitish, name: title, body: "" })
    const createdResponse = await this.requestRelease(`${this.apiBase(repository)}/releases`, token, "POST", payload)
    if (!createdResponse.ok) throw safeApiError(createdResponse.status)
    const created = parseRelease(await createdResponse.json())
    if (!created) throw new Error("GitHub returned an invalid created Release response.")
    return { ...created, wasCreated: true }
  }

  private async uploadAsset(release: ReleaseRecord & { wasCreated: boolean }, token: string, assetName: string, bytes: Uint8Array): Promise<ReleaseAsset> {
    if (!release.uploadUrl) throw new Error("GitHub Release upload URL is missing.")
    let uploadUrl: string
    try {
      const parsed = new URL(release.uploadUrl.replace("{?name,label}", ""))
      if (parsed.protocol !== "https:" || (parsed.hostname !== "uploads.github.com" && parsed.hostname !== "api.github.com") || parsed.username || parsed.password) throw new Error("unsafe upload URL")
      parsed.searchParams.set("name", assetName)
      uploadUrl = parsed.toString()
    } catch {
      throw new Error("GitHub Release upload URL is invalid.")
    }
    let response: GitHubReleaseTransportResponse
    try {
      response = await this.transport.request({
        url: uploadUrl,
        method: "POST",
        headers: { ...headerValue(token), "Content-Type": "application/zip" },
        body: textFromBytes(bytes),
      })
    } catch {
      throw new Error("Unable to reach the GitHub Release upload API.")
    }
    if (!response.ok) throw safeApiError(response.status)
    const asset = parseAsset(await response.json())
    if (!asset) throw new Error("GitHub returned an invalid uploaded asset response.")
    if (asset.name !== assetName) throw new Error("GitHub returned an unexpected uploaded asset.")
    return asset
  }
}

export function createGitHubReleaseService(gitService: GitService, projectPath: string, transport?: GitHubReleaseTransport): GitHubReleaseService {
  return new GitHubReleaseService(gitService, projectPath, transport)
}
