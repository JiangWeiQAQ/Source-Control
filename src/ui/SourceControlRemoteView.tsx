import { Button, HStack, Image, List, Navigation, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { GitAheadBehind, GitRemoteBranch, GitRemoteInfo } from "../core/types"
import { GitService } from "../core/GitService"
import { useTranslator } from "./useLocalization"

export interface SourceControlRemoteViewProps {
  gitService: GitService
  onChanged: () => Promise<void>
  onOpenSettings?: () => Promise<void>
}

type ActiveOperation = "push" | "pull" | null
type RemoteState = {
  remotes: GitRemoteInfo[]
  selected: GitRemoteInfo | null
  branches: GitRemoteBranch[]
  branch: string | null
  sync: GitAheadBehind | null
  hasLocalCommit: boolean
}

const emptyState: RemoteState = {
  remotes: [],
  selected: null,
  branches: [],
  branch: null,
  sync: null,
  hasLocalCommit: false,
}

export function SourceControlRemoteView({ gitService, onChanged, onOpenSettings }: SourceControlRemoteViewProps) {
  const { t } = useTranslator()
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<RemoteState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const busy = activeOperation !== null
  const selectedRemote = state.selected

  const readState = async (preferred: string | null): Promise<RemoteState> => {
    const remotes = await gitService.listRemotes()
    const selected = preferred && remotes.some((remote) => remote.name === preferred)
      ? remotes.find((remote) => remote.name === preferred) || null
      : remotes.find((remote) => remote.name === "origin") || remotes[0] || null
    const branch = await gitService.getCurrentBranch()
    const branches = selected ? await gitService.listRemoteBranches(selected.name) : []
    const hasLocalCommit = (await gitService.getHistory(1)).length > 0
    const sync = branch && selected && branches.some((item) => item.name === branch)
      ? await gitService.getAheadBehind(selected.name, branch)
      : null
    return { remotes, selected, branches, branch, sync, hasLocalCommit }
  }

  const reloadRemoteState = async (preferred?: string | null) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      setState(await readState(preferred || null))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadRemoteState().catch(console.error)
  }, [])

  const notifyChanged = async () => {
    try {
      await onChanged()
    } catch (callbackError) {
      console.error("[RemoteView] change callback failed", callbackError)
    }
  }

  const pushBranch = async (remoteName: string, branch: string) => {
    setActiveOperation("push")
    setErrorMessage(null)
    try {
      await gitService.pushRemote(remoteName, branch)
      setState(await readState(remoteName))
      await notifyChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const syncToGithub = async () => {
    if (!selectedRemote || !state.branch || busy || !state.hasLocalCommit) return
    if (state.branches.length > 0 && (!state.sync || state.sync.ahead === 0 || state.sync.behind > 0 || state.sync.diverged)) return
    const confirmed = await Dialog.confirm({
      title: t("syncToGitHub"),
      message: `${t("repository")}：${selectedRemote.name}\n${t("branch")}：${state.branch}`,
      cancelLabel: t("cancel"),
      confirmLabel: t("sync"),
    })
    if (!confirmed) return
    await pushBranch(selectedRemote.name, state.branch)
  }

  const pullRemote = async () => {
    if (!selectedRemote || !state.branch || busy) return
    setActiveOperation("pull")
    setErrorMessage(null)
    try {
      await gitService.pullRemote(selectedRemote.name, state.branch)
      setState(await readState(selectedRemote.name))
      await notifyChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const syncContent = () => {
    if (!state.sync) {
      if (state.branches.length === 0 && state.hasLocalCommit) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("emptyGithubRepository")}</Text><Button title={activeOperation === "push" ? t("pushing") : t("syncToGitHub")} buttonStyle="borderedProminent" disabled={busy} action={syncToGithub} /></VStack>
      return <Text font="headline">{state.branches.length === 0 ? t("emptyGithubRepository") : t("repositoryInspection")}</Text>
    }
    if (state.sync.diverged || (state.sync.ahead > 0 && state.sync.behind > 0)) return <VStack spacing={4} alignment="leading"><Text font="headline">{t("divergedMessage")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("automaticMergeUnavailable")}</Text></VStack>
    if (state.sync.ahead === 0 && state.sync.behind > 0) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("githubHasNewerVersions").replace("{count}", String(state.sync.behind))}</Text><Button title={activeOperation === "pull" ? t("pulling") : t("pullCloudVersion")} buttonStyle="borderedProminent" disabled={busy} action={pullRemote} /></VStack>
    if (state.sync.ahead === 0 && state.sync.behind === 0) return <Text font="headline">✓ {t("syncedToGithub")}</Text>
    return <VStack spacing={6} alignment="leading"><Text font="headline">{t("localVersionsWaiting").replace("{count}", String(state.sync.ahead))}</Text><Button title={activeOperation === "push" ? t("pushing") : t("syncToGitHub")} buttonStyle="borderedProminent" disabled={busy} action={syncToGithub} /></VStack>
  }

  return <List navigationTitle={t("manageGithubSync")} toolbar={{ topBarLeading: <Button title={t("close")} systemImage="xmark" action={() => dismiss()} />, topBarTrailing: <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || busy} action={() => reloadRemoteState(selectedRemote?.name)} /> }}>
    {errorMessage ? <Section><VStack spacing={5} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">{t("remoteUpdateFailed")}</Text></HStack><Text font="footnote" foregroundStyle="red">{errorMessage}</Text></VStack></Section> : null}
    {loading ? <Section><VStack spacing={10} alignment="center"><ProgressView /><Text font="footnote" foregroundStyle="secondaryLabel">{t("fetching")}</Text></VStack></Section> : null}
    {!loading && !selectedRemote ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">{t("notConnected")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("noRemoteHint")}</Text></VStack></Section> : null}
    {!loading && selectedRemote ? <>
      <Section header={<Text>{t("syncStatus")}</Text>}>
        <VStack spacing={8} alignment="leading">
          {state.branch ? <Text font="caption" foregroundStyle="secondaryLabel">{t("branch")}：{state.branch}</Text> : null}
          {syncContent()}
        </VStack>
      </Section>
      {onOpenSettings ? <Section><Button action={onOpenSettings} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}><HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 52, alignment: "leading" }}><Image systemName="gearshape" foregroundStyle="secondaryLabel" /><VStack spacing={2} alignment="leading"><Text font="subheadline">{t("githubSettings")}</Text><Text font="caption" foregroundStyle="secondaryLabel">{t("githubSettingsHint")}</Text></VStack><Spacer /><Image systemName="chevron.right" foregroundStyle="secondaryLabel" /></HStack></Button></Section> : null}
    </> : null}
    {!loading && !selectedRemote && onOpenSettings ? <Section><Button action={onOpenSettings} buttonStyle="borderedProminent" title={t("githubSettings")} /></Section> : null}
  </List>
}

export default SourceControlRemoteView
