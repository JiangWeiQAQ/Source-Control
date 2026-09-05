import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { GitHubReleaseService } from "../core/GitHubReleaseService"
import { GitHubReleaseResult, GitAheadBehind, GitRemoteBranch, GitRemoteInfo, GitRepositoryStatus } from "../core/types"
import { GitService } from "../core/GitService"
import { CloseButton } from "./CloseButton"
import { SettingsRow } from "./components/SettingsRow"
import { ErrorSection } from "./components/ErrorSection"
import { LoadingSection } from "./components/LoadingSection"
import { SourceControlReleaseView } from "./SourceControlReleaseView"
import { SourceControlProjectConfigView } from "./SourceControlProjectConfigView"
import { formatRemoteRepository, validateRemoteUrl } from "../core/remote/RemoteValidation"
import { AppLanguage, LanguagePreference, getLanguagePreference, setLanguagePreference } from "./localization"
import { useTranslator } from "./useLocalization"
import { UIDensity } from "./design"
import { useUISettings } from "./useUISettings"

export interface SourceControlSettingsViewProps {
  onLanguageChanged?: () => void
  onRemoteChanged?: () => Promise<void>
  gitService?: GitService
  projectPath?: string
}

type GithubSettingsState = {
  remotes: GitRemoteInfo[]
  selected: GitRemoteInfo | null
  branches: GitRemoteBranch[]
  branch: string | null
  status: GitRepositoryStatus | null
  sync: GitAheadBehind | null
  credential: boolean
  checked: boolean
}

type SettingsOperation = "remote" | "credential" | "check" | "fetch" | "push" | "force-push" | "release" | null

const emptyGithubState: GithubSettingsState = {
  remotes: [],
  selected: null,
  branches: [],
  branch: null,
  status: null,
  sync: null,
  credential: false,
  checked: false,
}

function copy(language: AppLanguage, zh: string, en: string): string {
  return language === "zh-Hans" ? zh : en
}

function isHttps(url: string): boolean {
  try {
    return new URL(validateRemoteUrl(url)).protocol.toLowerCase() === "https:"
  } catch {
    return false
  }
}

function displayRepository(url: string): string {
  return formatRemoteRepository(url)
}

function densityLabel(density: UIDensity, language: AppLanguage): string {
  if (language === "zh-Hans") return density === "compact" ? "紧凑" : density === "comfortable" ? "宽松" : "标准"
  return density === "compact" ? "Compact" : density === "comfortable" ? "Comfortable" : "Standard"
}

function githubStatusLabel(state: GithubSettingsState, language: AppLanguage): string {
  if (!state.selected) return copy(language, "尚未连接 GitHub", "Not connected to GitHub")
  if (!state.checked) return copy(language, "尚未检查 GitHub", "GitHub status has not been checked")
  if (!state.branch) return copy(language, "无法读取当前分支", "Unable to read the current branch")
  if (state.branches.length === 0) return copy(language, "GitHub 仓库为空", "GitHub repository is empty")
  if (!state.branches.some((item) => item.name === state.branch)) return copy(language, "未找到对应的 GitHub 分支", "The matching GitHub branch was not found")
  if (!state.sync) return copy(language, "无法读取 GitHub 状态", "Unable to read GitHub status")
  if (state.sync.diverged || (state.sync.ahead > 0 && state.sync.behind > 0)) return copy(language, "历史已分叉", "History has diverged")
  if (state.sync.ahead > 0) return copy(language, `本地领先 ${state.sync.ahead} 个版本`, `Local is ${state.sync.ahead} commit${state.sync.ahead === 1 ? "" : "s"} ahead`)
  if (state.sync.behind > 0) return copy(language, `GitHub 有 ${state.sync.behind} 个新版本`, `GitHub has ${state.sync.behind} newer commit${state.sync.behind === 1 ? "" : "s"}`)
  return copy(language, "已同步", "Synced")
}

export function SourceControlSettingsView({ onLanguageChanged, onRemoteChanged, gitService, projectPath }: SourceControlSettingsViewProps) {
  const dismiss = Navigation.useDismiss()
  const { t, language, refreshLanguage } = useTranslator()
  const { density, tokens, setDensity } = useUISettings()
  const [preference, setPreference] = useState<LanguagePreference>(getLanguagePreference())
  const [githubState, setGithubState] = useState<GithubSettingsState>(emptyGithubState)
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState<SettingsOperation>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [releaseVersion, setReleaseVersion] = useState<string | null>(null)
  const [releaseVersionError, setReleaseVersionError] = useState<string | null>(null)
  const [releaseResult, setReleaseResult] = useState<GitHubReleaseResult | null>(null)
  const busy = operation !== null
  const selectedRemote = githubState.selected

  const openProjectConfig = async () => {
    if (!projectPath || busy) return
    await Navigation.present(<SourceControlProjectConfigView projectPath={projectPath} />)
  }

  const notifyRemoteChanged = async () => {
    try {
      await onRemoteChanged?.()
    } catch (error) {
      console.error("[Settings] remote change callback failed", error)
    }
  }

  const loadGithubConfiguration = async () => {
    if (!gitService) return
    setLoading(true)
    setErrorMessage(null)
    try {
      const remotes = await gitService.listRemotes()
      const selected = remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null
      const credential = selected && isHttps(selected.url) ? await gitService.hasRemoteCredential(selected.name) : false
      const branch = await gitService.getCurrentBranch().catch(() => null)
      const status = await gitService.getStatus().catch(() => null)
      setGithubState({ ...emptyGithubState, remotes, selected, credential, branch, status })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGithubConfiguration().catch(console.error)
  }, [gitService])

  const addRemote = async () => {
    if (!gitService || busy) return
    const name = await Dialog.prompt({
      title: copy(language, "添加 GitHub 仓库", "Add GitHub Repository"),
      message: copy(language, "远端名称", "Remote Name"),
      defaultValue: "origin",
      placeholder: "origin",
      cancelLabel: t("cancel"),
      confirmLabel: copy(language, "下一步", "Next"),
    })
    if (name === null || !name.trim()) return
    const url = await Dialog.prompt({
      title: copy(language, "添加 GitHub 仓库", "Add GitHub Repository"),
      message: copy(language, "仓库地址", "Repository URL"),
      placeholder: "https://github.com/user/repository.git",
      cancelLabel: t("cancel"),
      confirmLabel: copy(language, "添加", "Add"),
    })
    if (url === null || !url.trim()) return

    setOperation("remote")
    setErrorMessage(null)
    try {
      await gitService.addRemote(name.trim(), url.trim())
      await loadGithubConfiguration()
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const editRemote = async () => {
    if (!gitService || !selectedRemote || busy) return
    const url = await Dialog.prompt({
      title: copy(language, "GitHub 仓库", "GitHub Repository"),
      message: copy(language, "修改仓库地址", "Edit Repository URL"),
      defaultValue: selectedRemote.url,
      placeholder: "https://github.com/user/repository.git",
      cancelLabel: t("cancel"),
      confirmLabel: copy(language, "保存", "Save"),
    })
    if (url === null || !url.trim() || url.trim() === selectedRemote.url) return

    setOperation("remote")
    setErrorMessage(null)
    try {
      await gitService.setRemoteUrl(selectedRemote.name, url.trim())
      await loadGithubConfiguration()
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const setToken = async () => {
    if (!gitService || !selectedRemote || !isHttps(selectedRemote.url) || busy) return
    const token = await Dialog.prompt({
      title: copy(language, "GitHub 访问令牌", "GitHub Token"),
      message: copy(language, "令牌仅保存在系统 Keychain 中。", "The token is stored only in the system Keychain."),
      placeholder: "GitHub Token",
      obscureText: true,
      cancelLabel: t("cancel"),
      confirmLabel: copy(language, "保存", "Save"),
    })
    if (token === null || !token.trim()) return

    setOperation("credential")
    setErrorMessage(null)
    try {
      await gitService.setRemoteCredential(selectedRemote.name, { username: "x-access-token", password: token.trim() })
      const credential = await gitService.hasRemoteCredential(selectedRemote.name)
      setGithubState((current) => ({ ...current, credential }))
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const removeToken = async () => {
    if (!gitService || !selectedRemote || !githubState.credential || busy) return
    const selected = await Dialog.actionSheet({
      title: copy(language, "移除访问令牌？", "Remove Access Token?"),
      message: copy(language, "这只会移除 Keychain 中保存的令牌，不会修改仓库配置。", "This removes the saved Keychain token without changing the repository configuration."),
      actions: [{ label: copy(language, "移除", "Remove"), destructive: true }],
    })
    if (selected !== 0) return

    setOperation("credential")
    setErrorMessage(null)
    try {
      await gitService.removeRemoteCredential(selectedRemote.name)
      setGithubState((current) => ({ ...current, credential: false }))
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const manageToken = async () => {
    if (!githubState.credential) {
      await setToken()
      return
    }
    const selected = await Dialog.actionSheet({
      title: copy(language, "访问令牌", "Access Token"),
      actions: [
        { label: copy(language, "更新令牌", "Update Token") },
        { label: copy(language, "移除令牌", "Remove Token"), destructive: true },
      ],
    })
    if (selected === 0) await setToken()
    if (selected === 1) await removeToken()
  }

  const checkGithubStatus = async () => {
    if (!gitService || !selectedRemote || busy) return
    setOperation("check")
    setErrorMessage(null)
    try {
      await gitService.fetchRemote(selectedRemote.name)
      const [remotes, branch, branches, status, history] = await Promise.all([
        gitService.listRemotes(),
        gitService.getCurrentBranch(),
        gitService.listRemoteBranches(selectedRemote.name),
        gitService.getStatus(),
        gitService.getHistory(1),
      ])
      const refreshedRemote = remotes.find((remote) => remote.name === selectedRemote.name) ?? selectedRemote
      const sync = branch && branches.some((item) => item.name === branch) ? await gitService.getAheadBehind(selectedRemote.name, branch) : null
      const credential = isHttps(refreshedRemote.url) ? await gitService.hasRemoteCredential(refreshedRemote.name) : false
      setGithubState({ remotes, selected: refreshedRemote, branches, branch, status, sync, credential, checked: true })
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const fetchGithub = async () => {
    if (!gitService || !selectedRemote || busy) return
    setOperation("fetch")
    setErrorMessage(null)
    try {
      await gitService.fetchRemote(selectedRemote.name)
      const [remotes, branch, branches, status] = await Promise.all([
        gitService.listRemotes(),
        gitService.getCurrentBranch(),
        gitService.listRemoteBranches(selectedRemote.name),
        gitService.getStatus(),
      ])
      const refreshedRemote = remotes.find((remote) => remote.name === selectedRemote.name) ?? selectedRemote
      const sync = branch && branches.some((item) => item.name === branch) ? await gitService.getAheadBehind(selectedRemote.name, branch) : null
      const credential = isHttps(refreshedRemote.url) ? await gitService.hasRemoteCredential(refreshedRemote.name) : false
      setGithubState({ remotes, selected: refreshedRemote, branches, branch, status, sync, credential, checked: true })
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const pushToGithub = async () => {
    if (!gitService || !selectedRemote || busy) return
    setOperation("push")
    setErrorMessage(null)
    try {
      const branch = await gitService.getCurrentBranch()
      if (!branch) throw new Error("Push requires a local branch.")
      await gitService.pushRemote(selectedRemote.name, branch)
      await checkGithubStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const forcePushToGithub = async () => {
    if (!gitService || !selectedRemote || busy) return
    const branch = githubState.branch || (await gitService.getCurrentBranch())
    if (!branch) {
      setErrorMessage("Force Push requires a local branch.")
      return
    }
    const status = await gitService.getStatus()
    if (!status.isClean) {
      setErrorMessage(copy(language, "工作区不干净，请先提交或还原未保存修改。", "Working tree is dirty. Commit or discard changes before force pushing."))
      return
    }
    const sync = githubState.sync || (await gitService.getAheadBehind(selectedRemote.name, branch))
    const firstConfirm = await Dialog.confirm({
      title: copy(language, "以本地版本为准？", "Use Local Version as Source of Truth?"),
      message: copy(language, "GitHub 上当前分支的独立版本将被本地历史替换。\n\n本地版本不会删除。", "The remote branch history on GitHub will be overwritten with local history.\n\nLocal history will not be deleted."),
      confirmLabel: copy(language, "下一步", "Next"),
      cancelLabel: t("cancel"),
    })
    if (!firstConfirm) return

    const secondConfirm = await Dialog.confirm({
      title: copy(language, "确认覆盖 GitHub？", "Confirm Overwriting GitHub?"),
      message: `${copy(language, "GitHub 当前：", "GitHub Current: ")}${sync?.remoteOid?.slice(0, 7) ?? "unknown"}\n${copy(language, "本地当前：", "Local Current: ")}${sync?.localOid?.slice(0, 7) ?? "unknown"}\n\n${copy(language, "此操作会重写 GitHub 分支历史。", "This will rewrite GitHub branch history.")}`,
      confirmLabel: copy(language, "确认覆盖", "Overwrite GitHub"),
      cancelLabel: t("cancel"),
    })
    if (!secondConfirm) return

    setOperation("force-push")
    setErrorMessage(null)
    try {
      await gitService.forcePushLocalToRemote(selectedRemote.name, branch)
      await checkGithubStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  useEffect(() => {
    if (!gitService || !projectPath) {
      setReleaseVersion(null)
      setReleaseVersionError(null)
      setReleaseResult(null)
      return
    }
    const loadVersion = async () => {
      try {
        const version = await new GitHubReleaseService(gitService, projectPath).getProjectVersion()
        setReleaseVersion(version)
        setReleaseVersionError(null)
      } catch (error) {
        setReleaseVersion(null)
        setReleaseVersionError(error instanceof Error ? error.message : String(error))
      }
    }
    loadVersion().catch(console.error)
  }, [gitService, projectPath])

  const openReleaseSettings = async () => {
    if (!gitService || !projectPath || busy) return
    try {
      await Navigation.present(<SourceControlReleaseView gitService={gitService} projectPath={projectPath} />)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const openRelease = async () => {
    if (!releaseResult) return
    try {
      await Safari.openURL(releaseResult.releaseUrl)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const copyReleaseAssetUrl = async () => {
    if (!releaseResult) return
    await Pasteboard.setString(releaseResult.assetUrl)
    await Dialog.alert({ title: t("downloadUrlCopied"), message: "" })
  }

  const chooseDensity = async () => {
    const selected = await Dialog.actionSheet({
      title: copy(language, "布局密度", "Layout Density"),
      actions: [
        { label: copy(language, "紧凑", "Compact") },
        { label: copy(language, "标准", "Standard") },
        { label: copy(language, "宽松", "Comfortable") },
      ],
    })
    const next: UIDensity | null = selected === 0 ? "compact" : selected === 1 ? "standard" : selected === 2 ? "comfortable" : null
    if (next) setDensity(next)
  }

  const chooseLanguage = async () => {
    const selected = await Dialog.actionSheet({
      title: copy(language, "语言", "Language"),
      actions: [{ label: "System" }, { label: "简体中文" }, { label: "English" }],
    })
    const next: LanguagePreference | null = selected === 0 ? "system" : selected === 1 ? "zh-Hans" : selected === 2 ? "en" : null
    if (!next) return
    setLanguagePreference(next)
    setPreference(next)
    refreshLanguage()
    onLanguageChanged?.()
  }

  const preferenceLabel = preference === "system" ? "System" : preference === "zh-Hans" ? "简体中文" : "English"
  const currentDensityLabel = densityLabel(density, language)
  const statusLabel = githubStatusLabel(githubState, language)

  return (
    <NavigationStack>
      <List navigationTitle={t("settings")} toolbar={{ topBarLeading: <CloseButton /> }}>
        <Section header={<Text>Source Control</Text>}>
          <VStack spacing={5} alignment="leading">
            <Text font="subheadline">{copy(language, "选择 → 说明 → 保存 → 同步", "Select → Explain → Save → Sync")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{copy(language, "选择需要保存的文件\n填写版本说明\n保存本地版本\n按需同步到 GitHub", "Select files to save\nAdd a version note\nSave a local version\nSync to GitHub when needed")}</Text>
          </VStack>
        </Section>

        {errorMessage ? <ErrorSection message={errorMessage} title={t("remoteUpdateFailed")} /> : null}
        {busy ? <LoadingSection message={operation === "fetch" ? copy(language, "正在获取远端状态…", "Fetching…") : operation === "push" ? copy(language, "正在上传…", "Pushing…") : operation === "force-push" ? copy(language, "正在以本地版本覆盖 GitHub…", "Force pushing to GitHub…") : operation === "check" ? copy(language, "正在检查 GitHub…", "Checking GitHub…") : undefined} /> : null}

        {projectPath ? <Section header={<Text>项目</Text>}>
           <SettingsRow
             icon="doc.text"
             title="项目配置"
             subtitle="编辑当前项目的 script.json"
             onPress={openProjectConfig}
             disabled={busy}
           />
         </Section> : null}

         {gitService ? (
           <Section header={<Text>GitHub</Text>}>
            {loading && !selectedRemote ? <LoadingSection message={copy(language, "正在读取 GitHub 配置…", "Loading GitHub settings…")} /> : null}
            {!loading && !selectedRemote ? <Button title={copy(language, "添加 GitHub 仓库", "Add GitHub Repository")} systemImage="plus" disabled={busy} action={addRemote} /> : null}
            {selectedRemote ? <>
              <SettingsRow
                icon="externaldrive"
                title={copy(language, "仓库", "Repository")}
                subtitle={displayRepository(selectedRemote.url)}
                onPress={editRemote}
                disabled={busy}
              />
              <SettingsRow
                icon="key"
                title={copy(language, "访问令牌", "Access Token")}
                subtitle={githubState.credential ? copy(language, "已配置", "Configured") : copy(language, "未配置", "Not Configured")}
                onPress={manageToken}
                disabled={busy || !isHttps(selectedRemote.url)}
              />
              {githubState.credential ? (
                <Button
                  title={copy(language, "清除 Token", "Clear Token")}
                  systemImage="trash"
                  role="destructive"
                  disabled={busy}
                  action={removeToken}
                />
              ) : null}
              <SettingsRow
                icon="arrow.triangle.branch"
                title={copy(language, "当前分支", "Current Branch")}
                subtitle={githubState.branch || copy(language, "未检出分支", "No branch")}
                onPress={() => {}}
                disabled={busy}
              />
              <SettingsRow
                icon="arrow.triangle.swap"
                title={copy(language, "Remote 状态", "Remote Status")}
                subtitle={statusLabel}
                onPress={checkGithubStatus}
                disabled={busy}
              />
              <Button
                title={copy(language, "Fetch (获取远端状态)", "Fetch Remote")}
                systemImage="arrow.down.circle"
                disabled={busy}
                action={fetchGithub}
              />
              <Button
                title={copy(language, "Push (推送到 GitHub)", "Push to GitHub")}
                systemImage="arrow.up.circle"
                disabled={busy || !githubState.branch}
                action={pushToGithub}
              />
              <Button
                title={copy(language, "Force Push (覆盖 GitHub)", "Force Push to GitHub")}
                systemImage="exclamationmark.arrow.trianglehead.counterclockwise.rotate.90"
                role="destructive"
                disabled={busy || !githubState.branch}
                action={forcePushToGithub}
              />
            </> : null}
          </Section>
        ) : null}

        {releaseVersionError ? <ErrorSection message={releaseVersionError} severity="warning" title={t("release")} /> : null}
        {gitService && projectPath ? <Section header={<Text>{t("release")}</Text>}>
          <Button action={openReleaseSettings} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }} disabled={busy}>
            <HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.largeActionRowHeight, alignment: "leading" }}>
              <Image systemName="shippingbox" foregroundStyle="blue" />
              <VStack spacing={2} alignment="leading"><Text font="subheadline">{t("publishRelease")}</Text><Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{releaseVersion ? `${t("releaseVersion")} · ${releaseVersion}` : t("releaseNotPublished")}</Text></VStack>
              <Spacer />
              <Image systemName="chevron.right" foregroundStyle="secondaryLabel" />
            </HStack>
          </Button>
        </Section> : null}

        {gitService && projectPath && releaseResult ? <Section header={<Text>{t("releasePublished")}</Text>}>
          <VStack spacing={7} alignment="leading">
            <Text font="subheadline">{`${t("releaseVersion")} · ${releaseResult.version}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{releaseResult.assetName} · {releaseResult.assetSize} bytes · ID {releaseResult.assetId}</Text>
            {releaseResult.existingRelease ? <Text font="caption" foregroundStyle="orange">{t("releaseAlreadyPublished").replace("{version}", releaseResult.version)}</Text> : null}
            <HStack spacing={8}>
              <Button title={t("viewGithubRelease")} systemImage="safari" buttonStyle="bordered" action={openRelease} />
              <Button title={t("copyDownloadUrl")} systemImage="doc.on.doc" buttonStyle="bordered" action={copyReleaseAssetUrl} />
            </HStack>
          </VStack>
        </Section> : null}
        <Section header={<Text>{copy(language, "界面", "Interface")}</Text>}>
          <SettingsRow icon="rectangle.3.group" title={copy(language, "布局密度", "Layout Density")} value={currentDensityLabel} onPress={chooseDensity} disabled={busy} minHeight={tokens.rowHeight} />
        </Section>
        <Section header={<Text>{copy(language, "语言", "Language")}</Text>}>
          <Button title={`${copy(language, "语言", "Language")} · ${preferenceLabel}`} systemImage="globe" action={chooseLanguage} />
        </Section>
      </List>
    </NavigationStack>
  )
}

export default SourceControlSettingsView
