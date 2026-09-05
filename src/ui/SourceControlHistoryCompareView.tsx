import { Button, Divider, HStack, List, Navigation, NavigationStack, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitBranchResetResult, GitCommitInfo, GitCommitWorkingTreeRestoreResult, GitSyncRecord } from "../core/types"
import { GitService } from "../core/GitService"
import { formatHistoryTime } from "./formatDate"
import { CloseButton } from "./CloseButton"
import { AppLanguage, createTranslator } from "./localization"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"
import { EmptyStateSection, ErrorSection, LoadingSection, ToolbarIconButton } from "./components"
import type { UITokens } from "./design"
import { useUISettings } from "./useUISettings"

type SyncCompareRow = { local: GitCommitInfo; sync: GitSyncRecord | null }
type Target = { remote: string; branch: string } | null
type HistoryNavigationResult = GitCommitWorkingTreeRestoreResult | GitBranchResetResult

function isHistoryNavigationResult(value: unknown): value is HistoryNavigationResult {
  if (!value || typeof value !== "object") return false
  const result = value as { restored?: unknown; reset?: unknown; oid?: unknown; fromOid?: unknown; toOid?: unknown; shortOid?: unknown; changedFiles?: unknown }
  if (result.restored === true) return typeof result.oid === "string" && typeof result.shortOid === "string" && typeof result.changedFiles === "number"
  return result.reset === true && typeof result.fromOid === "string" && typeof result.toOid === "string" && typeof result.shortOid === "string"
}

export interface SourceControlHistoryCompareViewProps { gitService: GitService; language?: AppLanguage; onChanged?: () => Promise<void>; projectName?: string }

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


function LocalCommitCell({ commit, onSelect, tokens }: { commit: GitCommitInfo; onSelect: (commit: GitCommitInfo) => void; tokens: UITokens }) {
  return <Button action={() => onSelect(commit)} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
    <VStack spacing={tokens.compactSpacing} alignment="leading" frame={{ maxWidth: "infinity", minHeight: tokens.compareRowHeight, alignment: "leading" }} padding={{ horizontal: tokens.compareHorizontalPadding, vertical: tokens.compactPadding }}>
      <Text font="subheadline" lineLimit={2}>{commit.message}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commit.shortOid}</Text>
    </VStack>
  </Button>
}

function SyncNodeCell({ commit, record, onSelect, language, tokens }: { commit: GitCommitInfo; record: GitSyncRecord | null; onSelect: (commit: GitCommitInfo) => void; language: AppLanguage; tokens: UITokens }) {
  if (!record) return <VStack frame={{ maxWidth: "infinity", minHeight: tokens.compareRowHeight, alignment: "center" }}><Text font="title3" foregroundStyle="tertiaryLabel">⋮</Text></VStack>
  const isBaseline = record.kind === "baseline"
  return <Button action={() => onSelect(commit)} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
    <VStack spacing={tokens.compactSpacing} alignment="leading" frame={{ maxWidth: "infinity", minHeight: tokens.compareRowHeight, alignment: "leading" }} padding={{ horizontal: tokens.compareHorizontalPadding, vertical: tokens.compactPadding }}>
      <Text font="subheadline" lineLimit={1}>{commit.message}</Text>
      {!isBaseline ? <Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(record.syncedAt)}</Text> : null}
      <Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commit.shortOid}</Text>
      <Text font="caption2" foregroundStyle="blue">{isBaseline ? (language === "zh-Hans" ? "当前同步基线" : "Current sync baseline") : language === "zh-Hans" ? `同步 ${record.commitsUploaded} 个版本` : `Synced ${record.commitsUploaded} commit${record.commitsUploaded === 1 ? "" : "s"}`}</Text>
    </VStack>
  </Button>
}

export function SourceControlHistoryCompareView({ gitService, language = "en", onChanged, projectName }: SourceControlHistoryCompareViewProps) {
  const dismiss = Navigation.useDismiss()
  const t = createTranslator(language)
  const { tokens } = useUISettings()
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

  const compareTitle = language === "zh-Hans" ? "本地 ↔ GitHub" : "Local ↔ GitHub"
  const localColumnTitle = language === "zh-Hans" ? "本地版本" : "Local Versions"
  const githubColumnTitle = language === "zh-Hans" ? "GitHub 同步" : "GitHub Sync"
  const projectSubtitle = target ? `${projectName || "Source Control"} · ${target.branch}` : projectName || null

  return (
    <NavigationStack>
      <List
      navigationTitle={compareTitle}
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: <ToolbarIconButton systemImage="arrow.clockwise" disabled={loading || fetching || state === "noRemote"} onPress={() => { refresh().catch(console.error) }} />,
      }}
    >
      <Section>
        <VStack spacing={tokens.sectionSpacing} alignment="leading" padding={{ horizontal: tokens.pagePadding }}>
          {projectSubtitle ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{projectSubtitle}</Text> : null}
          <HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.rowHeight, alignment: "leading" }}>
            <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{localColumnTitle}</Text>
            <Divider />
            <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{githubColumnTitle}</Text>
          </HStack>
        </VStack>
      </Section>
      {loading ? <LoadingSection message={language === "zh-Hans" ? "正在读取版本对照…" : "Loading version comparison…"} /> : null}
      {state === "noRemote" ? <EmptyStateSection title={language === "zh-Hans" ? "尚未连接 GitHub" : "Not connected to GitHub"} message={language === "zh-Hans" ? "请先配置 GitHub 远端。" : "Configure a GitHub remote first."} systemImage="externaldrive" /> : null}
      {state === "needsFetch" ? <Section><Button title={language === "zh-Hans" ? "获取云端版本" : "Fetch GitHub Versions"} buttonStyle="borderedProminent" disabled={fetching} action={() => { refresh().catch(console.error) }} frame={{ minHeight: tokens.buttonHeight }} /></Section> : null}
      {state === "error" ? <>
        <ErrorSection message={errorMessage || (language === "zh-Hans" ? "无法读取版本对照。" : "Unable to load version comparison.")} title={language === "zh-Hans" ? "版本对照读取失败" : "Version comparison failed"} />
        <Section><Button title={t("retry")} action={() => { load().catch(console.error) }} frame={{ minHeight: tokens.buttonHeight }} /></Section>
      </> : null}
      {state === "ready" && !loading ? rows.length === 0 ? <EmptyStateSection title={language === "zh-Hans" ? "暂无本地版本" : "No Local Versions"} systemImage="clock" /> : <Section>{rows.map((row) => <HStack key={row.local.oid} spacing={tokens.rowContentSpacing} alignment="top"><LocalCommitCell commit={row.local} tokens={tokens} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} /><Divider /><SyncNodeCell commit={row.local} record={row.sync} tokens={tokens} onSelect={(commit) => { openCommitDetail(commit).catch(console.error) }} language={language} /></HStack>)}</Section> : null}
      {state === "ready" && !loading && target && rows.some((row) => row.sync?.kind === "push") === false && rows.some((row) => row.sync?.kind === "baseline") ? <Section><Text font="footnote" foregroundStyle="secondaryLabel">早期同步记录未保存，从当前 GitHub 状态开始记录。</Text></Section> : null}
      </List>
    </NavigationStack>
  )
}

export default SourceControlHistoryCompareView
