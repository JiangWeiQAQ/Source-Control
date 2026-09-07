import { GitRemoteCredential, IsomorphicGitHttpClient } from "../types"
import { GitSafetyError } from "../GitSafety"

declare const fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<{
  url: string
  status: number
  statusText: string
  headers: { entries(): IterableIterator<[string, string]> }
  body: AsyncIterable<Uint8Array>
  json(): Promise<unknown>
}>

export function formatRemoteRepository(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname.replace(/\.git$/i, "")}`
  } catch {
    return url.replace(/^https?:\/\//i, "")
  }
}
export function validateRemoteName(name: string): string {
  if (!name || typeof name !== "string") throw new GitSafetyError("Remote 名称不能为空", "INVALID_REMOTE_NAME")
  const trimmed = name.trim()
  if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) throw new GitSafetyError("Remote 名称格式不合法", "INVALID_REMOTE_NAME")
  return trimmed
}

export function validateRemoteUrlSyntax(url: string): string {
  if (!url || typeof url !== "string") throw new GitSafetyError("Remote URL 不能为空", "INVALID_REMOTE_URL")
  if (/[\u0000-\u001f\u007f\s]/.test(url)) throw new GitSafetyError("Remote URL 格式不合法", "INVALID_REMOTE_URL")
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    if (!parsed.hostname) throw new Error("empty hostname")
    return trimmed
  } catch {
    throw new GitSafetyError("Remote URL 格式不合法", "INVALID_REMOTE_URL")
  }
}

export function validateSupportedRemoteUrl(url: string): string {
  const trimmed = validateRemoteUrlSyntax(url)
  const parsed = new URL(trimmed)
  if (parsed.protocol.toLowerCase() !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new GitSafetyError("当前仅支持 HTTPS Remote URL", "UNSUPPORTED_REMOTE_URL")
  }
  return trimmed
}

export function remoteRepositoryIdentity(url: string): string {
  const parsed = new URL(validateSupportedRemoteUrl(url))
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "")
  return `${parsed.hostname.toLowerCase()}${path}`
}

export function validateRemoteUrl(url: string): string {
  return validateSupportedRemoteUrl(url)
}

export type GithubTokenStatus = "not-configured" | "configured-unverified" | "valid" | "invalid" | "insufficient-permission"

export interface GithubTokenCheckResult {
  status: Exclude<GithubTokenStatus, "configured-unverified">
  repositoryAccessible: boolean
  repositoryWritable: boolean
}

function parseGithubRepository(url: string): { owner: string; repository: string } | null {
  const parsed = new URL(validateSupportedRemoteUrl(url))
  if (parsed.hostname.toLowerCase() !== "github.com") return null
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return null
  return { owner: segments[0], repository: segments[1].replace(/\.git$/i, "") }
}

export async function checkGithubToken(token: string, remoteUrl: string): Promise<GithubTokenCheckResult> {
  if (!token.trim()) return { status: "not-configured", repositoryAccessible: false, repositoryWritable: false }
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }
  const userResponse = await fetch("https://api.github.com/user", { method: "GET", headers })
  if (userResponse.status === 401) return { status: "invalid", repositoryAccessible: false, repositoryWritable: false }
  if (userResponse.status === 403) return { status: "insufficient-permission", repositoryAccessible: false, repositoryWritable: false }
  if (userResponse.status !== 200) throw new Error(`GitHub Token 检查失败: ${userResponse.status}`)

  const repository = parseGithubRepository(remoteUrl)
  if (!repository) return { status: "valid", repositoryAccessible: false, repositoryWritable: false }
  const repositoryResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`, { method: "GET", headers })
  if (repositoryResponse.status === 401) return { status: "invalid", repositoryAccessible: false, repositoryWritable: false }
  if (repositoryResponse.status === 403) return { status: "insufficient-permission", repositoryAccessible: false, repositoryWritable: false }
  if (repositoryResponse.status === 404) return { status: "insufficient-permission", repositoryAccessible: false, repositoryWritable: false }
  if (repositoryResponse.status !== 200) throw new Error(`GitHub 仓库权限检查失败: ${repositoryResponse.status}`)
  const data = await repositoryResponse.json() as { permissions?: { push?: boolean } }
  const writable = data.permissions?.push === true
  return { status: writable ? "valid" : "insufficient-permission", repositoryAccessible: true, repositoryWritable: writable }
}
export function validateRemoteCredential(credential: GitRemoteCredential): GitRemoteCredential {
  const username = credential?.username?.trim()
  const password = credential?.password
  if (!username) throw new GitSafetyError("Remote 用户名不能为空", "INVALID_REMOTE_CREDENTIAL")
  if (!password || !password.trim()) throw new GitSafetyError("Remote 密码或 Token 不能为空", "INVALID_REMOTE_CREDENTIAL")
  return { username, password }
}

export function sanitizeRemoteErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^@\s/]+@/gi, "https://***@")
    .replace(/(password|token|authorization|access_token|oauth_token)[=:][^\s&,;]+/gi, "$1=***")
}

export function createFetchHttpClient(): IsomorphicGitHttpClient {
  return {
    async request({ url, method, headers, body }) {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? await requestBodyBytes(body) : undefined,
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
