import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useCallback, useEffect, useState, VStack } from "scripting"
import { GitHubReleaseService } from "../core/GitHubReleaseService"
import { GitHubReleaseResult } from "../core/types"
import { GitService } from "../core/GitService"
import { CloseButton } from "./CloseButton"
import { SettingsRow } from "./components/SettingsRow"
import { ErrorSection } from "./components/ErrorSection"
import { LoadingSection } from "./components/LoadingSection"
import { SourceControlReleaseView } from "./SourceControlReleaseView"
import { SourceControlProjectConfigView } from "./SourceControlProjectConfigView"
import { formatRemoteRepository, validateRemoteUrl, validateSupportedRemoteUrl, remoteRepositoryIdentity, checkGithubToken } from "../core/remote/RemoteValidation"
import { AppLanguage, LanguagePreference, getLanguagePreference, setLanguagePreference } from "./localization"
import { useTranslator } from "./useLocalization"
import { UIDensity } from "./design"
import { useUISettings } from "./useUISettings"
import { RemoteStatusState, useRemoteStatus } from "./useRemoteStatus"
import { RecentOperationHandler } from "./recentOperation"

export interface SourceControlSettingsViewProps {
  onLanguageChanged?: () => void
  onRemoteChanged?: () => Promise<void>
  onRecentOperation?: RecentOperationHandler
  gitService?: GitService
  projectPath?: string
}

type SettingsOperation = "remote" | "credential" | "check" | "fetch" | "push" | "force-push" | "release" | null

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

function githubStatusLabel(state: RemoteStatusState, language: AppLanguage): string {
  if (!state.selected) return copy(language, "尚未连接 GitHub", "Not connected to GitHub")
  if (!state.checked) return copy(language, "尚未检查 GitHub", "GitHub status has not been checked")
  if (!state.branch) return copy(language, "无法读取当前分支", "Unable to read the current branch")
  if (state.branches.length === 0) return copy(language, "GitHub 仓库为空", "GitHub repository is empty")
  if (!state.branches.some((item) => item.name === state.branch)) return copy(language, "未找到对应的 GitHub 分支", "The matching GitHub branch was not found")
  if (!state.aheadBehind) return copy(language, "无法读取 GitHub 状态", "Unable to read GitHub status")
  if (state.aheadBehind.diverged || (state.aheadBehind.ahead > 0 && state.aheadBehind.behind > 0)) return copy(language, "历史已分叉", "History has diverged")
  if (state.aheadBehind.ahead > 0) return copy(language, `本地领先 ${state.aheadBehind.ahead} 个版本`, `Local is ${state.aheadBehind.ahead} commit${state.aheadBehind.ahead === 1 ? "" : "s"} ahead`)
  if (state.aheadBehind.behind > 0) return copy(language, `GitHub 有 ${state.aheadBehind.behind} 个新版本`, `GitHub has ${state.aheadBehind.behind} newer commit${state.aheadBehind.behind === 1 ? "" : "s"}`)
  return copy(language, "已同步", "Synced")
}

export function SourceControlSettingsView({ onLanguageChanged, onRemoteChanged, onRecentOperation, gitService, projectPath }: SourceControlSettingsViewProps) {
  const dismiss = Navigation.useDismiss()
  const { t, language, refreshLanguage } = useTranslator()
  const { density, tokens, setDensity } = useUISettings()
  const remoteStatus = useRemoteStatus(gitService, projectPath, { initialLoading: false, tolerateBranchErrors: true })
  const { selected: selectedRemote, credential, credentialRemoteName, credentialBound, tokenStatus, checked, branch, branches, aheadBehind, loading, error: remoteStatusError, refresh: refreshRemoteStatus, invalidate: invalidateRemoteStatus, setVerification } = remoteStatus
  const [preference, setPreference] = useState<LanguagePreference>(getLanguagePreference())
  const [operation, setOperation] = useState<SettingsOperation>(null)
  const [forcePushLock] = useState({ active: false })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [releaseVersion, setReleaseVersion] = useState<string | null>(null)
  const [releaseVersionError, setReleaseVersionError] = useState<string | null>(null)
  const [releaseResult, setReleaseResult] = useState<GitHubReleaseResult | null>(null)
  const busy = operation !== null
  const statusError = errorMessage ?? remoteStatusError

  const loadVersion = useCallback(async () => {
    if (!gitService || !projectPath) {
      setReleaseVersion(null)
      setReleaseVersionError(null)
      setReleaseResult(null)
      return
    }
    try {
      const version = await new GitHubReleaseService(gitService, projectPath).getProjectVersion()
      setReleaseVersion(version)
      setReleaseVersionError(null)
    } catch (error) {
      setReleaseVersion(null)
      setReleaseVersionError(error instanceof Error ? error.message : String(error))
    }
  }, [gitService, projectPath])

  const openProjectConfig = async () => {
    if (!projectPath || busy) return
    await Navigation.present(
      <SourceControlProjectConfigView
        projectPath={projectPath}
        onSaved={async () => {
          await loadVersion()
        }}
      />
    )
    await loadVersion()
  }

  const notifyRemoteChanged = async () => {
    try {
      await onRemoteChanged?.()
    } catch (error) {
      console.error("[Settings] remote change callback failed", error)
    }
  }

  const refreshGithubConfiguration = async (preservedCredentialRemote?: { name: string } | null) => {
    return refreshRemoteStatus({
      preservedCredentialRemoteName: preservedCredentialRemote?.name ?? null,
      checked: false,
    })
  }

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
    let validatedUrl: string
    try {
      validatedUrl = validateSupportedRemoteUrl(url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      return
    }

    setOperation("remote")
    setErrorMessage(null)
    try {
       await gitService.addRemote(name.trim(), validatedUrl)
      await refreshGithubConfiguration()
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

    let validatedUrl: string
    let clearTokenAfterUpdate = false
    try {
      validatedUrl = validateSupportedRemoteUrl(url)
       if (remoteRepositoryIdentity(selectedRemote.url) !== remoteRepositoryIdentity(validatedUrl) && credential) {
        const choice = await Dialog.actionSheet({ title: copy(language, "Remote 已变化", "Remote Changed"), message: copy(language, "请选择当前 Token 的处理方式", "Choose what to do with the current token"), actions: [{ label: copy(language, "保留当前 Token", "Keep Token") }, { label: copy(language, "清除 Token", "Clear Token"), destructive: true }, { label: t("cancel") }] })
        if (choice === 1) clearTokenAfterUpdate = true
        if (choice !== 0 && choice !== 1) return
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      return
    }

    setOperation("remote")
    setErrorMessage(null)
    try {
      await gitService.setRemoteUrl(selectedRemote.name, validatedUrl)
      if (clearTokenAfterUpdate) await gitService.removeRemoteCredential(selectedRemote.name)
      await refreshGithubConfiguration()
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
      const hasCredential = await gitService.hasRemoteCredential(selectedRemote.name)
      await refreshGithubConfiguration()
      if (!hasCredential) setErrorMessage(copy(language, "未能确认访问令牌已保存。", "Unable to confirm that the access token was saved."))
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const removeToken = async () => {
    const tokenRemoteName = credentialRemoteName ?? selectedRemote?.name ?? null
    if (!gitService || !tokenRemoteName || !credential || busy) return
    const selected = await Dialog.actionSheet({
      title: copy(language, "移除访问令牌？", "Remove Access Token?"),
      message: copy(language, "这只会移除 Keychain 中保存的令牌，不会修改仓库配置。", "This removes the saved Keychain token without changing the repository configuration."),
      actions: [{ label: copy(language, "移除", "Remove"), destructive: true }],
    })
    if (selected !== 0) return

    setOperation("credential")
    invalidateRemoteStatus()
    setErrorMessage(null)
    try {
      await gitService.removeRemoteCredential(tokenRemoteName)
      await refreshGithubConfiguration()
      await notifyRemoteChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const removeRemote = async () => {
    if (!gitService || !selectedRemote || busy) return
    const selected = await Dialog.actionSheet({
      title: copy(language, "删除 Remote？", "Remove Remote?"),
      message: copy(language, "是否同时删除该 Remote 的访问令牌？", "Should the access token for this Remote also be deleted?"),
      actions: [
        { label: copy(language, "删除 Remote 和 Token", "Remove Remote and Token"), destructive: true },
        { label: copy(language, "仅删除 Remote", "Remove Remote Only") },
      ],
    })
    if (selected !== 0 && selected !== 1) return
    const removedRemote = selectedRemote
    setOperation("remote")
    invalidateRemoteStatus()
    setErrorMessage(null)
    try {
      await gitService.removeRemote(removedRemote.name)
      let operationError: unknown = null
      try {
        if (selected === 0) await gitService.removeRemoteCredential(removedRemote.name)
      } catch (error) {
        operationError = error
      }
      await refreshGithubConfiguration(selected === 1 ? removedRemote : null)
      await notifyRemoteChanged()
      if (operationError) throw operationError
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }
  const manageToken = async () => {
    if (!credential) {
      await setToken()
      return
    }
    if (!selectedRemote) {
      await removeToken()
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
      const token = await gitService.getRemoteCredential(selectedRemote.name)
      if (!token) {
        setVerification(true, "not-configured")
        return
      }
      const tokenCheck = await checkGithubToken(token.password, selectedRemote.url)
      setVerification(true, tokenCheck.status)
      await gitService.fetchRemote(selectedRemote.name)
      const refreshed = await refreshRemoteStatus({ checked: true, tokenStatus: tokenCheck.status })
      if (!refreshed) return
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
      const refreshed = await refreshRemoteStatus({ checked: true, tokenStatus: "configured-unverified" })
      if (!refreshed) return
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
      const result = await gitService.pushRemote(selectedRemote.name, branch)
      onRecentOperation?.({ kind: "push", identifier: result.localOid.slice(0, 7) })
      await checkGithubStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const forcePushToGithub = async () => {
    if (forcePushLock.active) return
    forcePushLock.active = true
    setOperation("force-push")
    setErrorMessage(null)
    try {
      if (!gitService || !selectedRemote) return
      const pushBranch = branch || (await gitService.getCurrentBranch())
      if (!pushBranch) {
        setErrorMessage("Force Push requires a local branch.")
        return
      }
      const status = await gitService.getStatus()
      if (!status.isClean) {
        setErrorMessage(copy(language, "工作区不干净，请先提交或还原未保存修改。", "Working tree is dirty. Commit or discard changes before force pushing."))
        return
      }
      const sync = aheadBehind || (await gitService.getAheadBehind(selectedRemote.name, pushBranch))
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

      const result = await gitService.forcePushLocalToRemote(selectedRemote.name, pushBranch)
      onRecentOperation?.({ kind: "force-push", identifier: result.localOid.slice(0, 7) })
      await checkGithubStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      forcePushLock.active = false
      setOperation(null)
    }
  }

  useEffect(() => {
    loadVersion().catch(console.error)
  }, [loadVersion])

  const openReleaseSettings = async () => {
    if (!gitService || !projectPath || busy) return
    try {
      await Navigation.present(<SourceControlReleaseView gitService={gitService} projectPath={projectPath} onRecentOperation={onRecentOperation} />)
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
  const tokenStatusLabel = tokenStatus === "not-configured" ? copy(language, "未配置", "Not Configured") : tokenStatus === "configured-unverified" ? (credentialBound ? copy(language, "已配置，未验证", "Configured, Not Verified") : copy(language, "已配置，未绑定 Remote", "Configured, No Remote Bound")) : tokenStatus === "valid" ? copy(language, "验证成功", "Verified") : tokenStatus === "invalid" ? copy(language, "验证失败", "Verification Failed") : copy(language, "权限不足", "Insufficient Permission")
  const statusLabel = githubStatusLabel(remoteStatus, language)

  return (
    <NavigationStack>
      <List navigationTitle={t("settings")} toolbar={{ topBarLeading: <CloseButton /> }}>
        <Section header={<Text>Source Control</Text>}>
          <VStack spacing={5} alignment="leading">
            <Text font="subheadline">{copy(language, "选择 → 说明 → 保存 → 同步", "Select → Explain → Save → Sync")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{copy(language, "选择需要保存的文件\n填写版本说明\n保存本地版本\n按需同步到 GitHub", "Select files to save\nAdd a version note\nSave a local version\nSync to GitHub when needed")}</Text>
          </VStack>
        </Section>

        {statusError ? <ErrorSection message={statusError} title={t("remoteUpdateFailed")} /> : null}
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
             {!loading && !selectedRemote && credential ? <Section><SettingsRow icon="key" title={copy(language, "访问令牌", "Access Token")} subtitle={tokenStatusLabel} onPress={manageToken} disabled={busy} /><Button title={copy(language, "清除 Token", "Clear Token")} systemImage="trash" role="destructive" disabled={busy} action={removeToken} /></Section> : null}
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
                subtitle={tokenStatusLabel}
                onPress={manageToken}
                disabled={busy || !isHttps(selectedRemote.url)}
              />
              {credential ? (
                <Button
                  title={copy(language, "清除 Token", "Clear Token")}
                  systemImage="trash"
                  role="destructive"
                  disabled={busy}
                  action={removeToken}
                />
              ) : null}
              <Button
                 title={copy(language, "删除 Remote", "Remove Remote")}
                 systemImage="trash"
                 role="destructive"
                 disabled={busy}
                 action={removeRemote}
               />
               <SettingsRow
                icon="arrow.triangle.branch"
                title={copy(language, "当前分支", "Current Branch")}
                subtitle={branch || copy(language, "未检出分支", "No branch")}
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
                disabled={busy || !branch}
                action={pushToGithub}
              />
              <Button
                title={copy(language, "Force Push (覆盖 GitHub)", "Force Push to GitHub")}
                systemImage="exclamationmark.arrow.trianglehead.counterclockwise.rotate.90"
                role="destructive"
                disabled={busy || !branch}
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
