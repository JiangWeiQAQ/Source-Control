import { Button, Divider, HStack, Image, List, Navigation, ProgressView, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitCommitInfo } from "../core/types"
import { GitService } from "../core/GitService"
import { formatHistoryTime } from "./formatDate"
import { AppLanguage, createTranslator } from "./localization"

type CompareRow = { local: GitCommitInfo | null; remote: GitCommitInfo | null }
type Target = { remote: string; branch: string } | null
export interface SourceControlHistoryCompareViewProps { gitService: GitService; language?: AppLanguage }

export function alignHistory(local: GitCommitInfo[], remote: GitCommitInfo[]): CompareRow[] {
  const localOids = new Set(local.map((item) => item.oid)); const remoteOids = new Set(remote.map((item) => item.oid)); const rows: CompareRow[] = []
  let localIndex = 0; let remoteIndex = 0
  while (localIndex < local.length || remoteIndex < remote.length) {
    const left = local[localIndex] || null; const right = remote[remoteIndex] || null
    if (!left) { rows.push({ local: null, remote: right }); remoteIndex++; continue }
    if (!right) { rows.push({ local: left, remote: null }); localIndex++; continue }
    if (left.oid === right.oid) { rows.push({ local: left, remote: right }); localIndex++; remoteIndex++; continue }
    if (!remoteOids.has(left.oid) && !localOids.has(right.oid)) { rows.push({ local: left, remote: right }); localIndex++; remoteIndex++; continue }
    if (!remoteOids.has(left.oid)) { rows.push({ local: left, remote: null }); localIndex++; continue }
    if (!localOids.has(right.oid)) { rows.push({ local: null, remote: right }); remoteIndex++; continue }
    rows.push({ local: left, remote: right }); localIndex++; remoteIndex++
  }
  return rows
}

function CommitCell({ commit, status }: { commit: GitCommitInfo | null; status: "local" | "remote" | "shared" }) {
  if (!commit) return <Text font="caption" foregroundStyle="tertiaryLabel">—</Text>
  return <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", minHeight: 64, alignment: "leading" }}><Text font="subheadline" lineLimit={2}>{commit.message}</Text><Text font="caption2" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)} · {commit.shortOid}</Text>{status !== "shared" ? <Text font="caption2" foregroundStyle={status === "local" ? "blue" : "orange"}>{status === "local" ? "仅本地" : "仅云端"}</Text> : null}</VStack>
}

export function SourceControlHistoryCompareView({ gitService, language = "en" }: SourceControlHistoryCompareViewProps) {
  const dismiss = Navigation.useDismiss(); const t = createTranslator(language)
  const [target, setTarget] = useState<Target>(null); const [rows, setRows] = useState<CompareRow[]>([]); const [loading, setLoading] = useState(true); const [fetching, setFetching] = useState(false); const [state, setState] = useState<"ready" | "noRemote" | "needsFetch" | "error">("ready"); const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const resolveTarget = async (): Promise<Target> => { const remotes = await gitService.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await gitService.getCurrentBranch(); return remote && branch ? { remote: remote.name, branch } : null }
  const load = async () => {
    setLoading(true); setErrorMessage(null)
    try {
      const next = await resolveTarget(); setTarget(next)
      if (!next) { setState("noRemote"); setRows([]); return }
      const remoteBranches = await gitService.listRemoteBranches(next.remote)
      if (!remoteBranches.some((item) => item.name === next.branch)) { setState("needsFetch"); setRows([]); return }
      const [local, remote] = await Promise.all([gitService.getHistory(50), gitService.getRemoteHistory(next.remote, next.branch, 50)])
      setRows(alignHistory(local, remote)); setState("ready")
    } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }
  const refresh = async () => { const next = target || await resolveTarget(); if (!next || fetching) return; setFetching(true); try { await gitService.fetchRemote(next.remote); await load() } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setFetching(false) } }
  useEffect(() => { load().catch(console.error) }, [])
  const diverged = rows.some((row) => row.local && row.remote && row.local.oid !== row.remote.oid)

  return <List navigationTitle="版本对照" toolbar={{ topBarLeading: <Button title={t("close")} action={() => dismiss()} />, topBarTrailing: <Button title={fetching ? t("fetching") : t("refresh")} systemImage="arrow.clockwise" disabled={loading || fetching || state === "noRemote"} action={refresh} /> }}>
    <Section><Text font="footnote" foregroundStyle="secondaryLabel">左侧为本地版本，右侧为最近一次 Fetch 后的 GitHub 版本。</Text><HStack spacing={8}><Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" }}>本地版本</Text><Divider /><Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" }}>GitHub 版本</Text></HStack>{target ? <Text font="caption" foregroundStyle="secondaryLabel">{target.remote} · {target.branch}</Text> : null}</Section>
    {diverged ? <Section><Text font="footnote" foregroundStyle="orange">本地和 GitHub 历史已分叉</Text></Section> : null}
    {loading ? <Section><ProgressView /></Section> : null}
    {state === "noRemote" ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">尚未连接 GitHub</Text><Text font="footnote" foregroundStyle="secondaryLabel">无法进行本地与云端版本对照。</Text></VStack></Section> : null}
    {state === "needsFetch" ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">尚未获取 GitHub 版本</Text><Button title={fetching ? t("fetching") : "获取云端版本"} buttonStyle="borderedProminent" disabled={fetching} action={refresh} /></VStack></Section> : null}
    {state === "error" ? <Section><VStack spacing={8} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">版本对照读取失败</Text></HStack><Text font="footnote" foregroundStyle="red">{errorMessage}</Text><Button title={t("retry")} action={load} /></VStack></Section> : null}
    {state === "ready" && !loading && rows.length === 0 ? <Section><Text font="footnote" foregroundStyle="secondaryLabel">暂无本地或 GitHub 版本。</Text></Section> : null}
    {state === "ready" ? <Section>{rows.map((row, index) => <HStack key={`${row.local?.oid || "-"}-${row.remote?.oid || "-"}-${index}`} spacing={8} alignment="top"><CommitCell commit={row.local} status={row.local && row.remote?.oid === row.local.oid ? "shared" : "local"} /><Divider /><CommitCell commit={row.remote} status={row.remote && row.local?.oid === row.remote.oid ? "shared" : "remote"} /></HStack>)}</Section> : null}
  </List>
}
export default SourceControlHistoryCompareView
