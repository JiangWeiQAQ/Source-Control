import { useEffect, useState } from "scripting"
import { GithubTokenStatus, validateSupportedRemoteUrl } from "../core/remote/RemoteValidation"
import { GitAheadBehind, GitCommitInfo, GitRemoteBranch, GitRemoteInfo } from "../core/types"

export interface RemoteStatusService {
  listRemotes(): Promise<GitRemoteInfo[]>
  getCurrentBranch(): Promise<string | null>
  getHistory(limit?: number): Promise<GitCommitInfo[]>
  listRemoteBranches(remoteName?: string): Promise<GitRemoteBranch[]>
  hasRemoteCredential(name: string): Promise<boolean>
  getAheadBehind(remoteName?: string, branchName?: string): Promise<GitAheadBehind>
}

export interface RemoteStatusLoadOptions {
  preferredRemoteName?: string | null
  preservedCredentialRemoteName?: string | null
  checked?: boolean
  tokenStatus?: GithubTokenStatus
  includeLocalCommit?: boolean
  tolerateBranchErrors?: boolean
}

export interface UseRemoteStatusOptions {
  initialLoading?: boolean
  includeLocalCommit?: boolean
  tolerateBranchErrors?: boolean
}

export interface RemoteStatusState {
  remotes: GitRemoteInfo[]
  selected: GitRemoteInfo | null
  branches: GitRemoteBranch[]
  branch: string | null
  aheadBehind: GitAheadBehind | null
  credential: boolean
  credentialRemoteName: string | null
  credentialBound: boolean
  tokenStatus: GithubTokenStatus
  checked: boolean
  hasLocalCommit: boolean
}

export interface RemoteStatusRequestLoader {
  next: () => number
  invalidate: () => number
  isCurrent: (requestId: number) => boolean
}

export interface RemoteStatusHook extends RemoteStatusState {
  loading: boolean
  error: string | null
  load: (options?: RemoteStatusLoadOptions) => Promise<RemoteStatusState | null>
  refresh: (options?: RemoteStatusLoadOptions) => Promise<RemoteStatusState | null>
  invalidate: () => void
  reset: () => void
  setVerification: (checked: boolean, tokenStatus: GithubTokenStatus) => void
}

export const emptyRemoteStatus: RemoteStatusState = {
  remotes: [],
  selected: null,
  branches: [],
  branch: null,
  aheadBehind: null,
  credential: false,
  credentialRemoteName: null,
  credentialBound: false,
  tokenStatus: "not-configured",
  checked: false,
  hasLocalCommit: false,
}

export function createRemoteStatusLoader(): RemoteStatusRequestLoader {
  let sequence = 0
  return {
    next: () => ++sequence,
    invalidate: () => ++sequence,
    isCurrent: (requestId) => requestId === sequence,
  }
}

function canReadCredential(remote: GitRemoteInfo): boolean {
  try {
    validateSupportedRemoteUrl(remote.url)
    return true
  } catch {
    return false
  }
}

function selectRemote(remotes: GitRemoteInfo[], preferredRemoteName?: string | null): GitRemoteInfo | null {
  if (preferredRemoteName) {
    const preferred = remotes.find((remote) => remote.name === preferredRemoteName)
    if (preferred) return preferred
  }
  return remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null
}

export async function readRemoteStatus(service: RemoteStatusService, options: RemoteStatusLoadOptions = {}): Promise<RemoteStatusState> {
  const remotes = await service.listRemotes()
  const selected = selectRemote(remotes, options.preferredRemoteName)
  const branchPromise = options.tolerateBranchErrors
    ? service.getCurrentBranch().catch(() => null)
    : service.getCurrentBranch()
  const hasLocalCommitPromise = options.includeLocalCommit
    ? service.getHistory(1).then((history) => history.length > 0)
    : Promise.resolve(false)
  const [branch, hasLocalCommit] = await Promise.all([branchPromise, hasLocalCommitPromise])
  const branches = selected ? await service.listRemoteBranches(selected.name) : []
  const selectedCredential = selected && canReadCredential(selected)
    ? await service.hasRemoteCredential(selected.name)
    : false
  const preservedCredentialName = options.preservedCredentialRemoteName && !remotes.some((remote) => remote.name === options.preservedCredentialRemoteName)
    ? options.preservedCredentialRemoteName
    : null
  const preservedCredential = preservedCredentialName
    ? await service.hasRemoteCredential(preservedCredentialName)
    : false
  const credential = selectedCredential || preservedCredential
  const credentialBound = selectedCredential
  const credentialRemoteName = selectedCredential
    ? selected?.name ?? null
    : preservedCredential
      ? preservedCredentialName
      : null
  const aheadBehind = branch && selected && branches.some((item) => item.name === branch)
    ? await service.getAheadBehind(selected.name, branch)
    : null
  const tokenStatus = credential && credentialBound && options.tokenStatus && options.tokenStatus !== "not-configured"
    ? options.tokenStatus
    : credential
      ? "configured-unverified"
      : "not-configured"

  return {
    remotes,
    selected,
    branches,
    branch,
    aheadBehind,
    credential,
    credentialRemoteName,
    credentialBound,
    tokenStatus,
    checked: options.checked ?? false,
    hasLocalCommit,
  }
}

export function useRemoteStatus(service: RemoteStatusService | null | undefined, projectPath?: string, options: UseRemoteStatusOptions = {}): RemoteStatusHook {
  const initialLoading = options.initialLoading ?? false
  const includeLocalCommit = options.includeLocalCommit ?? false
  const tolerateBranchErrors = options.tolerateBranchErrors ?? false
  const [state, setState] = useState<RemoteStatusState>(emptyRemoteStatus)
  const [loading, setLoading] = useState(initialLoading && !!service)
  const [error, setError] = useState<string | null>(null)
  const [requestLoader] = useState<RemoteStatusRequestLoader>(createRemoteStatusLoader())

  const invalidate = () => {
    requestLoader.invalidate()
  }

  const reset = () => {
    invalidate()
    setState(emptyRemoteStatus)
    setError(null)
    setLoading(false)
  }

  const load = async (loadOptions: RemoteStatusLoadOptions = {}): Promise<RemoteStatusState | null> => {
    const requestId = requestLoader.next()
    if (!service) {
      if (requestLoader.isCurrent(requestId)) {
        setState(emptyRemoteStatus)
        setError(null)
        setLoading(false)
      }
      return emptyRemoteStatus
    }

    setLoading(true)
    setError(null)
    try {
      const next = await readRemoteStatus(service, {
        ...loadOptions,
        includeLocalCommit: loadOptions.includeLocalCommit ?? includeLocalCommit,
        tolerateBranchErrors: loadOptions.tolerateBranchErrors ?? tolerateBranchErrors,
      })
      if (!requestLoader.isCurrent(requestId)) return null
      setState(next)
      return next
    } catch (cause) {
      if (!requestLoader.isCurrent(requestId)) return null
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      if (requestLoader.isCurrent(requestId)) setLoading(false)
    }
  }

  useEffect(() => {
    invalidate()
    setState(emptyRemoteStatus)
    setError(null)
    setLoading(!!service && initialLoading)
    if (service) load().catch(console.error)
  }, [service, projectPath, includeLocalCommit, tolerateBranchErrors])

  return {
    ...state,
    loading,
    error,
    load,
    refresh: load,
    invalidate,
    reset,
    setVerification: (nextChecked, nextTokenStatus) => {
      setState((current) => ({ ...current, checked: nextChecked, tokenStatus: nextTokenStatus }))
    },
  }
}
