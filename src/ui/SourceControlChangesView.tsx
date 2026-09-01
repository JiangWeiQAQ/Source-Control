import {
  Button,
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
import { GitChange, GitRepositoryStatus } from "../core/types"
import { SourceControlDiffView } from "./SourceControlDiffView"
import { SourceControlHistoryView } from "./SourceControlHistoryView"
import { SourceControlSnapshotsView } from "./SourceControlSnapshotsView"
import { SourceControlRemoteView } from "./SourceControlRemoteView"
import { useTranslator } from "./useLocalization"

export interface SourceControlChangesViewProps { gitService?: GitService; projectPath?: string }
type ChangeFilter = "staged" | "unstaged"
interface FolderGroup { path: string; files: GitChange[] }

function getRepositoryDisplayName(path?: string): string {
  if (!path) return "Source Control Stage Test"
  return path.split("/").filter(Boolean).pop() || "Source Control Stage Test"
}
function statusInfo(change: GitChange): { label: string; color: "green" | "red" | "blue" | "orange" } {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: "?", color: "orange" }
  return { label: "M", color: "blue" }
}
function fileParts(filepath: string): { directory: string; filename: string } {
  const parts = filepath.split("/")
  const filename = parts.pop() || filepath
  return { filename, directory: parts.join("/") || "ROOT" }
}
function folderGroups(changes: GitChange[]): FolderGroup[] {
  const groups = new Map<string, GitChange[]>()
  groups.set("ROOT", [])
  changes.forEach((change) => {
    const directory = fileParts(change.filepath).directory
    groups.set(directory, [...(groups.get(directory) || []), change])
  })
  return Array.from(groups.entries()).map(([path, files]) => ({
    path,
    files: files.sort((a, b) => fileParts(a.filepath).filename.localeCompare(fileParts(b.filepath).filename)),
  })).sort((a, b) => a.path === "ROOT" ? -1 : b.path === "ROOT" ? 1 : a.path.localeCompare(b.path))
}

function FileRow({ gitService, change, comparison, onChanged, disabled }: { gitService: GitService; change: GitChange; comparison: ChangeFilter; onChanged: () => Promise<void>; disabled: boolean }) {
  const info = statusInfo(change)
  const { filename } = fileParts(change.filepath)
  return <NavigationLink disabled={disabled} destination={<SourceControlDiffView gitService={gitService} change={change} comparison={comparison} onChanged={onChanged} />}>
    <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 54, alignment: "leading" }}>
      <Text font="headline" bold foregroundStyle={info.color}>{info.label}</Text>
      <VStack spacing={2} alignment="leading">
        <Text font="subheadline" lineLimit={2}>{filename}</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">{info.label} · {change.status}</Text>
      </VStack>
      <Spacer />
      <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
    </HStack>
  </NavigationLink>
}
function FileBrowser({ groups, selectedFolder, onSelect, service, filter, onChanged, disabled }: { groups: FolderGroup[]; selectedFolder: string; onSelect: (folder: string) => void; service: GitService; filter: ChangeFilter; onChanged: () => Promise<void>; disabled: boolean }) {
  const selected = groups.find((group) => group.path === selectedFolder)
  return <HStack spacing={10} alignment="top">
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">FOLDERS</Text>
      {groups.map((group) => <Button key={group.path} title={`${group.path}  ${group.files.length}`} buttonStyle={group.path === selectedFolder ? "borderedProminent" : "borderless"} action={() => onSelect(group.path)} />)}
    </VStack>
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">{selectedFolder}</Text>
      {(selected?.files || []).map((change) => <FileRow key={change.filepath} gitService={service} change={change} comparison={filter} onChanged={onChanged} disabled={disabled} />)}
    </VStack>
  </HStack>
}
function EmptyChangesView({ loading }: { loading: boolean }) { return <Section><VStack spacing={8} alignment="center">{loading ? <ProgressView /> : <Image systemName="checkmark.circle" foregroundStyle="green" />}<Text font="headline">{loading ? "Refreshing Changes" : "Working Tree Clean"}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{loading ? "Checking the repository status…" : "There are no staged or unstaged changes."}</Text></VStack></Section> }

export function SourceControlChangesView({ gitService: propGitService, projectPath }: SourceControlChangesViewProps) {
  const { t } = useTranslator()
  const [service] = useState<GitService>(() => propGitService || new GitService())
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null)
  const [hasCommit, setHasCommit] = useState<boolean | null>(null)
  const [hasRemote, setHasRemote] = useState<boolean | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeOperation, setActiveOperation] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [localCommitCreated, setLocalCommitCreated] = useState(false)
  const [filter, setFilter] = useState<ChangeFilter>("staged")
  const [selectedFolder, setSelectedFolder] = useState("ROOT")
  const dismiss = Navigation.useDismiss()

  const loadStatus = async () => {
    setLoading(true); setErrorMessage(null)
    try {
      if (projectPath) await service.openRepository(projectPath)
      const nextStatus = await service.getStatus(); setStatus(nextStatus)
      const history = await service.getHistory(1); setHasCommit(history.length > 0)
      setHasRemote((await service.listRemotes()).length > 0)
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }
  const operateAll = async (operation: "stageAll" | "unstageAll") => {
    if (activeOperation) return; setActiveOperation(operation); setErrorMessage(null)
    try { operation === "stageAll" ? await service.stageAll() : await service.unstageAll(); await loadStatus() } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }
  const handleCommit = async () => {
    const message = commitMessage.trim(); if (!message || !status || !status.stagedChanges.length || activeOperation) return
    setActiveOperation("commit"); setErrorMessage(null)
    try { const result = await service.commit(message); setCommitMessage(""); setLocalCommitCreated(true); await loadStatus(); await Dialog.alert({ title: "Committed", message: result.shortOid }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }
  const syncToGitHub = async () => {
    if (activeOperation) return; setActiveOperation("sync"); setErrorMessage(null)
    try {
      const remotes = await service.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]
      if (!remote) { await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />); return }
      await service.fetchRemote(remote.name); const branch = await service.getCurrentBranch(); if (!branch) throw new Error("A local branch is required before syncing.")
      const sync = await service.getAheadBehind(remote.name, branch)
      if (sync.diverged || sync.behind > 0) { setErrorMessage(sync.diverged ? "Local and GitHub changes have diverged." : "GitHub has newer changes. Pull them before syncing."); return }
      if (sync.ahead > 0) await service.pushRemote(remote.name, sync.remoteBranch)
      await loadStatus(); await Dialog.alert({ title: "Synced with GitHub", message: "Your local commit is now on GitHub." })
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) }
  }
  useEffect(() => { loadStatus().catch(console.error) }, [projectPath])

  const staged = status?.stagedChanges || []; const unstaged = status?.unstagedChanges || []
  const visible = filter === "staged" ? staged : unstaged; const groups = folderGroups(visible); const busy = activeOperation !== null
  useEffect(() => { if (!groups.some((group) => group.path === selectedFolder && group.files.length)) setSelectedFolder(groups.find((group) => group.files.length)?.path || "ROOT") }, [filter, staged.length, unstaged.length, selectedFolder])
  useEffect(() => { if (!staged.length && unstaged.length) setFilter("unstaged"); else if (!unstaged.length && staged.length) setFilter("staged") }, [staged.length, unstaged.length])

  return <List navigationTitle="Changes" toolbar={{ topBarLeading: <Button title="Close" systemImage="xmark" buttonStyle="borderless" action={() => dismiss()} />, topBarTrailing: <HStack spacing={10}><Menu title="More" systemImage="ellipsis.circle"><Button title="Remote" action={async () => { await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />); await loadStatus() }} /><Button title="Snapshots" action={async () => { await Navigation.present(<SourceControlSnapshotsView gitService={service} onRestored={loadStatus} />) }} /></Menu><Button title="History" systemImage="clock.arrow.circlepath" action={async () => { await Navigation.present(<SourceControlHistoryView gitService={service} projectPath={projectPath || ""} />) }} /><Button title="Refresh" systemImage="arrow.clockwise" disabled={loading} action={loadStatus} /></HStack> }}>
    <Text font="footnote" foregroundStyle="secondaryLabel">{t("localChanges")} · {staged.length + unstaged.length} {t("files")}</Text>
    {hasCommit === false ? <Section><VStack spacing={5} alignment="leading"><Text font="headline">{t("repositoryInitialized")}</Text><Text font="subheadline">{staged.length ? t("readyForInitialCommit") : t("stageFilesHint")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("stageFilesHint")}</Text>{unstaged.length ? <Button title={busy ? "Staging…" : staged.length ? t("stageRemaining") : t("stageAll")} disabled={busy} action={() => operateAll("stageAll")} /> : null}</VStack></Section> : null}
    {errorMessage ? <Section><Text foregroundStyle="red">{errorMessage}</Text></Section> : null}
    {status?.isClean && !localCommitCreated ? <EmptyChangesView loading={loading} /> : null}
    {status?.isClean && localCommitCreated ? <Section><VStack spacing={6} alignment="leading"><Text font="headline">{t("localCommitCreated")}</Text>{hasRemote ? <><Text font="footnote" foregroundStyle="secondaryLabel">{t("readyToSync")}</Text><Button title={busy ? "Syncing…" : t("syncToGitHub")} disabled={busy} action={syncToGitHub} /></> : <><Text font="footnote" foregroundStyle="secondaryLabel">{t("notConnected")}</Text><Button title={t("setUpRemote")} disabled={busy} action={async () => { await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} />); await loadStatus() }} /></>}</VStack></Section> : null}
    {staged.length ? <Section><VStack spacing={8} alignment="leading"><Text font="footnote" foregroundStyle="secondaryLabel">{t("localCommit")}</Text><Text font="caption" foregroundStyle="secondaryLabel">{t("localCommitHint")}</Text><Button title={commitMessage.trim() || (hasCommit === false ? t("initialCommit") : "Not Set")} systemImage="chevron.right" disabled={busy} action={async () => { const message = await Dialog.prompt({ title: hasCommit === false ? t("initialCommit") : t("commitMessage"), defaultValue: commitMessage, placeholder: hasCommit === false ? t("initialCommit") : t("commitMessage"), cancelLabel: t("cancel"), confirmLabel: "Save" }); if (message !== null) setCommitMessage(message) }} /><Button title={busy ? "Committing…" : t("commitLocally")} disabled={!staged.length || !commitMessage.trim() || busy} action={handleCommit} /></VStack></Section> : null}
    {status && (staged.length || unstaged.length) ? <Section header={<HStack spacing={8}><Text>{t("files")}</Text><Spacer /><Button title={`${t("staged")} ${staged.length}`} buttonStyle={filter === "staged" ? "borderedProminent" : "borderless"} disabled={!staged.length || busy} action={() => setFilter("staged")} /><Button title={`${t("changes")} ${unstaged.length}`} buttonStyle={filter === "unstaged" ? "borderedProminent" : "borderless"} disabled={!unstaged.length || busy} action={() => setFilter("unstaged")} /></HStack>}><FileBrowser groups={groups} selectedFolder={selectedFolder} onSelect={setSelectedFolder} service={service} filter={filter} onChanged={loadStatus} disabled={busy} /><HStack spacing={10}>{filter === "staged" ? <Button title={t("unstageAll")} disabled={busy || !staged.length} action={() => operateAll("unstageAll")} /> : <Button title={t("stageAll")} disabled={busy || !unstaged.length} action={() => operateAll("stageAll")} />}</HStack></Section> : null}
  </List>
}
export default SourceControlChangesView
