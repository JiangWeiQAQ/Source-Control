import { Button, Divider, HStack, Image, List, Navigation, ProgressView, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitBranchResetResult, GitCommitInfo, GitCommitWorkingTreeRestoreResult } from "../core/types"
import { GitService } from "../core/GitService"
import { formatHistoryTime } from "./formatDate"
import { AppLanguage, createTranslator } from "./localization"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"

type CompareRow = { local: GitCommitInfo | null; remote: GitCommitInfo | null }
type Target = { remote: string; branch: string } | null
type HistoryNavigationResult = GitCommitWorkingTreeRestoreResult | GitBranchResetResult
function isHistoryNavigationResult(value: unknown): value is HistoryNavigationResult {
  if (!value || typeof value !== "object") return false
  const result = value as {
    restored?: unknown
    reset?: unknown
    oid?: unknown
    fromOid?: unknown
    toOid?: unknown
    shortOid?: unknown
    changedFiles?: unknown
  }
  if (result.restored === true) return typeof result.oid === "string" && typeof result.shortOid === "string" && typeof result.changedFiles === "number"
  return result.reset === true && typeof result.fromOid === "string" && typeof result.toOid === "string" && typeof result.shortOid === "string"
}
export interface SourceControlHistoryCompareViewProps { gitService: GitService; language?: AppLanguage; onChanged?: () => Promise<void> }
export function alignHistory(local: GitCommitInfo[], remote: GitCommitInfo[]): CompareRow[] {
  const remoteOids = new Set(remote.map((item) => item.oid))
  const rows: CompareRow[] = []
  const localCommonIndex = local.findIndex((item) => remoteOids.has(item.oid))

  // 没有共同 OID 时，两条历史完全独立，按各自最新到最旧的顺序并排展示。
  if (localCommonIndex < 0) {
    const length = Math.max(local.length, remote.length)
    for (let index = 0; index < length; index += 1) rows.push({ local: local[index] || null, remote: remote[index] || null })
    return rows
  }

  const commonOid = local[localCommonIndex].oid
  const remoteCommonIndex = remote.findIndex((item) => item.oid === commonOid)
  const localOnly = local.slice(0, localCommonIndex)
  const remoteOnly = remote.slice(0, remoteCommonIndex)
  const independentLength = Math.max(localOnly.length, remoteOnly.length)
  for (let index = 0; index < independentLength; index += 1) rows.push({ local: localOnly[index] || null, remote: remoteOnly[index] || null })

  // 共同祖先及其之后的历史仍以完整 OID 对齐，不因 message/time 相同而配对。
  let localIndex = localCommonIndex
  let remoteIndex = remoteCommonIndex
  while (localIndex < local.length || remoteIndex < remote.length) {
    const left = local[localIndex] || null
    const right = remote[remoteIndex] || null
    if (!left) { rows.push({ local: null, remote: right }); remoteIndex += 1; continue }
    if (!right) { rows.push({ local: left, remote: null }); localIndex += 1; continue }
    if (left.oid === right.oid) { rows.push({ local: left, remote: right }); localIndex += 1; remoteIndex += 1; continue }

    const remoteHasLeft = remote.slice(remoteIndex).some((item) => item.oid === left.oid)
    const localHasRight = local.slice(localIndex).some((item) => item.oid === right.oid)
    if (!remoteHasLeft) { rows.push({ local: left, remote: null }); localIndex += 1; continue }
    if (!localHasRight) { rows.push({ local: null, remote: right }); remoteIndex += 1; continue }

    // 仅在两侧都仍有该 OID 时前进，避免退化为 local[i] ↔ remote[i]。
    const remoteMatch = remote.slice(remoteIndex).findIndex((item) => item.oid === left.oid)
    const localMatch = local.slice(localIndex).findIndex((item) => item.oid === right.oid)
    if (remoteMatch <= localMatch) {
      rows.push({ local: left, remote: null }); localIndex += 1
    } else {
      rows.push({ local: null, remote: right }); remoteIndex += 1
    }
  }
  return rows
}
function CommitCell({ commit, status, onSelect }: { commit: GitCommitInfo | null; status: "local" | "remote" | "shared"; onSelect?: (commit: GitCommitInfo) => void }) { if (!commit) return <VStack frame={{ maxWidth: "infinity", minHeight: 92, alignment: "center" }}><Text font="title3" foregroundStyle="tertiaryLabel">—</Text></VStack>; const content = <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", minHeight: 92, alignment: "leading" }} padding={{ top: 10, bottom: 10 }}><Text font="subheadline" lineLimit={2}>{commit.message}</Text><Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)}</Text><Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commit.shortOid}</Text>{status !== "shared" ? <Text font="caption2" foregroundStyle={status === "local" ? "blue" : "orange"}>{status === "local" ? "仅本地" : "仅云端"}</Text> : null}</VStack>; return onSelect ? <Button action={() => onSelect(commit)} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>{content}</Button> : content }
export function SourceControlHistoryCompareView({ gitService, language = "en", onChanged }: SourceControlHistoryCompareViewProps) { const dismiss = Navigation.useDismiss(); const t = createTranslator(language); const [target, setTarget] = useState<Target>(null); const [rows, setRows] = useState<CompareRow[]>([]); const [loading, setLoading] = useState(true); const [fetching, setFetching] = useState(false); const [state, setState] = useState<"ready" | "noRemote" | "needsFetch" | "error">("ready"); const [errorMessage, setErrorMessage] = useState<string | null>(null); const resolveTarget = async (): Promise<Target> => { const remotes = await gitService.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await gitService.getCurrentBranch(); return remote && branch ? { remote: remote.name, branch } : null }; const load = async () => { setLoading(true); setErrorMessage(null); try { const next = await resolveTarget(); setTarget(next); if (!next) { setState("noRemote"); setRows([]); return } const remoteBranches = await gitService.listRemoteBranches(next.remote); if (!remoteBranches.some((item) => item.name === next.branch)) { setState("needsFetch"); setRows([]); return } const [local, remote] = await Promise.all([gitService.getHistory(50), gitService.getRemoteHistory(next.remote, next.branch, 50)]); setRows(alignHistory(local, remote)); setState("ready") } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) } }; const refresh = async () => { const next = target || await resolveTarget(); if (!next || fetching) return; setFetching(true); try { await gitService.fetchRemote(next.remote); await load() } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setFetching(false) } }; const openCommitDetail = async (commit: GitCommitInfo) => { try { const result = await Navigation.present<HistoryNavigationResult | null>(<SourceControlCommitDetailView gitService={gitService} oid={commit.oid} shortOid={commit.shortOid} />); if (isHistoryNavigationResult(result)) { try { await onChanged?.() } catch (callbackError) { console.error("[HistoryCompare] restore callback failed", callbackError) } dismiss(result) } } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } }; useEffect(() => { load().catch(console.error) }, []); const hasSharedCommit = rows.some((row) => row.local && row.remote && row.local.oid === row.remote.oid); const diverged = rows.some((row) => row.local && row.remote && row.local.oid !== row.remote.oid); const noCommonAncestor = rows.length > 0 && !hasSharedCommit; return <List navigationTitle="版本对照" toolbar={{ topBarLeading: <Button title={t("close")} action={() => dismiss()} />, topBarTrailing: <Button title={fetching ? t("fetching") : t("refresh")} systemImage="arrow.clockwise" disabled={loading || fetching || state === "noRemote"} action={refresh} /> }}><Section><Text font="footnote" foregroundStyle="secondaryLabel">本地 ↔ GitHub</Text>{target ? <Text font="caption" foregroundStyle="secondaryLabel">{target.remote} · {target.branch}</Text> : null}<HStack spacing={6}><Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>本地</Text><Divider /><Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>GitHub</Text></HStack></Section>{noCommonAncestor ? <Section><Text font="footnote" foregroundStyle="orange">本地和 GitHub 历史没有共同版本</Text></Section> : diverged ? <Section><Text font="footnote" foregroundStyle="orange">本地和 GitHub 历史已分叉</Text></Section> : null}{loading ? <Section><ProgressView /></Section> : null}{state === "noRemote" ? <Section><Text font="headline">尚未连接 GitHub</Text></Section> : null}{state === "needsFetch" ? <Section><Button title="获取云端版本" buttonStyle="borderedProminent" disabled={fetching} action={refresh} /></Section> : null}{state === "error" ? <Section><VStack spacing={8} alignment="leading"><Text font="headline" foregroundStyle="red">版本对照读取失败</Text><Text font="footnote" foregroundStyle="red">{errorMessage}</Text><Button title={t("retry")} action={load} /></VStack></Section> : null}{state === "ready" ? <Section>{rows.map((row, index) => <HStack key={`${row.local?.oid || "-"}-${row.remote?.oid || "-"}-${index}`} spacing={6} alignment="top"><CommitCell commit={row.local} status={row.local && row.remote?.oid === row.local.oid ? "shared" : "local"} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} /><Divider /><CommitCell commit={row.remote} status={row.remote && row.local?.oid === row.remote.oid ? "shared" : "remote"} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} /></HStack>)}</Section> : null}</List> }
export default SourceControlHistoryCompareView
