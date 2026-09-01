export type LanguagePreference = "system" | "zh-Hans" | "en"
export type AppLanguage = "zh-Hans" | "en"

const LANGUAGE_KEY = "source-control.language"

export function getLanguagePreference(): LanguagePreference {
  const value = Storage.get<LanguagePreference>(LANGUAGE_KEY)
  return value === "zh-Hans" || value === "en" || value === "system" ? value : "system"
}

export function setLanguagePreference(value: LanguagePreference): void {
  Storage.set(LANGUAGE_KEY, value)
}

export function resolveLanguage(preference: LanguagePreference = getLanguagePreference()): AppLanguage {
  if (preference === "zh-Hans" || preference === "en") return preference
  const preferredLanguages = Device.preferredLanguages as unknown as string[] | undefined
  const preferred = preferredLanguages?.[0] || "en"
  return preferred.toLowerCase().startsWith("zh") ? "zh-Hans" : "en"
}

const messages = {
  en: {
    language: "Language", sourceControl: "Source Control", beta: "Beta", myProjects: "MY PROJECTS", addProject: "Add Project", noProjects: "No Projects", addProjectHint: "Add a Scripting project to start tracking changes.", localChanges: "Local Changes", staged: "Staged", changes: "Changes", files: "Files", folders: "Folders", root: "Root", stageAll: "Stage All", stageRemaining: "Stage Remaining", unstageAll: "Unstage All", repositoryInitialized: "Repository Initialized", readyForInitialCommit: "Ready for Initial Commit", stageFilesHint: "Stage the files you want, then create the first commit.", localCommit: "LOCAL COMMIT", localCommitHint: "Save the current staged changes to local Git history.", commitMessage: "Commit Message", initialCommit: "Initial commit", commitLocally: "Commit Locally", localCommitCreated: "Local Commit Created", readyToSync: "Ready to Sync", syncToGitHub: "Sync to GitHub", notConnected: "Not Connected to GitHub", setUpRemote: "Set Up Remote", history: "History", snapshots: "Snapshots", remote: "Remote", settings: "Settings", refresh: "Refresh", close: "Close", cancel: "Cancel", retry: "Retry", fetch: "Fetch", push: "Push", pull: "Pull", upToDate: "Up to Date", commitsToPush: "Commits to Push", commitsToPull: "Commits to Pull", branchesDiverged: "Branches Diverged", authentication: "Authentication", configured: "Configured", notConfigured: "Not Configured", sync: "Sync", committed: "Committed", noRemote: "No Remote", noRemoteHint: "This repository is not connected to a remote repository.", addRemote: "Add Remote", remotes: "REMOTES", syncStatus: "SYNC STATUS", remoteBranch: "REMOTE BRANCH", actions: "ACTIONS",
  },
  "zh-Hans": {
    language: "语言", sourceControl: "Source Control", beta: "Beta", myProjects: "我的项目", addProject: "添加项目", noProjects: "暂无项目", addProjectHint: "添加一个 Scripting 项目以开始跟踪改动。", localChanges: "本地改动", staged: "已暂存", changes: "未暂存", files: "文件", folders: "文件夹", root: "根目录", stageAll: "全部暂存", stageRemaining: "暂存剩余文件", unstageAll: "全部取消暂存", repositoryInitialized: "仓库已初始化", readyForInitialCommit: "可以创建首次提交", stageFilesHint: "选择需要提交的文件，然后创建第一次本地提交。", localCommit: "本地提交", localCommitHint: "将已暂存的改动保存到本地 Git 历史。", commitMessage: "提交说明", initialCommit: "首次提交", commitLocally: "提交到本地", localCommitCreated: "本地提交已创建", readyToSync: "可以同步", syncToGitHub: "同步到 GitHub", notConnected: "尚未连接到 GitHub", setUpRemote: "设置远端", history: "历史记录", snapshots: "安全快照", remote: "远端", settings: "设置", refresh: "刷新", close: "关闭", cancel: "取消", retry: "重试", fetch: "获取远端状态", push: "上传到 GitHub", pull: "拉取远端更新", upToDate: "已是最新", commitsToPush: "个提交待上传", commitsToPull: "个提交待拉取", branchesDiverged: "本地与远端已分叉", authentication: "身份验证", configured: "已配置", notConfigured: "未配置", sync: "同步", committed: "已提交", noRemote: "无远端", noRemoteHint: "此仓库尚未连接远端仓库。", addRemote: "添加远端", remotes: "远端列表", syncStatus: "同步状态", remoteBranch: "远端分支", actions: "操作",
  },
} as const

export type MessageKey = keyof typeof messages.en
export function createTranslator(language: AppLanguage) {
  return (key: MessageKey): string => messages[language][key]
}
