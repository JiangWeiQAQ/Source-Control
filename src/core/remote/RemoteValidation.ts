import { GitRemoteCredential, IsomorphicGitHttpClient } from "../types"
import { GitSafetyError } from "../GitSafety"

declare const fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<{
  url: string
  status: number
  statusText: string
  headers: { entries(): IterableIterator<[string, string]> }
  body: AsyncIterable<Uint8Array>
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

export function validateRemoteUrl(url: string): string {
  if (!url || typeof url !== "string") throw new GitSafetyError("Remote URL 不能为空", "INVALID_REMOTE_URL")
  const trimmed = url.trim()
  if (!trimmed || /[\u0000-\u001f\s]/.test(trimmed)) throw new GitSafetyError("Remote URL 格式不合法", "INVALID_REMOTE_URL")
  return trimmed
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
