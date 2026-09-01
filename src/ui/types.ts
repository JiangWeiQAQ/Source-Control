import { GitChange, GitCommitInfo } from "../core/types"

export interface RepoItem {
  name: string
  path: string
  isGit: boolean
}

export type ViewTab = "changes" | "history"

export interface SourceControlState {
  currentProject: RepoItem | null
  projects: RepoItem[]
  tab: ViewTab
  loading: boolean
  statusLoading: boolean
  commitMessage: string
  stagedChanges: GitChange[]
  unstagedChanges: GitChange[]
  history: GitCommitInfo[]
  errorMessage: string | null
  successMessage: string | null
}
