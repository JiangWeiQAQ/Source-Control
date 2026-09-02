import {
  Button,
  Divider,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationLink,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { GitService } from "../core/GitService"
import { GitChange, GitCommitInfo, GitRepositoryStatus } from "../core/types"
import { SourceControlDiffView } from "./SourceControlDiffView"
import { SourceControlHistoryView } from "./SourceControlHistoryView"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"
import { SourceControlSnapshotsView } from "./SourceControlSnapshotsView"
import { SourceControlRemoteView } from "./SourceControlRemoteView"
import { SourceControlRemoteHistoryView } from "./SourceControlRemoteHistoryView"
import { SourceControlHistoryCompareView } from "./SourceControlHistoryCompareView"
import { formatHistoryTime } from "./formatDate"
import { AppLanguage, createTranslator, formatChangeType, formatFileCount } from "./localization"
import { useTranslator } from "./useLocalization"

export interface SourceControlChangesViewProps { gitService?: GitService; projectPath?: string }
type ChangeFilter = "staged" | "unstaged"
interface FolderGroup { path: string; files: GitChange[] }

function repositoryName(path?: string): string { return path?.split("/").filter(Boolean).pop() || "Source Control Stage Test" }
function statusInfo(change: GitChange): { label: string; color: "green" | "red" | "blue" | "orange" } {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: "?", color: "orange" }
  return { label: "M", color: "blue" }
}
function fileParts(filepath: string): { directory: string; filename: string } { const parts = filepath.split("/"); const filename = parts.pop() || filepath; return { filename, directory: parts.join("/") || "ROOT" } }
function formatFolderPath(path: string, language: AppLanguage): string { return path === "ROOT" && language === "zh-Hans" ? "根目录" : path === "ROOT" ? "Root" : path }
function FolderRow({ group, selected, language, disabled, onSelect }: { group: FolderGroup; selected: boolean; language: AppLanguage; disabled: boolean; onSelect: () => void }) { return <Button disabled={disabled} buttonStyle={selected ? "bordered" : "plain"} action={onSelect}><HStack spacing={6} alignment="center"><Image systemName="folder" foregroundStyle={selected ? "blue" : "secondaryLabel"} /><Text font="caption" foregroundStyle={selected ? "blue" : "secondaryLabel"} lineLimit={2}>{formatFolderPath(group.path, language)}</Text><Spacer /><Text font="caption" foregroundStyle="secondaryLabel">{group.files.length}</Text>{selected ? <Image systemName="checkmark" foregroundStyle="blue" /> : null}</HStack></Button> }

function folderGroups(changes: GitChange[]): FolderGroup[] {
  const groups = new Map<string, GitChange[]>(); groups.set("ROOT", [])
  for (const change of changes) { const directory = fileParts(change.filepath).directory; groups.set(directory, [...(groups.get(directory) || []), change]) }
  return Array.from(groups.entries()).map(([path, files]) => ({ path, files: files.sort((a, b) => fileParts(a.filepath).filename.localeCompare(fileParts(b.filepath).filename)) })).sort((a, b) => a.path === "ROOT" ? -1 : b.path === "ROOT" ? 1 : a.path.localeCompare(b.path))
}
function FileRow({ gitService, change, comparison, onChanged, disabled, language }: { gitService: GitService; change: GitChange; comparison: ChangeFilter; onChanged: () => Promise<void>; disabled: boolean; language: AppLanguage }) {
  const info = statusInfo(change); const { filename } = fileParts(change.filepath)
  return <NavigationLink disabled={disabled} destination={<SourceControlDiffView gitService={gitService} change={change} comparison={comparison} onChanged={onChanged} />}><HStack spacing={7} alignment="center" frame={{ maxWidth: "infinity", minHeight: 54, alignment: "leading" }}><Text font="caption" bold foregroundStyle={info.color}>{info.label}</Text><VStack spacing={2} alignment="leading"><Text font="subheadline" lineLimit={2}>{filename}</Text><Text font="caption2" foregroundStyle="secondaryLabel">{info.label} · {formatChangeType(change.status, language)}</Text></VStack><Spacer /></HStack></NavigationLink>
}
function FileBrowser({ groups, selectedFolder, onSelect, service, filter, onChanged, disabled, language }: { groups: FolderGroup[]; selectedFolder: string; onSelect: (folder: string) => void; service: GitService; filter: ChangeFilter; onChanged: () => Promise<void>; disabled: boolean; language: AppLanguage }) {
  const selected = groups.find((group) => group.path === selectedFolder)
  return <HStack spacing={8} alignment="top"><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "文件夹" : "Folders"}</Text>{groups.map((group) => <FolderRow key={group.path} group={group} selected={group.path === selectedFolder} language={language} disabled={disabled} onSelect={() => onSelect(group.path)} />)}</VStack><Divider /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="caption" foregroundStyle="secondaryLabel">{formatFolderPath(selectedFolder, language)}</Text>{(selected?.files || []).map((change) => <FileRow key={change.filepath} gitService={service} change={change} comparison={filter} onChanged={onChanged} disabled={disabled} language={language} />)}</VStack></HStack>
}
function EmptyChangesView({ loading, t }: { loading: boolean; t: (key: string) => string }) { return <Section><VStack spacing={7} alignment="center">{loading ? <ProgressView /> : <Image systemName="checkmark.circle" foregroundStyle="green" />}<Text font="headline">{loading ? t("fetching") : t("workingTreeClean")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{loading ? t("fetching") : t("noChanges")}</Text></VStack></Section> }
function HistoryPreview({ commit, syncState, onSelect }: { commit: GitCommitInfo; syncState: "synced" | "local" | "unknown"; onSelect: () => void }) { return <VStack spacing={1} alignment="leading" onTapGesture={onSelect} frame={{ maxWidth: "infinity", minHeight: 62, alignment: "leading" }}><Text font="subheadline" lineLimit={2}>{commit.message}</Text><Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)} · {commit.shortOid} · {syncState === "synced" ? "✓ 已同步" : syncState === "local" ? "仅本地" : "同步状态未知"}</Text></VStack> }

export function SourceControlChangesView({ gitService: propGitService, projectPath }: SourceControlChangesViewProps) {
  const { t, language } = useTranslator(); const [service] = useState<GitService>(() => propGitService || new GitService()); const [loading, setLoading] = useState(true); const [status, setStatus] = useState<GitRepositoryStatus | null>(null); const [hasCommit, setHasCommit] = useState<boolean | null>(null); const [hasRemote, setHasRemote] = useState<boolean | null>(null); const [recentHistory, setRecentHistory] = useState<GitCommitInfo[]>([]); const [remoteHistoryOids, setRemoteHistoryOids] = useState<string[]>([]); const [remoteHistoryKnown, setRemoteHistoryKnown] = useState(false); const [historyLoading, setHistoryLoading] = useState(true); const [historyError, setHistoryError] = useState<string | null>(null); const [errorMessage, setErrorMessage] = useState<string | null>(null); const [activeOperation, setActiveOperation] = useState<string | null>(null); const [commitMessage, setCommitMessage] = useState(""); const [localCommitCreated, setLocalCommitCreated] = useState(false); const [syncAhead, setSyncAhead] = useState(0); const [syncBehind, setSyncBehind] = useState(0); const [syncDiverged, setSyncDiverged] = useState(false); const [filter, setFilter] = useState<ChangeFilter>("staged"); const [selectedFolder, setSelectedFolder] = useState("ROOT"); const dismiss = Navigation.useDismiss()

  const loadHistory = async () => { setHistoryLoading(true); setHistoryError(null); setRemoteHistoryKnown(false); try { const localHistory = await service.getHistory(3); setRecentHistory(localHistory); try { const remotes = await service.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await service.getCurrentBranch(); if (remote && branch && (await service.listRemoteBranches(remote.name)).some((item) => item.name === branch)) { const remoteHistory = await service.getRemoteHistory(remote.name, branch, 50); setRemoteHistoryOids(remoteHistory.map((item) => item.oid)); setRemoteHistoryKnown(true) } else setRemoteHistoryOids([]) } catch { setRemoteHistoryOids([]) } } catch (error) { setHistoryError(error instanceof Error ? error.message : String(error)) } finally { setHistoryLoading(false) } }
  const loadStatus = async () => { setLoading(true); setErrorMessage(null); try { if (projectPath) await service.openRepository(projectPath); const next = await service.getStatus(); setStatus(next); setHasCommit((await service.getHistory(1)).length > 0); const remotes = await service.listRemotes(); setHasRemote(remotes.length > 0); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await service.getCurrentBranch(); if (remote && branch && (await service.listRemoteBranches(remote.name)).some((item) => item.name === branch)) { const value = await service.getAheadBehind(remote.name, branch); setSyncAhead(value.ahead); setSyncBehind(value.behind); setSyncDiverged(value.diverged) } else { setSyncAhead(0); setSyncBehind(0); setSyncDiverged(false) } } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }; await loadHistory() }
  const operateAll = async (operation: "stageAll" | "unstageAll") => { if (activeOperation) return; setActiveOperation(operation); setErrorMessage(null); try { operation === "stageAll" ? await service.stageAll() : await service.unstageAll(); await loadStatus() } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) } }
  const handleCommit = async () => { const message = commitMessage.trim(); if (!message || !staged.length || activeOperation) return; setActiveOperation("commit"); setErrorMessage(null); try { await service.commit(message); setCommitMessage(""); setLocalCommitCreated(true); await loadStatus(); await Dialog.alert({ title: t("committed"), message: "" }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) } }
  const syncToGitHub = async () => { if (activeOperation) return; setActiveOperation("sync"); setErrorMessage(null); try { const remotes = await service.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; if (!remote) { await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />); return } await service.fetchRemote(remote.name); const branch = await service.getCurrentBranch(); if (!branch) throw new Error("A local branch is required before syncing."); const value = await service.getAheadBehind(remote.name, branch); if (value.diverged || value.behind > 0) { setErrorMessage(value.diverged ? "Local and GitHub changes have diverged." : "GitHub has newer changes. Pull them before syncing."); return } if (value.ahead > 0) await service.pushRemote(remote.name, value.remoteBranch); await loadStatus(); await Dialog.alert({ title: "Synced with GitHub", message: "" }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) } }
  useEffect(() => { loadStatus().catch(console.error) }, [projectPath])
  const staged = status?.stagedChanges || []; const unstaged = status?.unstagedChanges || []; const visible = filter === "staged" ? staged : unstaged; const groups = folderGroups(visible); const busy = activeOperation !== null
  useEffect(() => { if (!groups.some((group) => group.path === selectedFolder && group.files.length)) setSelectedFolder(groups.find((group) => group.files.length)?.path || "ROOT") }, [filter, staged.length, unstaged.length, selectedFolder])
  useEffect(() => { if (!staged.length && unstaged.length) setFilter("unstaged"); else if (!unstaged.length && staged.length) setFilter("staged") }, [staged.length, unstaged.length])
  const syncText = syncDiverged ? (language === "zh-Hans" ? "本地和 GitHub 都有新的修改" : "Local and GitHub changes have diverged") : syncBehind > 0 ? (language === "zh-Hans" ? `GitHub 上有 ${syncBehind} 个较新的版本` : `GitHub has ${syncBehind} newer commit${syncBehind === 1 ? "" : "s"}`) : syncAhead > 0 ? (language === "zh-Hans" ? `${syncAhead} 个本地版本等待同步到 GitHub` : `${syncAhead} local commit${syncAhead === 1 ? "" : "s"} waiting to sync`) : (language === "zh-Hans" ? "已同步到 GitHub" : "Synced with GitHub")
  const sectionTitle = (zh: string, en: string) => language === "zh-Hans" ? zh : en
  const fileCountLabel = language === "zh-Hans" ? "个文件" : `file${staged.length === 1 ? "" : "s"}`

  return <List navigationTitle="Changes" toolbar={{ topBarLeading: <Button title={t("close")} systemImage="xmark" buttonStyle="borderless" action={() => dismiss()} />, topBarTrailing: <HStack spacing={8}><Menu title="More" systemImage="ellipsis.circle"><Button title={t("remote")} action={async () => { await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />); await loadStatus() }} /><Button title={t("snapshots")} action={async () => { await Navigation.present(<SourceControlSnapshotsView gitService={service} onRestored={loadStatus} />) }} /></Menu><Button title={t("refresh")} systemImage="arrow.clockwise" buttonStyle="borderless" disabled={loading} action={loadStatus} /></HStack> }}>
    <Section><VStack spacing={3} alignment="leading"><Text font="title3">{repositoryName(projectPath)}</Text><Text font="subheadline">{formatFileCount(staged.length + unstaged.length, language)} {language === "zh-Hans" ? "有改动" : "with local changes"}</Text><Text font="caption" foregroundStyle="secondaryLabel">{sectionTitle("选择 → 说明 → 保存 → 同步", "Select → Explain → Save → Sync")}</Text></VStack></Section>
    {errorMessage ? <Section><Text font="footnote" foregroundStyle="red">{errorMessage}</Text></Section> : null}
    <Section header={<Text>{sectionTitle("本次版本", "Current Version")}</Text>}><VStack spacing={8} alignment="leading"><Text font="subheadline">{staged.length ? `${sectionTitle("已选择", "Selected")} ${staged.length} ${fileCountLabel} · ${unstaged.length} ${sectionTitle("个未选择", "not selected")}` : sectionTitle("尚未选择文件", "No files selected")}</Text>{staged.length ? <Button title={`${sectionTitle("版本说明", "Commit Message")} · ${commitMessage.trim() || (hasCommit === false ? sectionTitle("首次版本", "Initial commit") : sectionTitle("尚未填写", "Not Set"))}`} systemImage="chevron.right" disabled={busy} action={async () => { const value = await Dialog.prompt({ title: hasCommit === false ? sectionTitle("首次版本", "Initial Commit") : sectionTitle("版本说明", "Commit Message"), defaultValue: commitMessage, placeholder: hasCommit === false ? sectionTitle("首次版本", "Initial commit") : sectionTitle("版本说明", "Commit message"), cancelLabel: t("cancel"), confirmLabel: "Save" }); if (value !== null) setCommitMessage(value) }} /> : null}{unstaged.length ? <Button title={`${sectionTitle("加入剩余", "Add remaining")} ${unstaged.length} ${sectionTitle("个文件", "files")}`} buttonStyle="borderless" disabled={busy} action={() => operateAll("stageAll")} /> : null}<Button title={busy ? "…" : sectionTitle("保存本地版本", "Commit Locally")} buttonStyle="borderedProminent" disabled={!staged.length || !commitMessage.trim() || busy} action={handleCommit} /></VStack></Section>
    <Section header={<HStack spacing={8}><Text>{sectionTitle("本地版本历史", "Local Version History")}</Text><Spacer /><Button title={sectionTitle("查看全部", "View All")} buttonStyle="borderless" action={async () => { await Navigation.present(<SourceControlHistoryView gitService={service} projectPath={projectPath || ""} language={language} />) }} /></HStack>}><VStack spacing={2}>{historyLoading ? <ProgressView /> : historyError ? <HStack><Text font="caption" foregroundStyle="secondaryLabel">{sectionTitle("本地版本历史暂时无法读取", "Local version history unavailable")}</Text><Spacer /><Button title={t("retry")} action={loadHistory} /></HStack> : recentHistory.length ? recentHistory.map((commit) => <HistoryPreview key={commit.oid} commit={commit} syncState={remoteHistoryKnown ? remoteHistoryOids.includes(commit.oid) ? "synced" : "local" : "unknown"} onSelect={() => { Navigation.present(<SourceControlCommitDetailView gitService={service} oid={commit.oid} shortOid={commit.shortOid} />).catch(console.error) }} />) : <Text font="caption" foregroundStyle="secondaryLabel">{sectionTitle("暂无本地版本", "No Local Versions")}</Text>}<Button title={t("historyCompare")} systemImage="rectangle.split.2x1" buttonStyle="borderless" action={async () => { await Navigation.present(<SourceControlHistoryCompareView gitService={service} language={language} />) }} /></VStack></Section>
    <Section header={<Text>{sectionTitle("GitHub 同步", "GitHub Sync")}</Text>}>
      <VStack spacing={5} alignment="leading">
        <HStack spacing={8} alignment="center">
          <Image systemName="arrow.triangle.2.circlepath" foregroundStyle={syncDiverged || syncBehind > 0 ? "orange" : syncAhead > 0 ? "blue" : "green"} />
          <VStack spacing={2} alignment="leading">
            <Text font="subheadline">{hasRemote ? syncText : sectionTitle("尚未连接 GitHub", "Not connected to GitHub")}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{hasRemote ? sectionTitle("同步状态", "Sync status") : sectionTitle("设置 GitHub 同步以上传本地版本", "Set up GitHub sync to upload local versions")}</Text>
          </VStack>
          <Spacer />
          {hasRemote && !syncDiverged && syncBehind === 0 && syncAhead > 0 ? <Button title={busy ? "…" : t("syncToGitHub")} buttonStyle="borderedProminent" disabled={busy} action={syncToGitHub} /> : null}
        </HStack>
        <Button
          title={sectionTitle("管理 GitHub 同步", "Manage GitHub Sync")}
          systemImage="chevron.right"
          buttonStyle="borderless"
          disabled={false}
          action={async () => {
            await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />)
            await loadStatus()
          }}
        />
      </VStack>
    </Section>
    {status?.isClean && !localCommitCreated ? <EmptyChangesView loading={loading} t={(key) => t(key as never)} /> : null}
    {status && (staged.length || unstaged.length) ? <Section header={<HStack spacing={8}><Text>{t("files")}</Text><Spacer /><Button title={`${sectionTitle("本次版本", "Staged")} ${staged.length}`} buttonStyle="plain" disabled={!staged.length || busy} action={() => setFilter("staged")} /><Button title={`${sectionTitle("未选择", "Changes")} ${unstaged.length}`} buttonStyle="plain" disabled={!unstaged.length || busy} action={() => setFilter("unstaged")} /></HStack>}><FileBrowser groups={groups} selectedFolder={selectedFolder} onSelect={setSelectedFolder} service={service} filter={filter} onChanged={loadStatus} disabled={busy} language={language} /><Button title={filter === "staged" ? sectionTitle("全部移出本次版本", "Unstage All") : sectionTitle("全部加入本次版本", "Stage All")} buttonStyle="borderless" disabled={busy} action={() => operateAll(filter === "staged" ? "unstageAll" : "stageAll")} /></Section> : null}
  </List>
}
