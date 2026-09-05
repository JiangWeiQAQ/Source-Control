import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { GitService } from "../../core/GitService"
import { GitRepositoryStatus } from "../../core/types"
import { SourceControlDiffView } from "../SourceControlDiffView"
import { SourceControlRemoteView } from "../SourceControlRemoteView"
import { SourceControlSettingsView } from "../SourceControlSettingsView"
import { SourceControlHistoryCompareView } from "../SourceControlHistoryCompareView"
import { AppLanguage } from "../localization"
import { enumerateProjectFiles, ProjectFileEntry } from "../projectFiles"
import { useTranslator } from "../useLocalization"
import { useUISettings } from "../useUISettings"
import { AllFilesSection, ChangesFileBrowser, ChangesSummaryCard, ErrorSection, folderGroups, projectFileGroups, CloseButton, ToolbarIconButton } from "../components"

export interface SourceControlChangesViewProps { gitService?: GitService; projectPath?: string }
type ChangeFilter = "staged" | "unstaged"

function EmptyChangesView({ loading, t, language }: { loading: boolean; t: (key: "fetching") => string; language: AppLanguage }) {
  return <Section>
    <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 144, alignment: "center" }} padding={{ top: 20, bottom: 20 }}>
      {loading ? <ProgressView /> : <Image systemName="checkmark.circle" foregroundStyle="green" />}
      <Text font="headline" frame={{ maxWidth: "infinity", alignment: "center" }}>{loading ? t("fetching") : language === "zh-Hans" ? "工作区干净" : "Working Tree Clean"}</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>{loading ? t("fetching") : language === "zh-Hans" ? "所有本地改动均已保存。" : "All local changes have been saved."}</Text>
    </VStack>
  </Section>
}

export function SourceControlChangesPage({ gitService: propGitService, projectPath }: SourceControlChangesViewProps) {
  const { t, language, refreshLanguage } = useTranslator()
  const { tokens } = useUISettings()
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
  const sectionTitle = (zh: string, en: string) => language === "zh-Hans" ? zh : en

  const loadAllFiles = async () => {
    if (!projectPath) {
      setAllFiles([])
      return
    }
    try {
      setAllFiles(await enumerateProjectFiles(projectPath))
    } catch {
      console.error("[AllFiles] read failed")
    }
  }

  const loadStatus = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      if (projectPath) await service.openRepository(projectPath)
      const next = await service.getStatus()
      setStatus(next)
      setHasCommit((await service.getHistory(1)).length > 0)
      const remotes = await service.listRemotes()
      setHasRemote(remotes.length > 0)
      const remote = remotes.find((item) => item.name === "origin") || remotes[0]
      const branch = await service.getCurrentBranch()
      if (remote && branch && (await service.listRemoteBranches(remote.name)).some((item) => item.name === branch)) {
        const value = await service.getAheadBehind(remote.name, branch)
        setSyncAhead(value.ahead)
        setSyncBehind(value.behind)
        setSyncDiverged(value.diverged)
        setSyncStatusChecked(true)
      } else {
        setSyncAhead(0)
        setSyncBehind(0)
        setSyncDiverged(false)
        setSyncStatusChecked(false)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
    await loadAllFiles()
  }

  const operateAll = async (operation: "stageAll" | "unstageAll") => {
    if (activeOperation) return
    setActiveOperation(operation)
    setErrorMessage(null)
    try {
      operation === "stageAll" ? await service.stageAll() : await service.unstageAll()
      await loadStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const handleCommit = async () => {
    const message = commitMessage.trim()
    const staged = status?.stagedChanges || []
    if (!message || !staged.length || activeOperation) return
    setActiveOperation("commit")
    setErrorMessage(null)
    try {
      await service.commit(message)
      setCommitMessage("")
      await loadStatus()
      await Dialog.alert({ title: t("committed"), message: "" })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const openSettings = async () => {
    try {
      await Navigation.present(<SourceControlSettingsView gitService={service} projectPath={projectPath} onLanguageChanged={refreshLanguage} onRemoteChanged={loadStatus} />)
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

  useEffect(() => {
    loadStatus().catch(console.error)
  }, [projectPath])

  const staged = status?.stagedChanges || []
  const unstaged = status?.unstagedChanges || []
  const visible = filter === "staged" ? staged : unstaged
  const groups = folderGroups(visible)
  const busy = activeOperation !== null

  useEffect(() => {
    if (!groups.some((group) => group.path === selectedFolder && group.files.length)) {
      setSelectedFolder(groups.find((group) => group.files.length)?.path || "ROOT")
    }
  }, [filter, staged.length, unstaged.length, selectedFolder])

  useEffect(() => {
    const groups = projectFileGroups(allFiles)
    if (!groups.some((group) => group.path === selectedAllFilesFolder)) setSelectedAllFilesFolder("ROOT")
  }, [allFiles, selectedAllFilesFolder])

  const syncSummary = hasRemote === false
    ? sectionTitle("尚未配置 GitHub", "GitHub is not configured")
    : hasRemote !== true || !syncStatusChecked
      ? sectionTitle("尚未检查 GitHub", "GitHub has not been checked")
      : syncDiverged
        ? sectionTitle("本地和 GitHub 都有新的修改", "Local and GitHub changes have diverged")
        : syncBehind > 0
          ? (language === "zh-Hans" ? `GitHub 有 ${syncBehind} 个新版本` : `GitHub has ${syncBehind} newer commit${syncBehind === 1 ? "" : "s"}`)
          : syncAhead > 0
            ? (language === "zh-Hans" ? `${syncAhead} 个本地版本等待同步` : `${syncAhead} local commit${syncAhead === 1 ? "" : "s"} waiting to sync`)
            : (language === "zh-Hans" ? "已同步到 GitHub" : "Synced with GitHub")
  const syncButtonTitle = hasRemote === false
    ? sectionTitle("配置 GitHub", "Configure GitHub")
    : hasRemote !== true || !syncStatusChecked
      ? sectionTitle("检查同步", "Check Sync")
      : syncDiverged
        ? sectionTitle("查看同步状态", "View Sync Status")
        : syncBehind > 0
          ? sectionTitle("获取 GitHub 版本", "Get GitHub Version")
          : syncAhead > 0
            ? sectionTitle("同步到 GitHub", "Sync to GitHub")
            : sectionTitle("已同步", "Synced")
  const syncButtonDisabled = busy || (hasRemote === true && syncStatusChecked && !syncDiverged && syncAhead === 0 && syncBehind === 0)
  const summary = staged.length === 0
    ? `${sectionTitle("0 个文件已加入", "0 files added")} · ${unstaged.length} ${sectionTitle("个文件未选择", "not selected")}`
    : unstaged.length === 0
      ? `${staged.length} ${sectionTitle("个文件已加入", "files added")}`
      : `${staged.length} ${sectionTitle("个文件已加入", "files added")} · ${unstaged.length} ${sectionTitle("个文件未选择", "not selected")}`

  return <NavigationStack>
    <List
      navigationTitle="Changes"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbar={{ topBarLeading: <CloseButton />, topBarTrailing: <ToolbarIconButton systemImage="gearshape" onPress={openSettings} /> }}
    >
      {errorMessage ? <ErrorSection message={errorMessage} /> : null}
      <Section header={<Text>{sectionTitle("本次版本", "Current Version")}</Text>}>
        <ChangesSummaryCard
          summary={summary}
          stageTitle={unstaged.length ? (staged.length ? `${sectionTitle("加入剩余", "Add remaining")} ${unstaged.length} ${sectionTitle("个文件", "files")}` : `${sectionTitle("加入全部", "Add all")} ${unstaged.length} ${sectionTitle("个文件", "files")}`) : undefined}
          stageSubtitle={unstaged.length ? (staged.length ? `${staged.length} ${sectionTitle("个文件已加入", "files added")}` : `${unstaged.length} ${sectionTitle("个文件尚未加入", "files not added")}`) : undefined}
          onStage={unstaged.length ? () => { operateAll("stageAll").catch(console.error) } : undefined}
          stageDisabled={busy}
          commitMessageTitle={sectionTitle("版本说明", "Commit Message")}
          commitMessageValue={commitMessage.trim() || (hasCommit === false ? sectionTitle("首次版本", "Initial commit") : sectionTitle("尚未填写", "Not Set"))}
          onCommitMessage={async () => {
            const value = await Dialog.prompt({ title: hasCommit === false ? sectionTitle("首次版本", "Initial Commit") : sectionTitle("版本说明", "Commit Message"), defaultValue: commitMessage, placeholder: sectionTitle("填写版本说明", "Add a commit message"), cancelLabel: t("cancel"), confirmLabel: "Save" })
            if (value !== null) setCommitMessage(value)
          }}
          commitMessageDisabled={busy}
          commitButtonTitle={sectionTitle("保存本地版本", "Commit Locally")}
          commitButtonDisabled={!staged.length || !commitMessage.trim() || busy}
          commitBusy={busy}
          onCommit={() => { handleCommit().catch(console.error) }}
          syncSummary={syncSummary}
          syncButtonTitle={syncButtonTitle}
          onSync={() => { openRemoteSync().catch(console.error) }}
          syncDisabled={syncButtonDisabled}
        />
      </Section>
      <Section header={<Text>{sectionTitle("版本", "Versions")}</Text>}>
        <Button action={async () => {
          try {
            await Navigation.present(<SourceControlHistoryCompareView gitService={service} language={language} projectName={projectPath?.split("/").filter(Boolean).pop()} onChanged={loadStatus} />)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error("[Changes] failed to open version compare", error)
            setErrorMessage(`${sectionTitle("无法打开版本对照", "Unable to open version compare")}\n${message}`)
          }
        }} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
          <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.cardRowHeight, alignment: "leading" }} padding={{ horizontal: tokens.cardPadding, vertical: tokens.cardPadding }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: tokens.cardRadius }}>
            <Image systemName="rectangle.split.2x1" foregroundStyle="blue" />
            <VStack spacing={2} alignment="leading"><Text font="subheadline">{sectionTitle("版本对照", "Compare Versions")}</Text><Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{sectionTitle("本地与 GitHub 版本记录", "Local and GitHub version history")}</Text></VStack>
            <Spacer /><Image systemName="chevron.right" foregroundStyle="secondaryLabel" />
          </HStack>
        </Button>
      </Section>
      {status?.isClean ? <EmptyChangesView loading={loading} t={(key) => t(key)} language={language} /> : null}
      {status && (staged.length || unstaged.length) ? <Section header={<HStack spacing={8}><Text>{t("files")}</Text><Spacer /><Button title={`${sectionTitle("本次版本", "Staged")} ${staged.length}`} buttonStyle="plain" disabled={!staged.length || busy} action={() => setFilter("staged")} /><Button title={`${sectionTitle("未选择", "Changes")} ${unstaged.length}`} buttonStyle="plain" disabled={!unstaged.length || busy} action={() => setFilter("unstaged")} /></HStack>}>
        <ChangesFileBrowser groups={groups} selectedFolder={selectedFolder} onSelect={setSelectedFolder} service={service} filter={filter} onChanged={loadStatus} disabled={busy} language={language} projectPath={projectPath} />
        <Button title={filter === "staged" ? sectionTitle("全部移出本次版本", "Unstage All") : sectionTitle("全部加入本次版本", "Stage All")} buttonStyle="borderless" disabled={busy} action={() => { operateAll(filter === "staged" ? "unstageAll" : "stageAll").catch(console.error) }} />
      </Section> : null}
      <AllFilesSection files={allFiles} showAllFiles={showAllFiles} onToggle={() => setShowAllFiles((value) => !value)} selectedFolder={selectedAllFilesFolder} onSelect={setSelectedAllFilesFolder} language={language} />
    </List>
  </NavigationStack>
}

export default SourceControlChangesPage
