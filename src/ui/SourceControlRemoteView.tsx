import { Button, HStack, Image, List, Navigation, ProgressView, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitAheadBehind, GitRemoteBranch, GitRemoteInfo, GitRepositoryStatus } from "../core/types"
import { GitService } from "../core/GitService"
import { useTranslator } from "./useLocalization"

export interface SourceControlRemoteViewProps { gitService: GitService; onChanged: () => Promise<void> }
type ActiveOperation = "remote" | "credential" | "fetch" | "push" | "pull" | null
type RemoteState = { remotes: GitRemoteInfo[]; selected: string | null; branches: GitRemoteBranch[]; branch: string | null; status: GitRepositoryStatus | null; sync: GitAheadBehind | null; credential: boolean }

function isHttps(url: string): boolean { return /^https:\/\//i.test(url) }
function isGithubHttps(url: string): boolean { try { return isHttps(url) && new URL(url).hostname.toLowerCase() === "github.com" } catch { return false } }
function displayRepository(url: string): string { try { const parsed = new URL(url); return `${parsed.hostname}${parsed.pathname.replace(/\.git$/i, "")}` } catch { return url.replace(/^https?:\/\//i, "") } }
function sanitize(url: string): string { return url.replace(/^(https?:\/\/)([^/@]+@)/i, "$1••••@") }

export function SourceControlRemoteView({ gitService, onChanged }: SourceControlRemoteViewProps) {
  const { t } = useTranslator(); const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<RemoteState>({ remotes: [], selected: null, branches: [], branch: null, status: null, sync: null, credential: false })
  const [loading, setLoading] = useState(true); const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null); const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasCheckedStatus, setHasCheckedStatus] = useState(false)
  const selectedRemote = state.remotes.find((remote) => remote.name === state.selected) ?? null; const github = selectedRemote ? isGithubHttps(selectedRemote.url) : false; const busy = activeOperation !== null

  const reloadRemoteState = async (preferred?: string | null) => {
    setLoading(true); setErrorMessage(null); setHasCheckedStatus(false)
    try {
      const remotes = await gitService.listRemotes()
      const selected = preferred && remotes.some((remote) => remote.name === preferred) ? preferred : remotes.find((remote) => remote.name === "origin")?.name ?? remotes[0]?.name ?? null
      const branch = await gitService.getCurrentBranch(); const repositoryStatus = await gitService.getStatus()
      if (!selected) { setState({ remotes, selected: null, branches: [], branch, status: repositoryStatus, sync: null, credential: false }); return }
      const remote = remotes.find((item) => item.name === selected); const branches = await gitService.listRemoteBranches(selected); const credential = remote && isHttps(remote.url) ? await gitService.hasRemoteCredential(selected) : false
      setState({ remotes, selected, branches, branch, status: repositoryStatus, sync: null, credential })
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }

  useEffect(() => { reloadRemoteState().catch(console.error) }, [])

  const addRemote = async () => {
    if (busy) return
    const name = await Dialog.prompt({ title: "Add Remote", message: "Remote Name", defaultValue: "origin", placeholder: "origin", cancelLabel: "Cancel", confirmLabel: "Next" }); if (name === null || !name.trim()) return
    const url = await Dialog.prompt({ title: "Add Remote", message: "Remote URL", placeholder: "https://github.com/user/repository.git", cancelLabel: "Cancel", confirmLabel: "Add" }); if (url === null || !url.trim()) return
    setActiveOperation("remote"); setErrorMessage(null)
    try { await gitService.addRemote(name.trim(), url.trim()); await reloadRemoteState(name.trim()) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  const setToken = async () => {
    if (!selectedRemote || !github || busy) return
    const token = await Dialog.prompt({ title: "GitHub Token", message: "Token 仅保存在系统 Keychain 中。", placeholder: "GitHub Token", obscureText: true, cancelLabel: "取消", confirmLabel: "保存" }); if (token === null || !token.trim()) return
    setActiveOperation("credential"); setErrorMessage(null)
    try { await gitService.setRemoteCredential(selectedRemote.name, { username: "x-access-token", password: token.trim() }); setState({ ...state, credential: await gitService.hasRemoteCredential(selectedRemote.name) }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  const removeToken = async () => {
    if (!selectedRemote || !github || busy) return
    const selected = await Dialog.actionSheet({ title: "Remove Stored Credential?", message: "This removes the saved credential from Keychain.\nThe remote configuration will remain unchanged.", actions: [{ label: "Remove", destructive: true }] }); if (selected !== 0) return
    setActiveOperation("credential"); setErrorMessage(null)
    try { await gitService.removeRemoteCredential(selectedRemote.name); setState({ ...state, credential: false }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  const pushBranch = async (remoteName: string, branch: string) => {
    setActiveOperation("push"); setErrorMessage(null)
    try { await gitService.pushRemote(remoteName, branch); await gitService.fetchRemote(remoteName); const sync = await gitService.getAheadBehind(remoteName, branch); await reloadRemoteState(remoteName); setHasCheckedStatus(true); setState((current) => ({ ...current, sync })) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  const checkAndSync = async () => {
    if (!selectedRemote || busy) return
    setActiveOperation("fetch"); setErrorMessage(null); setHasCheckedStatus(false)
    try {
      await gitService.fetchRemote(selectedRemote.name)
      const branch = await gitService.getCurrentBranch(); const branches = await gitService.listRemoteBranches(selectedRemote.name); const repositoryStatus = await gitService.getStatus(); const hasLocalCommit = (await gitService.getHistory(1)).length > 0
      const credential = isHttps(selectedRemote.url) ? await gitService.hasRemoteCredential(selectedRemote.name) : false
      let sync: GitAheadBehind | null = null
      if (branch && branches.some((item) => item.name === branch)) sync = await gitService.getAheadBehind(selectedRemote.name, branch)
      setState({ remotes: state.remotes, selected: selectedRemote.name, branches, branch, status: repositoryStatus, sync, credential }); setHasCheckedStatus(true)
      if (!branch || (branches.length > 0 && !sync)) return
      if (branches.length === 0) {
        if (!hasLocalCommit) return
        const confirmed = await Dialog.confirm({ title: t("firstUploadQuestion"), message: `${t("repository")}：${displayRepository(selectedRemote.url)}\n${t("branch")}：${branch}`, cancelLabel: t("cancel"), confirmLabel: t("upload") })
        if (confirmed) await pushBranch(selectedRemote.name, branch)
        return
      }
      if (!sync) return
      if (sync.ahead > 0 && sync.behind === 0) {
        const confirmed = await Dialog.confirm({ title: t("localVersionsWaiting").replace("{count}", String(sync.ahead)), message: "", cancelLabel: t("cancel"), confirmLabel: t("sync") })
        if (confirmed) await pushBranch(selectedRemote.name, branch)
      }
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation((current) => current === "fetch" ? null : current) }
  }

  const pullRemote = async () => {
    if (!selectedRemote || !state.branch || busy) return
    setActiveOperation("pull"); setErrorMessage(null)
    try { await gitService.pullRemote(selectedRemote.name, state.branch); await onChanged(); await gitService.fetchRemote(selectedRemote.name); const sync = await gitService.getAheadBehind(selectedRemote.name, state.branch); await reloadRemoteState(selectedRemote.name); setHasCheckedStatus(true); setState((current) => ({ ...current, sync })) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  const syncContent = () => {
    if (!hasCheckedStatus) return <Text font="headline">{t("notCheckedGithub")}</Text>
    if (!state.sync) return <Text font="headline">{state.branches.length === 0 ? t("emptyGithubRepository") : t("repositoryInspection")}</Text>
    if (state.sync.diverged || (state.sync.ahead > 0 && state.sync.behind > 0)) return <VStack spacing={4} alignment="leading"><Text font="headline">{t("divergedMessage")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("automaticMergeUnavailable")}</Text></VStack>
    if (state.sync.ahead === 0 && state.sync.behind > 0) return <VStack spacing={6} alignment="leading"><Text font="headline">{t("githubHasNewerVersions").replace("{count}", String(state.sync.behind))}</Text><Button title={activeOperation === "pull" ? t("pulling") : t("pullCloudVersion")} buttonStyle="borderedProminent" disabled={busy} action={pullRemote} /></VStack>
    if (state.sync.ahead === 0 && state.sync.behind === 0) return <Text font="headline">✓ {t("syncedToGithub")}</Text>
    return <Text font="headline">{t("localVersionsWaiting").replace("{count}", String(state.sync.ahead))}</Text>
  }

  return <List navigationTitle="GitHub 同步" toolbar={{ topBarLeading: <Button title="关闭" systemImage="xmark" action={() => dismiss()} />, topBarTrailing: <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || busy} action={() => reloadRemoteState(state.selected)} /> }}>
    {errorMessage ? <Section><VStack spacing={5} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">获取 GitHub 状态失败</Text></HStack><Text font="footnote" foregroundStyle="red">{errorMessage}</Text></VStack></Section> : null}
    {loading ? <Section><VStack spacing={10} alignment="center"><ProgressView /><Text font="footnote" foregroundStyle="secondaryLabel">正在加载远端状态…</Text></VStack></Section> : null}
    {!loading && !selectedRemote ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">尚未连接 GitHub</Text><Text font="footnote" foregroundStyle="secondaryLabel">添加远端仓库后，可以检查 GitHub 状态。</Text><Button title="添加远端" action={addRemote} /></VStack></Section> : null}
    {!loading && selectedRemote ? <><Section header={<Text>GitHub 仓库</Text>}><VStack spacing={6} alignment="leading"><Text font="body">{displayRepository(selectedRemote.url)}</Text><Text font="caption" foregroundStyle="secondaryLabel">{sanitize(selectedRemote.url)}</Text></VStack></Section>{github ? <Section header={<Text>访问令牌</Text>}><VStack spacing={6} alignment="leading"><Text font="body">{state.credential ? "✓ 已配置" : "未设置"}</Text><HStack spacing={10}><Button title={state.credential ? "更新令牌" : "设置 Token"} disabled={busy} action={setToken} />{state.credential ? <Button title="移除" role="destructive" disabled={busy} action={removeToken} /> : null}</HStack></VStack></Section> : null}<Section header={<Text>{t("syncStatus")}</Text>}><VStack spacing={6} alignment="leading">{syncContent()}{state.branch ? <Text font="caption" foregroundStyle="secondaryLabel">{t("branch")}：{state.branch}</Text> : null}{activeOperation === "fetch" ? <HStack spacing={8}><ProgressView /><Text font="footnote">{t("checkingGithub")}</Text></HStack> : !(hasCheckedStatus && state.sync && state.sync.ahead === 0 && state.sync.behind > 0) ? <Button title={t("checkAndSync")} buttonStyle="borderedProminent" disabled={busy} action={checkAndSync} /> : null}</VStack></Section></> : null}
  </List>
}
export default SourceControlRemoteView
