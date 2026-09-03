import {
  Button,
  Divider,
  HStack,
  Image,
  List,
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
import { SourceControlRemoteView } from "./SourceControlRemoteView"
import { SourceControlSettingsView } from "./SourceControlSettingsView"
import { SourceControlHistoryCompareView } from "./SourceControlHistoryCompareView"
import { AppLanguage, formatChangeType } from "./localization"
import { enumerateProjectFiles, ProjectFileEntry } from "./projectFiles"
import { useTranslator } from "./useLocalization"

export interface SourceControlChangesViewProps { gitService?: GitService; projectPath?: string }
type ChangeFilter = "staged" | "unstaged"
interface FolderGroup { path: string; files: GitChange[] }
interface ProjectFileGroup { path: string; files: ProjectFileEntry[] }

function formatFolderPath(path: string, language: AppLanguage): string { return path === "ROOT" && language === "zh-Hans" ? "根目录" : path === "ROOT" ? "Root" : path }
function statusInfo(change: GitChange): { label: string; color: "green" | "red" | "blue" | "orange" } {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: "?", color: "orange" }
  return { label: "M", color: "blue" }
}
function fileParts(filepath: string): { directory: string; filename: string } { const parts = filepath.split("/"); const filename = parts.pop() || filepath; return { filename, directory: parts.join("/") || "ROOT" } }
function projectFileGroups(files: ProjectFileEntry[]): ProjectFileGroup[] {
  const groups = new Map<string, ProjectFileEntry[]>(); groups.set("ROOT", [])
  for (const file of files) {
    if (file.directory !== "ROOT") {
      const segments = file.directory.split("/")
      for (let index = 1; index <= segments.length; index += 1) {
        const directory = segments.slice(0, index).join("/")
        if (!groups.has(directory)) groups.set(directory, [])
      }
    }
    groups.set(file.directory, [...(groups.get(file.directory) || []), file])
  }
  return Array.from(groups.entries()).map(([path, groupFiles]) => ({ path, files: groupFiles.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.path === "ROOT" ? -1 : b.path === "ROOT" ? 1 : a.path.localeCompare(b.path))
}
function FolderRow({ group, selected, language, disabled, onSelect }: { group: FolderGroup; selected: boolean; language: AppLanguage; disabled: boolean; onSelect: () => void }) { return <Button disabled={disabled} buttonStyle={selected ? "bordered" : "plain"} action={onSelect}><HStack spacing={6} alignment="center"><Image systemName="folder" foregroundStyle={selected ? "blue" : "secondaryLabel"} /><Text font="caption" foregroundStyle={selected ? "blue" : "secondaryLabel"} lineLimit={2}>{formatFolderPath(group.path, language)}</Text><Spacer /><Text font="caption" foregroundStyle="secondaryLabel">{group.files.length}</Text>{selected ? <Image systemName="checkmark" foregroundStyle="blue" /> : null}</HStack></Button> }

function HeaderIconButton({ systemImage, onPress }: { systemImage: string; onPress: () => void }) { return <Button action={onPress} buttonStyle="borderless" contentShape={{ kind: "interaction", shape: "rect" }}><HStack frame={{ width: 44, height: 44, alignment: "center" }}><Image systemName={systemImage} /></HStack></Button> }

function ActionRow({ icon, title, value, subtitle, onPress, disabled }: { icon: string; title: string; value?: string; subtitle?: string; onPress: () => void; disabled?: boolean }) { return <Button action={onPress} disabled={disabled} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}><HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 52, alignment: "leading" }} padding={{ horizontal: 14, vertical: 10 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}><Image systemName={icon} foregroundStyle="blue" /><VStack spacing={2} alignment="leading"><Text font="subheadline">{title}</Text>{subtitle ? <Text font="caption" foregroundStyle="secondaryLabel">{subtitle}</Text> : null}</VStack><Spacer />{value ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{value}</Text> : null}<Image systemName="chevron.right" foregroundStyle="secondaryLabel" /></HStack></Button> }

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
function AllFilesFolderRow({ group, selected, language, onSelect }: { group: ProjectFileGroup; selected: boolean; language: AppLanguage; onSelect: () => void }) { return <Button buttonStyle={selected ? "bordered" : "plain"} action={onSelect}><HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName="folder" foregroundStyle={selected ? "blue" : "secondaryLabel"} /><Text font="caption" foregroundStyle={selected ? "blue" : "secondaryLabel"} lineLimit={2}>{formatFolderPath(group.path, language)}</Text><Spacer /><Text font="caption" foregroundStyle="secondaryLabel">{group.files.length}</Text>{selected ? <Image systemName="checkmark" foregroundStyle="blue" /> : null}</HStack></Button> }
function AllFilesBrowser({ groups, selectedFolder, onSelect, language }: { groups: ProjectFileGroup[]; selectedFolder: string; onSelect: (folder: string) => void; language: AppLanguage }) {
  const selected = groups.find((group) => group.path === selectedFolder)
  return <HStack spacing={8} alignment="top"><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "文件夹" : "Folders"}</Text>{groups.map((group) => <AllFilesFolderRow key={group.path} group={group} selected={group.path === selectedFolder} language={language} onSelect={() => onSelect(group.path)} />)}</VStack><Divider /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="caption" foregroundStyle="secondaryLabel">{formatFolderPath(selectedFolder, language)}</Text>{selected?.files.length ? selected.files.map((file) => <HStack key={file.relativePath} spacing={7} alignment="center" frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}><Image systemName="doc" foregroundStyle="secondaryLabel" /><Text font="subheadline" lineLimit={2}>{file.name}</Text></HStack>) : <Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "此文件夹暂无文件。" : "No files in this folder."}</Text>}</VStack></HStack>
}
function EmptyChangesView({ loading, t, language }: { loading: boolean; t: (key: string) => string; language: AppLanguage }) { return <Section><VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 144, alignment: "center" }} padding={{ top: 20, bottom: 20 }}>{loading ? <ProgressView /> : <Image systemName="checkmark.circle" foregroundStyle="green" />}<Text font="headline" frame={{ maxWidth: "infinity", alignment: "center" }}>{loading ? t("fetching") : language === "zh-Hans" ? "工作区干净" : "Working Tree Clean"}</Text><Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>{loading ? t("fetching") : language === "zh-Hans" ? "所有本地改动均已保存。" : "All local changes have been saved."}</Text></VStack></Section> }
function AllFilesSection({ files, showAllFiles, onToggle, selectedFolder, onSelect, language }: { files: ProjectFileEntry[]; showAllFiles: boolean; onToggle: () => void; selectedFolder: string; onSelect: (folder: string) => void; language: AppLanguage }) {
  const groups = projectFileGroups(files)
  return <Section header={<Text>{language === "zh-Hans" ? "全部文件" : "All Files"}</Text>}>
    <Button action={onToggle} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
      <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 58, alignment: "leading" }} padding={{ horizontal: 14, vertical: 10 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}>
        <Image systemName="folder" foregroundStyle="blue" />
        <VStack spacing={2} alignment="leading"><Text font="subheadline">{language === "zh-Hans" ? `全部文件 · ${files.length}` : `All Files · ${files.length}`}</Text><Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "浏览项目中的所有文件" : "Browse all project files"}</Text></VStack>
        <Spacer />
        <Image systemName={showAllFiles ? "chevron.up" : "chevron.right"} foregroundStyle="secondaryLabel" />
      </HStack>
    </Button>
    {showAllFiles ? <AllFilesBrowser groups={groups} selectedFolder={selectedFolder} onSelect={onSelect} language={language} /> : null}
  </Section>
}

export function SourceControlChangesView({ gitService: propGitService, projectPath }: SourceControlChangesViewProps) {
  const { t, language, refreshLanguage } = useTranslator()
  const [service] = useState<GitService>(() => propGitService || new GitService())
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null)
  const [hasCommit, setHasCommit] = useState<boolean | null>(null)
  const [hasRemote, setHasRemote] = useState<boolean | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeOperation, setActiveOperation] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [syncAhead, setSyncAhead] = useState(0)
  const [syncBehind, setSyncBehind] = useState(0)
  const [syncDiverged, setSyncDiverged] = useState(false)
  const [syncStatusChecked, setSyncStatusChecked] = useState(false)
  const [filter, setFilter] = useState<ChangeFilter>("staged")
  const [selectedFolder, setSelectedFolder] = useState("ROOT")
  const [selectedAllFilesFolder, setSelectedAllFilesFolder] = useState("ROOT")
  const [showAllFiles, setShowAllFiles] = useState(false)
  const [allFiles, setAllFiles] = useState<ProjectFileEntry[]>([])
  const dismiss = Navigation.useDismiss()

  const loadStatus = async () => { setLoading(true); setErrorMessage(null); try { if (projectPath) await service.openRepository(projectPath); const next = await service.getStatus(); setStatus(next); setHasCommit((await service.getHistory(1)).length > 0); const remotes = await service.listRemotes(); setHasRemote(remotes.length > 0); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await service.getCurrentBranch(); if (remote && branch && (await service.listRemoteBranches(remote.name)).some((item) => item.name === branch)) { const value = await service.getAheadBehind(remote.name, branch); setSyncAhead(value.ahead); setSyncBehind(value.behind); setSyncDiverged(value.diverged); setSyncStatusChecked(true) } else { setSyncAhead(0); setSyncBehind(0); setSyncDiverged(false); setSyncStatusChecked(false) } } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }; await loadAllFiles() }
  const operateAll = async (operation: "stageAll" | "unstageAll") => { if (activeOperation) return; setActiveOperation(operation); setErrorMessage(null); try { operation === "stageAll" ? await service.stageAll() : await service.unstageAll(); await loadStatus() } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) } }
  const loadAllFiles = async () => { if (!projectPath) { setAllFiles([]); return }; try { setAllFiles(await enumerateProjectFiles(projectPath)) } catch { console.error("[AllFiles] read failed") } }
  const handleCommit = async () => { const message = commitMessage.trim(); if (!message || !staged.length || activeOperation) return; setActiveOperation("commit"); setErrorMessage(null); try { await service.commit(message); setCommitMessage(""); await loadStatus(); await Dialog.alert({ title: t("committed"), message: "" }) } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setActiveOperation(null) } }

  const openSettings = async () => {
    try {
      await Navigation.present(<SourceControlSettingsView gitService={service} onLanguageChanged={refreshLanguage} onRemoteChanged={loadStatus} />)
      await loadStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[Changes] failed to open settings", error)
      setErrorMessage(`${sectionTitle("无法打开设置", "Unable to open Settings")}\n${message}`)
    }
  }

  const openRemoteSync = async () => {
    try {
      if (hasRemote === false) {
        await openSettings()
        return
      }
      await Navigation.present(<SourceControlRemoteView gitService={service} onChanged={loadStatus} onOpenSettings={openSettings} />)
      await loadStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[Changes] failed to open GitHub sync", error)
      setErrorMessage(`${sectionTitle("无法打开 GitHub 同步", "Unable to open GitHub Sync")}\n${message}`)
    }
  }

  useEffect(() => { loadStatus().catch(console.error) }, [projectPath])
  const staged = status?.stagedChanges || []; const unstaged = status?.unstagedChanges || []; const visible = filter === "staged" ? staged : unstaged; const groups = folderGroups(visible); const busy = activeOperation !== null
  useEffect(() => { if (!groups.some((group) => group.path === selectedFolder && group.files.length)) setSelectedFolder(groups.find((group) => group.files.length)?.path || "ROOT") }, [filter, staged.length, unstaged.length, selectedFolder])
  useEffect(() => { const groups = projectFileGroups(allFiles); if (!groups.some((group) => group.path === selectedAllFilesFolder)) setSelectedAllFilesFolder("ROOT") }, [allFiles, selectedAllFilesFolder])
  const sectionTitle = (zh: string, en: string) => language === "zh-Hans" ? zh : en
  const syncSummary = hasRemote === false ? sectionTitle("尚未配置 GitHub", "GitHub is not configured") : hasRemote !== true || !syncStatusChecked ? sectionTitle("尚未检查 GitHub", "GitHub has not been checked") : syncDiverged ? (language === "zh-Hans" ? "本地和 GitHub 都有新的修改" : "Local and GitHub changes have diverged") : syncBehind > 0 ? (language === "zh-Hans" ? `GitHub 有 ${syncBehind} 个新版本` : `GitHub has ${syncBehind} newer commit${syncBehind === 1 ? "" : "s"}`) : syncAhead > 0 ? (language === "zh-Hans" ? `${syncAhead} 个本地版本等待同步` : `${syncAhead} local commit${syncAhead === 1 ? "" : "s"} waiting to sync`) : (language === "zh-Hans" ? "已同步到 GitHub" : "Synced with GitHub")
  const syncButtonTitle = hasRemote === false ? sectionTitle("配置 GitHub", "Configure GitHub") : hasRemote !== true || !syncStatusChecked ? sectionTitle("检查同步", "Check Sync") : syncDiverged ? sectionTitle("查看同步状态", "View Sync Status") : syncBehind > 0 ? sectionTitle("获取 GitHub 版本", "Get GitHub Version") : syncAhead > 0 ? sectionTitle("同步到 GitHub", "Sync to GitHub") : sectionTitle("已同步", "Synced")
  const syncButtonDisabled = busy || (hasRemote === true && syncStatusChecked && !syncDiverged && syncAhead === 0 && syncBehind === 0)

  return <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
    <HStack frame={{ maxWidth: "infinity", minHeight: 52, alignment: "center" }} padding={{ horizontal: 4, vertical: 4 }} background="clear">
      <HeaderIconButton systemImage="xmark" onPress={() => dismiss()} />
      <Spacer />
      <HeaderIconButton systemImage="gearshape" onPress={openSettings} />
    </HStack>
    <List navigationTitle="Changes" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    {errorMessage ? <Section><Text font="footnote" foregroundStyle="red">{errorMessage}</Text></Section> : null}
    <Section header={<Text>{sectionTitle("本次版本", "Current Version")}</Text>}>
      <VStack spacing={8} alignment="leading">
        <Text font="caption" foregroundStyle="secondaryLabel">{staged.length === 0 ? `${sectionTitle("0 个文件已加入", "0 files added")} · ${unstaged.length} ${sectionTitle("个文件未选择", "not selected")}` : unstaged.length === 0 ? `${staged.length} ${sectionTitle("个文件已加入", "files added")}` : `${staged.length} ${sectionTitle("个文件已加入", "files added")} · ${unstaged.length} ${sectionTitle("个文件未选择", "not selected")}`}</Text>
        {unstaged.length ? <ActionRow icon="plus" title={staged.length ? `${sectionTitle("加入剩余", "Add remaining")} ${unstaged.length} ${sectionTitle("个文件", "files")}` : `${sectionTitle("加入全部", "Add all")} ${unstaged.length} ${sectionTitle("个文件", "files")}`} subtitle={staged.length ? `${staged.length} ${sectionTitle("个文件已加入", "files added")}` : `${unstaged.length} ${sectionTitle("个文件尚未加入", "files not added")}`} onPress={() => operateAll("stageAll")} disabled={busy} /> : null}
        <ActionRow icon="note.text" title={sectionTitle("版本说明", "Commit Message")} value={commitMessage.trim() || (hasCommit === false ? sectionTitle("首次版本", "Initial commit") : sectionTitle("尚未填写", "Not Set"))} onPress={async () => { const value = await Dialog.prompt({ title: hasCommit === false ? sectionTitle("首次版本", "Initial Commit") : sectionTitle("版本说明", "Commit Message"), defaultValue: commitMessage, placeholder: sectionTitle("填写版本说明", "Add a commit message"), cancelLabel: t("cancel"), confirmLabel: "Save" }); if (value !== null) setCommitMessage(value) }} disabled={busy} />
        <Text font="caption" foregroundStyle="secondaryLabel">{syncSummary}</Text>
        <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Button action={handleCommit} disabled={!staged.length || !commitMessage.trim() || busy} buttonStyle="borderedProminent" frame={{ maxWidth: "infinity", minHeight: 44 }}>
            <Text font="subheadline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{busy ? "…" : sectionTitle("保存本地版本", "Commit Locally")}</Text>
          </Button>
          <Button action={openRemoteSync} disabled={syncButtonDisabled} buttonStyle="borderedProminent" frame={{ maxWidth: "infinity", minHeight: 44 }}>
            <Text font="subheadline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{syncButtonTitle}</Text>
          </Button>
        </HStack>
      </VStack>
    </Section>
    <Section header={<Text>{sectionTitle("版本", "Versions")}</Text>}>
      <Button action={async () => { try { await Navigation.present(<SourceControlHistoryCompareView gitService={service} language={language} onChanged={loadStatus} />) } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error("[Changes] failed to open version compare", error); setErrorMessage(`${sectionTitle("无法打开版本对照", "Unable to open version compare")}\n${message}`) } }} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
        <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 72, alignment: "leading" }} padding={{ horizontal: 14, vertical: 14 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}>
          <Image systemName="rectangle.split.2x1" foregroundStyle="blue" />
          <VStack spacing={2} alignment="leading">
            <Text font="subheadline">{sectionTitle("版本对照", "Compare Versions")}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{sectionTitle("本地与 GitHub 版本记录", "Local and GitHub version history")}</Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" foregroundStyle="secondaryLabel" />
        </HStack>
      </Button>
    </Section>
    {status?.isClean ? <EmptyChangesView loading={loading} t={(key) => t(key as never)} language={language} /> : null}
    {status && (staged.length || unstaged.length) ? <Section header={<HStack spacing={8}><Text>{t("files")}</Text><Spacer /><Button title={`${sectionTitle("本次版本", "Staged")} ${staged.length}`} buttonStyle="plain" disabled={!staged.length || busy} action={() => setFilter("staged")} /><Button title={`${sectionTitle("未选择", "Changes")} ${unstaged.length}`} buttonStyle="plain" disabled={!unstaged.length || busy} action={() => setFilter("unstaged")} /></HStack>}><FileBrowser groups={groups} selectedFolder={selectedFolder} onSelect={setSelectedFolder} service={service} filter={filter} onChanged={loadStatus} disabled={busy} language={language} /><Button title={filter === "staged" ? sectionTitle("全部移出本次版本", "Unstage All") : sectionTitle("全部加入本次版本", "Stage All")} buttonStyle="borderless" disabled={busy} action={() => operateAll(filter === "staged" ? "unstageAll" : "stageAll")} /></Section> : null}
    <AllFilesSection files={allFiles} showAllFiles={showAllFiles} onToggle={() => setShowAllFiles((value) => !value)} selectedFolder={selectedAllFilesFolder} onSelect={setSelectedAllFilesFolder} language={language} />
  </List>
  </VStack>
}
