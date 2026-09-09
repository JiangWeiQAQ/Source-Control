import { Button, HStack, Image, List, NavigationStack, ProgressView, Section, Spacer, Text, useState, VStack } from "scripting"
import { GitAheadBehind } from "../core/types"
import { RemoteStatusState, useRemoteStatus } from "./useRemoteStatus"
import { CloseButton } from "./CloseButton"
import { GitService } from "../core/GitService"
import { useTranslator } from "./useLocalization"
import { useUISettings } from "./useUISettings"
import { RecentOperationHandler } from "./recentOperation"

export interface SourceControlRemoteViewProps {
  gitService: GitService
  projectPath?: string
  onChanged: () => Promise<void>
  onRecentOperation?: RecentOperationHandler
  onOpenSettings?: () => Promise<void>
}

type ActiveOperation = "push" | "pull" | "force-push" | null

type RemoteState = Pick<RemoteStatusState, "remotes" | "selected" | "branches" | "branch" | "aheadBehind" | "hasLocalCommit">

export function SourceControlRemoteView({ gitService, projectPath, onChanged, onRecentOperation, onOpenSettings }: SourceControlRemoteViewProps) {
  const { t } = useTranslator()
  const { tokens } = useUISettings()
  const remoteStatus = useRemoteStatus(gitService, projectPath, { initialLoading: true, includeLocalCommit: true })
  const state: RemoteState = remoteStatus
  const { loading, error: remoteStatusError, refresh: refreshRemoteStatus, reset: resetRemoteStatus } = remoteStatus
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null)
  const [forcePushLock] = useState({ active: false })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const busy = activeOperation !== null
  const selectedRemote = state.selected

  const notifyChanged = async () => {
    try {
      await onChanged()
    } catch (callbackError) {
      console.error("[RemoteView] change callback failed", callbackError)
    }
  }

  const handleOpenSettings = async () => {
    if (!onOpenSettings) return
    const preferredRemote = selectedRemote?.name ?? null
    resetRemoteStatus()
    await onOpenSettings()
    await refreshRemoteStatus({ preferredRemoteName: preferredRemote })
  }

  const syncStateMessage = (sync: GitAheadBehind | null): string => {
    if (!sync) return t("repositoryInspection")
    if (sync.diverged || (sync.ahead > 0 && sync.behind > 0)) return t("divergedMessage")
    if (sync.behind > 0) return t("githubHasNewerVersions").replace("{count}", String(sync.behind))
    if (sync.ahead > 0) return t("localVersionsWaiting").replace("{count}", String(sync.ahead))
    return t("syncedToGithub")
  }

  const fetchLatestState = async (remoteName: string): Promise<RemoteState | null> => {
    await gitService.fetchRemote(remoteName)
    const latest = await refreshRemoteStatus({ preferredRemoteName: remoteName })
    if (!latest) return null
    return {
      remotes: latest.remotes,
      selected: latest.selected,
      branches: latest.branches,
      branch: latest.branch,
      aheadBehind: latest.aheadBehind,
      hasLocalCommit: latest.hasLocalCommit,
    }
  }

  const pushBranch = async (remoteName: string, branch: string) => {
    setActiveOperation("push")
    setErrorMessage(null)
    try {
      const latest = await fetchLatestState(remoteName)
      if (!latest) return
      const sync = latest.aheadBehind
      if (latest.branches.length > 0 && sync) {
        if (sync.diverged || (sync.ahead > 0 && sync.behind > 0)) {
          setErrorMessage(`${t("divergedMessage")}\n${syncStateMessage(sync)}`)
          return
        }
        if (sync.ahead === 0 && sync.behind > 0) {
          setErrorMessage(`${t("githubHasNewerVersions").replace("{count}", String(sync.behind))}\n${t("pullCloudVersion")}`)
          return
        }
        if (sync.ahead === 0 && sync.behind === 0) {
          setErrorMessage(t("syncedToGithub"))
          return
        }
      }
      const result = await gitService.pushRemote(remoteName, branch)
      onRecentOperation?.({ kind: "push", identifier: result.localOid.slice(0, 7) })
      await refreshRemoteStatus({ preferredRemoteName: remoteName })
      await notifyChanged()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/remote changed|non-fast-forward|not a simple fast-forward|fast-forward/i.test(message)) {
        try {
          const latest = await fetchLatestState(remoteName)
          if (latest) setErrorMessage(`${t("remoteChangedDuringSync")}\n${syncStateMessage(latest.aheadBehind)}`)
          await notifyChanged()
        } catch (refreshError) {
          setErrorMessage(refreshError instanceof Error ? refreshError.message : String(refreshError))
        }
      } else {
        setErrorMessage(message)
      }
    } finally {
      setActiveOperation(null)
    }
  }

  const syncToGithub = async () => {
    if (!selectedRemote || !state.branch || busy || !state.hasLocalCommit) return
    setActiveOperation("push")
    setErrorMessage(null)
    try {
      const latest = await fetchLatestState(selectedRemote.name)
      if (!latest) return
      const sync = latest.aheadBehind
      if (latest.branches.length > 0 && sync && (sync.ahead === 0 || sync.behind > 0 || sync.diverged)) {
        setErrorMessage(syncStateMessage(sync))
        return
      }
      const confirmed = await Dialog.confirm({
        title: t("syncToGitHub"),
        message: `${t("repository")}：${selectedRemote.name}\n${t("branch")}：${latest.branch || state.branch}`,
        cancelLabel: t("cancel"),
        confirmLabel: t("sync"),
      })
      if (!confirmed) return
      const result = await gitService.pushRemote(selectedRemote.name, latest.branch || state.branch)
      onRecentOperation?.({ kind: "push", identifier: result.localOid.slice(0, 7) })
      await refreshRemoteStatus({ preferredRemoteName: selectedRemote.name })
      await notifyChanged()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/remote changed|non-fast-forward|not a simple fast-forward|fast-forward/i.test(message)) {
        try {
          const latest = await fetchLatestState(selectedRemote.name)
          if (latest) setErrorMessage(`${t("remoteChangedDuringSync")}\n${syncStateMessage(latest.aheadBehind)}`)
          await notifyChanged()
        } catch (refreshError) {
          setErrorMessage(refreshError instanceof Error ? refreshError.message : String(refreshError))
        }
      } else {
        setErrorMessage(message)
      }
    } finally {
      setActiveOperation(null)
    }
  }

  const forcePushLocal = async () => {
    if (forcePushLock.active) return
    forcePushLock.active = true
    setActiveOperation("force-push")
    setErrorMessage(null)
    try {
      if (!selectedRemote || !state.branch || !state.aheadBehind || state.aheadBehind.ahead === 0 || state.aheadBehind.behind === 0) return
      const latest = await fetchLatestState(selectedRemote.name)
      if (!latest) return
      const sync = latest.aheadBehind
      if (!sync || sync.ahead === 0 || sync.behind === 0 || !sync.localOid || !sync.remoteOid) {
        setErrorMessage(syncStateMessage(sync))
        return
      }
      const firstConfirmed = await Dialog.confirm({ title: "以本地版本为准？", message: "GitHub 上当前分支的独立版本将被本地历史替换。\n\n本地版本不会删除。", cancelLabel: t("cancel"), confirmLabel: "继续" })
      if (!firstConfirmed) return
      const secondConfirmed = await Dialog.confirm({ title: "确认覆盖 GitHub？", message: `GitHub 当前：${sync.remoteOid.slice(0, 7)}\n本地当前：${sync.localOid.slice(0, 7)}\n\n此操作会重写 GitHub 分支历史。`, cancelLabel: t("cancel"), confirmLabel: "覆盖 GitHub" })
      if (!secondConfirmed) return
      const result = await gitService.forcePushLocalToRemote(selectedRemote.name, latest.branch || state.branch)
      onRecentOperation?.({ kind: "force-push", identifier: result.localOid.slice(0, 7) })
      await fetchLatestState(selectedRemote.name)
      await notifyChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      forcePushLock.active = false
      setActiveOperation(null)
    }
  }

  const pullRemote = async () => {
    if (!selectedRemote || !state.branch || busy) return
    setActiveOperation("pull")
    setErrorMessage(null)
    try {
      const latest = await fetchLatestState(selectedRemote.name)
      if (!latest || !latest.aheadBehind || latest.aheadBehind.ahead > 0 || latest.aheadBehind.diverged || latest.aheadBehind.behind === 0) return
      await gitService.pullRemote(selectedRemote.name, latest.branch || state.branch)
      await refreshRemoteStatus({ preferredRemoteName: selectedRemote.name })
      await notifyChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const syncContent = () => {
    if (!state.aheadBehind) {
      if (state.branches.length === 0 && state.hasLocalCommit) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("emptyGithubRepository")}</Text><Button title={activeOperation === "push" ? t("pushing") : t("syncToGitHub")} buttonStyle="borderedProminent" disabled={busy} action={syncToGithub} /></VStack>
      return <Text font="headline">{state.branches.length === 0 ? t("emptyGithubRepository") : t("repositoryInspection")}</Text>
    }
    if (state.aheadBehind.diverged || (state.aheadBehind.ahead > 0 && state.aheadBehind.behind > 0)) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("divergedMessage")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("localVersionsWaiting").replace("{count}", String(state.aheadBehind.ahead))}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("githubHasNewerVersions").replace("{count}", String(state.aheadBehind.behind))}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("automaticMergeUnavailable")}</Text><Button title={activeOperation === "force-push" ? t("pushing") : t("forcePushLocal")} systemImage="exclamationmark.triangle" buttonStyle="borderedProminent" disabled={busy} action={forcePushLocal} /></VStack>
    if (state.aheadBehind.ahead === 0 && state.aheadBehind.behind > 0) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("githubHasNewerVersions").replace("{count}", String(state.aheadBehind.behind))}</Text><Button title={activeOperation === "pull" ? t("pulling") : t("pullCloudVersion")} buttonStyle="borderedProminent" disabled={busy} action={pullRemote} /></VStack>
    if (state.aheadBehind.ahead === 0 && state.aheadBehind.behind === 0) return <Text font="headline">✓ {t("syncedToGithub")}</Text>
    return <VStack spacing={6} alignment="leading"><Text font="headline">{t("localVersionsWaiting").replace("{count}", String(state.aheadBehind.ahead))}</Text><Button title={activeOperation === "push" ? t("pushing") : t("syncToGitHub")} buttonStyle="borderedProminent" disabled={busy} action={syncToGithub} /></VStack>
  }

  const displayedError = errorMessage ?? remoteStatusError

  return <NavigationStack>
    <List navigationTitle={t("manageGithubSync")} toolbar={{ topBarLeading: <CloseButton />, topBarTrailing: <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || busy} action={() => refreshRemoteStatus({ preferredRemoteName: selectedRemote?.name ?? null })} /> }}>
    {displayedError ? <Section><VStack spacing={5} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">{t("remoteUpdateFailed")}</Text></HStack><Text font="footnote" foregroundStyle="red">{displayedError}</Text></VStack></Section> : null}
    {loading ? <Section><VStack spacing={10} alignment="center"><ProgressView /><Text font="footnote" foregroundStyle="secondaryLabel">{t("fetching")}</Text></VStack></Section> : null}
    {!loading && !selectedRemote ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">{t("notConnected")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("noRemoteHint")}</Text></VStack></Section> : null}
    {!loading && selectedRemote ? <>
      <Section header={<Text>{t("syncStatus")}</Text>}>
        <VStack spacing={8} alignment="leading">
          {state.branch ? <Text font="caption" foregroundStyle="secondaryLabel">{t("branch")}：{state.branch}</Text> : null}
          {syncContent()}
        </VStack>
      </Section>
      {onOpenSettings ? <Section><Button action={() => { handleOpenSettings().catch(console.error) }} buttonStyle="plain" disabled={busy} contentShape={{ kind: "interaction", shape: "rect" }}><HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.rowHeight, alignment: "leading" }}><Image systemName="gearshape" foregroundStyle="secondaryLabel" /><VStack spacing={2} alignment="leading"><Text font="subheadline">{t("githubSettings")}</Text><Text font="caption" foregroundStyle="secondaryLabel">{t("githubSettingsHint")}</Text></VStack><Spacer /><Image systemName="chevron.right" foregroundStyle="secondaryLabel" /></HStack></Button></Section> : null}
    </> : null}
    {!loading && !selectedRemote && onOpenSettings ? <Section><Button action={() => { handleOpenSettings().catch(console.error) }} buttonStyle="borderedProminent" disabled={busy} title={t("githubSettings")} /></Section> : null}
  </List>
  </NavigationStack>
}

export default SourceControlRemoteView
