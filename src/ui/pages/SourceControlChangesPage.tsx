import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useRef, useState, VStack } from "scripting"
import { GitService } from "../../core/GitService"
import { GitRepositoryStatus } from "../../core/types"
import { SourceControlDiffView } from "../SourceControlDiffView"
import { SourceControlRemoteView } from "../SourceControlRemoteView"
import { SourceControlSettingsView } from "../SourceControlSettingsView"
import { SourceControlHistoryCompareView } from "../SourceControlHistoryCompareView"
import { AppLanguage } from "../localization"
import { validateCommitTitle, COMMIT_MESSAGE_MAX_LENGTH, CommitTitleValidationError } from "../commitMessage"
import { enumerateProjectFiles, ProjectFileEntry, ProjectFileScanCancellationController } from "../projectFiles"
import { useTranslator } from "../useLocalization"
import { useUISettings } from "../useUISettings"
import { AllFilesSection, ChangesFileBrowser, ChangesSummaryCard, ErrorSection, folderGroups, projectFileGroups, CloseButton, ToolbarIconButton } from "../components"
import { isHistoryNavigationResult, HistoryNavigationResult } from "../SourceControlHistoryCompareView"

export interface SourceControlChangesViewProps { gitService?: GitService; projectPath?: string }
type ChangeFilter = "staged" | "unstaged"

function commitTitleErrorMessage(error: CommitTitleValidationError, t: ReturnType<typeof useTranslator>["t"]): string {
  if (error === "empty") return t("commitTitleEmpty")
  if (error === "multiline") return t("commitTitleMultiline")
  return t("commitTitleTooLong").replace("{count}", String(COMMIT_MESSAGE_MAX_LENGTH))
}

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
  const [skippedDirectories, setSkippedDirectories] = useState<string[]>([])
  const [hasPartialFileScanFailure, setHasPartialFileScanFailure] = useState(false)
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: "restore" | "reset"; message: string } | null>(null)
  const scanAbortControllerRef = useRef<ProjectFileScanCancellationController | null>(null)
  const sectionTitle = (zh: string, en: string) => language === "zh-Hans" ? zh : en

  const loadAllFiles = async () => {
    scanAbortControllerRef.current?.abort()
    const controller = new ProjectFileScanCancellationController()
    scanAbortControllerRef.current = controller
    if (!projectPath) {
      setAllFiles([])
      setSkippedDirectories([])
      setHasPartialFileScanFailure(false)
      scanAbortControllerRef.current = null
      return
    }
    try {
      const result = await enumerateProjectFiles(projectPath, controller.signal)
      if (controller.signal.aborted || scanAbortControllerRef.current !== controller) return
      setAllFiles(result.files)
      setSkippedDirectories(result.skippedDirectories)
      setHasPartialFileScanFailure(result.hasPartialFailure)
    } catch (error) {
      if (!controller.signal.aborted) console.error("[AllFiles] read failed", error)
    } finally {
      if (scanAbortControllerRef.current === controller) scanAbortControllerRef.current = null
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
    const validation = validateCommitTitle(commitMessage)
    const staged = status?.stagedChanges || []
                 if (validation.error) {
      setErrorMessage(commitTitleErrorMessage(validation.error, t))
      return
    }
    if (!staged.length || activeOperation) return
    setActiveOperation("commit")
    setErrorMessage(null)
    try {
      await service.commit(validation.value)
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
      await Navigation.present(<SourceControlRemoteView gitService={service} projectPath={projectPath} onChanged={loadStatus} onOpenSettings={openSettings} />)
      await loadStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[Changes] failed to open GitHub sync", error)
      setErrorMessage(`${sectionTitle("无法打开 GitHub 同步", "Unable to open GitHub Sync")}\n${message}`)
    }
  }

  useEffect(() => {
    loadStatus().catch(console.error)
    return () => {
      scanAbortControllerRef.current?.abort()
      scanAbortControllerRef.current = null
    }
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
      {feedbackBanner ? (
        <Section>
          <HStack
            spacing={tokens.rowContentSpacing}
            alignment="center"
            frame={{ maxWidth: "infinity", minHeight: tokens.cardRowHeight, alignment: "leading" }}
            padding={{ horizontal: tokens.cardPadding, vertical: tokens.cardPadding }}
            background="secondarySystemBackground"
            clipShape={{ type: "rect", cornerRadius: tokens.cardRadius }}
          >
            <Image
              systemName={feedbackBanner.type === "restore" ? "arrow.counterclockwise.circle.fill" : "arrow.uturn.backward.circle.fill"}
              foregroundStyle={feedbackBanner.type === "restore" ? "systemGreen" : "orange"}
            />
            <Text font="footnote" frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {feedbackBanner.message}
            </Text>
            <Button
              action={() => setFeedbackBanner(null)}
              buttonStyle="plain"
              contentShape={{ kind: "interaction", shape: "rect" }}
            >
              <HStack frame={{ width: tokens.toolbarIconHitArea, height: tokens.toolbarIconHitArea, alignment: "center" }}>
                <Image systemName="xmark" foregroundStyle="secondaryLabel" />
              </HStack>
            </Button>
          </HStack>
        </Section>
      ) : null}
      {errorMessage ? <ErrorSection message={errorMessage} /> : null}
      <Section header={<Text>{sectionTitle("本次版本", "Current Version")}</Text>}>
        <ChangesSummaryCard
          summary={summary}
          stageTitle={unstaged.length ? (staged.length ? `${sectionTitle("加入剩余", "Add remaining")} ${unstaged.length} ${sectionTitle("个文件", "files")}` : `${sectionTitle("加入全部", "Add all")} ${unstaged.length} ${sectionTitle("个文件", "files")}`) : undefined}
          stageSubtitle={unstaged.length ? (staged.length ? `${staged.length} ${sectionTitle("个文件已加入", "files added")}` : `${unstaged.length} ${sectionTitle("个文件尚未加入", "files not added")}`) : undefined}
          onStage={unstaged.length ? () => { operateAll("stageAll").catch(console.error) } : undefined}
          stageDisabled={busy}
          commitMessageTitle={t("commitMessage")}
          commitMessageValue={validateCommitTitle(commitMessage).value || (hasCommit === false ? t("initialCommit") : t("noCommitMessage"))}
          onCommitMessage={async () => {
            const value = await Dialog.prompt({ title: hasCommit === false ? t("initialCommit") : t("commitMessage"), defaultValue: commitMessage, placeholder: t("commitTitlePlaceholder").replace("{count}", String(COMMIT_MESSAGE_MAX_LENGTH)), cancelLabel: t("cancel"), confirmLabel: t("save") })
            if (value === null) return
            const validation = validateCommitTitle(value)
            if (validation.error) {
              setErrorMessage(commitTitleErrorMessage(validation.error, t))
              return
            }
            setErrorMessage(null)
            setCommitMessage(validation.value)
          }}
          commitMessageDisabled={busy}
          commitButtonTitle={t("commitLocally")}
          commitButtonDisabled={validateCommitTitle(commitMessage).error !== null || !staged.length || busy}
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
            const result = await Navigation.present<HistoryNavigationResult | null>(
              <SourceControlHistoryCompareView
                gitService={service}
                language={language}
                projectName={projectPath?.split("/").filter(Boolean).pop()}
              />
            )
            if (isHistoryNavigationResult(result)) {
              if ("restored" in result && result.restored) {
                const shortOid = result.shortOid || result.oid.slice(0, 7)
                setFeedbackBanner({
                  type: "restore",
                  message: language === "zh-Hans"
                    ? `已恢复到版本 ${shortOid}，修改尚未暂存，请检查后保存新版本。`
                    : `Restored to commit ${shortOid}. Changes are not staged yet, please review and commit.`
                })
              } else if ("reset" in result && result.reset) {
                const shortOid = result.shortOid || result.toOid.slice(0, 7)
                setFeedbackBanner({
                  type: "reset",
                  message: language === "zh-Hans"
                    ? `已回退到版本 ${shortOid}，请确认当前工作区状态。`
                    : `Reset to commit ${shortOid}. Please check your current working tree status.`
                })
              }
              await loadStatus()
            }
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
      <AllFilesSection files={allFiles} skippedDirectories={skippedDirectories} hasPartialFailure={hasPartialFileScanFailure} showAllFiles={showAllFiles} onToggle={() => setShowAllFiles((value) => !value)} selectedFolder={selectedAllFilesFolder} onSelect={setSelectedAllFilesFolder} language={language} />
    </List>
  </NavigationStack>
}

export default SourceControlChangesPage
