import { Button, Divider, HStack, Image, List, Navigation, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { GitBranchResetResult, GitCommitInfo, GitCommitWorkingTreeRestoreResult, GitSyncRecord } from "../core/types"
import { GitService } from "../core/GitService"
import { formatHistoryTime } from "./formatDate"
import { CloseButton } from "./CloseButton"
import { AppLanguage, createTranslator } from "./localization"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"

type SyncCompareRow = { local: GitCommitInfo; sync: GitSyncRecord | null }
type Target = { remote: string; branch: string } | null
type HistoryNavigationResult = GitCommitWorkingTreeRestoreResult | GitBranchResetResult

function isHistoryNavigationResult(value: unknown): value is HistoryNavigationResult {
  if (!value || typeof value !== "object") return false
  const result = value as { restored?: unknown; reset?: unknown; oid?: unknown; fromOid?: unknown; toOid?: unknown; shortOid?: unknown; changedFiles?: unknown }
  if (result.restored === true) return typeof result.oid === "string" && typeof result.shortOid === "string" && typeof result.changedFiles === "number"
  return result.reset === true && typeof result.fromOid === "string" && typeof result.toOid === "string" && typeof result.shortOid === "string"
}

export interface SourceControlHistoryCompareViewProps { gitService: GitService; language?: AppLanguage; onChanged?: () => Promise<void> }

function HeaderIconButton({ systemImage, onPress }: { systemImage: string; onPress: () => void }) { return <Button action={onPress} buttonStyle="borderless" contentShape={{ kind: "interaction", shape: "rect" }}><HStack frame={{ width: 44, height: 44, alignment: "center" }}><Image systemName={systemImage} /></HStack></Button> }

export function alignHistory(local: GitCommitInfo[], remote: GitCommitInfo[]): Array<{ local: GitCommitInfo | null; remote: GitCommitInfo | null }> {
  const remoteOids = new Set(remote.map((item) => item.oid))
  const rows: Array<{ local: GitCommitInfo | null; remote: GitCommitInfo | null }> = []
  const localCommonIndex = local.findIndex((item) => remoteOids.has(item.oid))
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
  let localIndex = localCommonIndex
  let remoteIndex = remoteCommonIndex
  while (localIndex < local.length || remoteIndex < remote.length) {
    const left = local[localIndex] || null
    const right = remote[remoteIndex] || null
    if (!left) { rows.push({ local: null, remote: right }); remoteIndex += 1; continue }
    if (!right) { rows.push({ local: left, remote: null }); localIndex += 1; continue }
    if (left.oid === right.oid) { rows.push({ local: left, remote: right }); localIndex += 1; remoteIndex += 1; continue }
    const remoteMatch = remote.slice(remoteIndex).findIndex((item) => item.oid === left.oid)
    const localMatch = local.slice(localIndex).findIndex((item) => item.oid === right.oid)
    if (remoteMatch < 0 || (localMatch >= 0 && remoteMatch > localMatch)) { rows.push({ local: null, remote: right }); remoteIndex += 1 }
    else { rows.push({ local: left, remote: null }); localIndex += 1 }
  }
  return rows
}

export function alignSyncRecords(local: GitCommitInfo[], records: GitSyncRecord[]): SyncCompareRow[] {
  const byOid = new Map(records.map((record) => [record.targetOid, record]))
  return local.map((commit) => ({ local: commit, sync: byOid.get(commit.oid) || null }))
}


function LocalCommitCell({ commit, onSelect }: { commit: GitCommitInfo; onSelect: (commit: GitCommitInfo) => void }) {
  return <Button action={() => onSelect(commit)} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", minHeight: 84, alignment: "leading" }} padding={{ top: 8, bottom: 8 }}>
      <Text font="subheadline" lineLimit={2}>{commit.message}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commit.shortOid}</Text>
    </VStack>
  </Button>
}

function SyncNodeCell({ commit, record, onSelect, language }: { commit: GitCommitInfo; record: GitSyncRecord | null; onSelect: (commit: GitCommitInfo) => void; language: AppLanguage }) {
  if (!record) return <VStack frame={{ maxWidth: "infinity", minHeight: 84, alignment: "center" }}><Text font="title3" foregroundStyle="tertiaryLabel">⋮</Text></VStack>
  const isBaseline = record.kind === "baseline"
  return <Button action={() => onSelect(commit)} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", minHeight: 84, alignment: "leading" }} padding={{ top: 8, bottom: 8 }}>
      <Text font="subheadline" lineLimit={1}>{commit.message}</Text>
      {!isBaseline ? <Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(record.syncedAt)}</Text> : null}
      <Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commit.shortOid}</Text>
      <Text font="caption2" foregroundStyle="blue">{isBaseline ? (language === "zh-Hans" ? "当前同步基线" : "Current sync baseline") : language === "zh-Hans" ? `同步 ${record.commitsUploaded} 个版本` : `Synced ${record.commitsUploaded} commit${record.commitsUploaded === 1 ? "" : "s"}`}</Text>
    </VStack>
  </Button>
}

export function SourceControlHistoryCompareView({ gitService, language = "en", onChanged }: SourceControlHistoryCompareViewProps) {
  const dismiss = Navigation.useDismiss()
  const t = createTranslator(language)
  const [target, setTarget] = useState<Target>(null)
  const [rows, setRows] = useState<SyncCompareRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [state, setState] = useState<"ready" | "noRemote" | "needsFetch" | "error">("ready")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const resolveTarget = async (): Promise<Target> => {
    const remotes = await gitService.listRemotes()
    const remote = remotes.find((item) => item.name === "origin") || remotes[0]
    const branch = await gitService.getCurrentBranch()
    return remote && branch ? { remote: remote.name, branch } : null
  }

  const load = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const next = await resolveTarget()
      setTarget(next)
      if (!next) { setState("noRemote"); setRows([]); return }
      const remoteBranches = await gitService.listRemoteBranches(next.remote)
      if (!remoteBranches.some((item) => item.name === next.branch)) { setState("needsFetch"); setRows([]); return }
      await gitService.getRemoteHistory(next.remote, next.branch, 50)
      const records = await gitService.listSyncRecords(next.remote, next.branch)
      if (records.length === 0) await gitService.ensureSyncHistoryBaseline(next.remote, next.branch)
      const [local, currentRecords] = await Promise.all([gitService.getHistory(50), gitService.listSyncRecords(next.remote, next.branch)])
      setRows(alignSyncRecords(local, currentRecords))
      setState("ready")
    } catch (error) {
      setState("error")
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally { setLoading(false) }
  }

  const refresh = async () => {
    const next = target || await resolveTarget()
    if (!next || fetching) return
    setFetching(true)
    try { await gitService.fetchRemote(next.remote); await load() } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setFetching(false) }
  }

  const openCommitDetail = async (commit: GitCommitInfo) => {
    try {
      const result = await Navigation.present<HistoryNavigationResult | null>(<SourceControlCommitDetailView gitService={gitService} oid={commit.oid} shortOid={commit.shortOid} />)
      if (isHistoryNavigationResult(result)) {
        try { await onChanged?.() } catch (callbackError) { console.error("[HistoryCompare] restore callback failed", callbackError) }
        dismiss(result)
      }
    } catch (error) { setState("error"); setErrorMessage(error instanceof Error ? error.message : String(error)) }
  }

  useEffect(() => { load().catch(console.error) }, [])

  return <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
    <HStack spacing={4} frame={{ maxWidth: "infinity", minHeight: 52, alignment: "center" }} padding={{ horizontal: 4, vertical: 4 }} background="clear">
      <CloseButton />
      <Spacer />
    </HStack>
    <List navigationTitle="版本对照" toolbar={{ topBarTrailing: <Button title={fetching ? t("fetching") : t("refresh")} systemImage="arrow.clockwise" disabled={loading || fetching || state === "noRemote"} action={refresh} /> }}>
    <Section>
      <Text font="footnote" foregroundStyle="secondaryLabel">本地 ↔ GitHub</Text>
      {target ? <Text font="caption" foregroundStyle="secondaryLabel">{target.remote} · {target.branch}</Text> : null}
      <HStack spacing={6}><Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>本地版本</Text><Divider /><Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>GitHub 同步</Text></HStack>
    </Section>
    {loading ? <Section><ProgressView /></Section> : null}
    {state === "noRemote" ? <Section><Text font="headline">尚未连接 GitHub</Text></Section> : null}
    {state === "needsFetch" ? <Section><Button title="获取云端版本" buttonStyle="borderedProminent" disabled={fetching} action={refresh} /></Section> : null}
    {state === "error" ? <Section><VStack spacing={8} alignment="leading"><Text font="headline" foregroundStyle="red">版本对照读取失败</Text><Text font="footnote" foregroundStyle="red">{errorMessage}</Text><Button title={t("retry")} action={load} /></VStack></Section> : null}
    {state === "ready" && !loading ? <Section>{rows.length === 0 ? <Text font="footnote" foregroundStyle="secondaryLabel">暂无本地版本</Text> : rows.map((row) => <HStack key={row.local.oid} spacing={6} alignment="top"><LocalCommitCell commit={row.local} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} /><Divider /><SyncNodeCell commit={row.local} record={row.sync} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} language={language} /></HStack>)}</Section> : null}
    {state === "ready" && !loading && target && rows.some((row) => row.sync?.kind === "push") === false && rows.some((row) => row.sync?.kind === "baseline") ? <Section><Text font="footnote" foregroundStyle="secondaryLabel">早期同步记录未保存，从当前 GitHub 状态开始记录。</Text></Section> : null}
  </List>
  </VStack>
}

export default SourceControlHistoryCompareView
