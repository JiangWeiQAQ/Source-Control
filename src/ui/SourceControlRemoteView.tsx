import { Button, HStack, Image, List, Navigation, ProgressView, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitAheadBehind, GitRemoteBranch, GitRemoteInfo, GitRepositoryStatus } from "../core/types"
import { GitService } from "../core/GitService"
import { useTranslator } from "./useLocalization"

export interface SourceControlRemoteViewProps { gitService: GitService; onChanged: () => Promise<void> }
type ActiveOperation = "remote" | "credential" | "fetch" | "push" | null
type RemoteDiagnosticStep = "idle" | "tap_received" | "fetch_start" | "fetch_success" | "fetch_failed" | "reload_start" | "reload_success" | "reload_failed"
type RemoteState = { remotes: GitRemoteInfo[]; selected: string | null; branches: GitRemoteBranch[]; branch: string | null; status: GitRepositoryStatus | null; sync: GitAheadBehind | null; credential: boolean }

function isHttps(url: string): boolean { return /^https:\/\//i.test(url) }
function isGithubHttps(url: string): boolean { try { return isHttps(url) && new URL(url).hostname.toLowerCase() === "github.com" } catch { return false } }
function displayRepository(url: string): string { try { const parsed = new URL(url); return `${parsed.hostname}${parsed.pathname.replace(/\.git$/i, "")}` } catch { return url.replace(/^https?:\/\//i, "") } }
function sanitize(url: string): string { return url.replace(/^(https?:\/\/)([^/@]+@)/i, "$1••••@") }
function statusText(sync: GitAheadBehind | null): string { if (!sync) return "尚未获取远端状态"; if (sync.diverged) return "本地与远端已分叉"; if (sync.ahead === 0 && sync.behind === 0) return "已是最新"; if (sync.ahead > 0 && sync.behind === 0) return `${sync.ahead} 个提交待上传`; return `${sync.behind} 个提交待拉取` }

export function SourceControlRemoteView({ gitService, onChanged }: SourceControlRemoteViewProps) {
  const { t } = useTranslator(); const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<RemoteState>({ remotes: [], selected: null, branches: [], branch: null, status: null, sync: null, credential: false })
  const [loading, setLoading] = useState(true); const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null); const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasLocalCommit, setHasLocalCommit] = useState(false); const [fetchSucceeded, setFetchSucceeded] = useState(false)
  const [diagnosticStep, setDiagnosticStep] = useState<RemoteDiagnosticStep>("idle"); const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(null); const [diagnosticLocalBranch, setDiagnosticLocalBranch] = useState<string | null>(null); const [diagnosticRemoteBranches, setDiagnosticRemoteBranches] = useState<string[]>([])
  const selectedRemote = state.remotes.find((remote) => remote.name === state.selected) ?? null; const github = selectedRemote ? isGithubHttps(selectedRemote.url) : false; const busy = activeOperation !== null
  const localBranch = diagnosticLocalBranch; const canInitialUpload = fetchSucceeded && diagnosticStep === "reload_success" && hasLocalCommit && localBranch !== null && diagnosticRemoteBranches.length === 0

  const reloadRemoteState = async (preferred?: string | null) => {
    setLoading(true); setErrorMessage(null); setFetchSucceeded(false)
    try {
      const remotes = await gitService.listRemotes()
      const selected = preferred && remotes.some((remote) => remote.name === preferred) ? preferred : remotes.find((remote) => remote.name === "origin")?.name ?? remotes[0]?.name ?? null
      const branch = await gitService.getCurrentBranch(); const repositoryStatus = await gitService.getStatus()
      if (!selected) { setState({ remotes, selected: null, branches: [], branch, status: repositoryStatus, sync: null, credential: false }); return }
      const remote = remotes.find((item) => item.name === selected); const branches = await gitService.listRemoteBranches(selected); const credential = remote && isHttps(remote.url) ? await gitService.hasRemoteCredential(selected) : false; const sync = branch && branches.some((item) => item.name === branch) ? await gitService.getAheadBehind(selected, branch) : null
      setState({ remotes, selected, branches, branch, status: repositoryStatus, sync, credential })
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

  const checkStatus = async () => {
    setDiagnosticStep("tap_received"); setDiagnosticMessage("已收到点击")
    if (!selectedRemote) { setDiagnosticStep("fetch_failed"); setDiagnosticMessage("未选择远端仓库"); return }
    if (busy) return
    setFetchSucceeded(false); setHasLocalCommit(false); setDiagnosticLocalBranch(null); setDiagnosticRemoteBranches([]); setActiveOperation("fetch"); setDiagnosticStep("fetch_start"); setDiagnosticMessage("正在调用 Fetch…"); setErrorMessage(null)
    try {
      await gitService.fetchRemote(selectedRemote.name)
      setFetchSucceeded(true); setDiagnosticStep("fetch_success"); setDiagnosticMessage("Fetch 成功，正在读取远端分支…")
      setDiagnosticStep("reload_start"); setDiagnosticMessage("正在读取本地分支…")
      let branch: string | null
      try { branch = await gitService.getCurrentBranch() } catch (error) { setDiagnosticStep("reload_failed"); setDiagnosticMessage(`读取本地分支失败\n${error instanceof Error ? error.message : String(error)}`); return }
      setDiagnosticLocalBranch(branch); setDiagnosticMessage("正在读取远端分支…")
      let branches: GitRemoteBranch[]
      try { branches = await gitService.listRemoteBranches(selectedRemote.name) } catch (error) { setDiagnosticStep("reload_failed"); setDiagnosticMessage(`读取远端分支失败\n${error instanceof Error ? error.message : String(error)}`); return }
      setDiagnosticRemoteBranches(branches.map((item) => item.name)); setDiagnosticMessage("正在读取仓库状态…")
      try { await gitService.getStatus(); setHasLocalCommit((await gitService.getHistory(1)).length > 0) } catch (error) { setDiagnosticStep("reload_failed"); setDiagnosticMessage(`读取仓库状态失败\n${error instanceof Error ? error.message : String(error)}`); return }
      setDiagnosticStep("reload_success")
      if (branches.length === 0) { setDiagnosticMessage(`Fetch 成功\n本地分支：${branch ?? "无"}\n远端分支：无\nGitHub 仓库没有可用远端分支`); return }
      const matching = branch ? branches.find((item) => item.name === branch) : null
      if (branch && !matching) { setDiagnosticMessage(`检测到分支名称不一致\n本地：${branch}\nGitHub：${branches.map((item) => item.name).join(", ")}\n当前版本暂不自动修改分支。`); return }
      if (!branch || !matching) { setDiagnosticMessage(`Fetch 成功\n本地分支：${branch ?? "无"}\n远端分支：${branches.map((item) => item.name).join(", ")}`); return }
      try { const comparison = await gitService.getAheadBehind(selectedRemote.name, branch); setDiagnosticMessage(`Fetch 成功\n本地分支：${branch}\n远端分支：${branches.map((item) => item.name).join(", ")}\nahead: ${comparison.ahead}\nbehind: ${comparison.behind}\ndiverged: ${comparison.diverged}`) } catch (error) { setDiagnosticMessage(`读取同步差异失败\n${error instanceof Error ? error.message : String(error)}`) }
      await reloadRemoteState(selectedRemote.name)
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setDiagnosticStep("fetch_failed"); setDiagnosticMessage(message); setErrorMessage(`获取 GitHub 状态失败\n${message}`) } finally { setActiveOperation(null) }
  }

  const pushInitialUpload = async () => {
    if (!selectedRemote || !localBranch || !canInitialUpload || busy) return
    setActiveOperation("push"); setErrorMessage(null)
    try {
      await gitService.pushRemote(selectedRemote.name, localBranch)
      await reloadRemoteState(selectedRemote.name)
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }

  return <List navigationTitle="GitHub 同步" toolbar={{ topBarLeading: <Button title="关闭" systemImage="xmark" action={() => dismiss()} />, topBarTrailing: <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || busy} action={() => reloadRemoteState(state.selected)} /> }}>
    {errorMessage ? <Section><VStack spacing={5} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">获取 GitHub 状态失败</Text></HStack><Text font="footnote" foregroundStyle="red">{errorMessage}</Text></VStack></Section> : null}
    {diagnosticMessage ? <Section header={<Text>诊断</Text>}><VStack spacing={6} alignment="leading"><Text font="headline">{activeOperation === "fetch" ? "正在检查…" : diagnosticStep === "fetch_failed" || diagnosticStep === "reload_failed" ? "检查失败" : diagnosticStep === "reload_success" ? "检查完成" : "状态检查"}</Text><Text font="footnote" foregroundStyle={diagnosticStep === "fetch_failed" || diagnosticStep === "reload_failed" ? "red" : "secondaryLabel"}>{diagnosticMessage}</Text>{diagnosticStep === "reload_success" ? <><Text font="caption">本地分支：{diagnosticLocalBranch ?? "无"}</Text><Text font="caption">远端分支：{diagnosticRemoteBranches.length ? diagnosticRemoteBranches.join(", ") : "无"}</Text></> : null}</VStack></Section> : null}
    {loading ? <Section><VStack spacing={10} alignment="center"><ProgressView /><Text font="footnote" foregroundStyle="secondaryLabel">正在加载远端状态…</Text></VStack></Section> : null}
    {!loading && !selectedRemote ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">尚未连接 GitHub</Text><Text font="footnote" foregroundStyle="secondaryLabel">添加远端仓库后，可以检查 GitHub 状态。</Text><Button title="添加远端" action={addRemote} /></VStack></Section> : null}
    {!loading && selectedRemote ? <><Section header={<Text>GitHub 仓库</Text>}><VStack spacing={6} alignment="leading"><Text font="body">{displayRepository(selectedRemote.url)}</Text><Text font="caption" foregroundStyle="secondaryLabel">{sanitize(selectedRemote.url)}</Text></VStack></Section>{github ? <Section header={<Text>访问令牌</Text>}><VStack spacing={6} alignment="leading"><Text font="body">{state.credential ? "✓ 已配置" : "未设置"}</Text><HStack spacing={10}><Button title={state.credential ? "更新令牌" : "设置 Token"} disabled={busy} action={setToken} />{state.credential ? <Button title="移除" role="destructive" disabled={busy} action={removeToken} /> : null}</HStack></VStack></Section> : null}<Section header={<Text>同步状态</Text>}><VStack spacing={6} alignment="leading"><Text font="headline">{statusText(state.sync)}</Text>{state.branch ? <Text font="caption" foregroundStyle="secondaryLabel">本地分支：{state.branch}</Text> : null}<Button title={activeOperation === "fetch" ? "正在检查…" : "检查状态"} buttonStyle="borderedProminent" disabled={activeOperation !== null || selectedRemote === null} action={checkStatus} /></VStack></Section>{canInitialUpload ? <Section><VStack spacing={6} alignment="leading"><Text font="headline">{t("emptyGithubRepository")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("emptyGithubRepositoryHint")}</Text><Button title={activeOperation === "push" ? t("pushing") : t("initialUploadToGithub")} buttonStyle="borderedProminent" disabled={busy} action={pushInitialUpload} /></VStack></Section> : null}</> : null}
  </List>
}
export default SourceControlRemoteView
