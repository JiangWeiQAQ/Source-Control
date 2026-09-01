import { GitRemoteCredential } from "../core/types"

export interface GithubRepositoryInfo {
  owner: string
  repo: string
  private: boolean | null
  visibility: string | null
}

function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i)
  return match ? { owner: match[1], repo: match[2] } : null
}

export async function getGithubRepositoryInfo(url: string, credential: GitRemoteCredential | null): Promise<GithubRepositoryInfo | null> {
  const repository = parseGithubRemote(url)
  if (!repository) return null
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (credential) headers.Authorization = `Basic ${btoa(`${credential.username}:${credential.password}`)}`
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`, { headers })
    if (!response.ok) return { ...repository, private: null, visibility: null }
    const data = JSON.parse(await response.text()) as { private?: boolean; visibility?: string }
    return { ...repository, private: data.private === true, visibility: typeof data.visibility === "string" ? data.visibility : null }
  } catch {
    return { ...repository, private: null, visibility: null }
  }
}
