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
  TextField,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { GitService } from "../core/GitService"
import { GitChange, GitRepositoryStatus } from "../core/types"
import { SourceControlDiffView } from "./SourceControlDiffView"
import { SourceControlHistoryView } from "./SourceControlHistoryView"
import { SourceControlSnapshotsView } from "./SourceControlSnapshotsView"
import { SourceControlRemoteView } from "./SourceControlRemoteView"

export interface SourceControlChangesViewProps {
  gitService?: GitService
  projectPath?: string
}

function getStatusPresentation(change: GitChange): {
  label: string
  color: "green" | "red" | "blue" | "orange"
} {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: "?", color: "orange" }
  return { label: "M", color: "blue" }
}

function getRepositoryDisplayName(projectPath?: string): string {
  if (!projectPath) return "Source Control Stage Test"
  const parts = projectPath.split("/").filter(Boolean)
  return parts[parts.length - 1] || "Source Control Stage Test"
}

function ChangeItemRow({
  gitService,
  change,
  comparison,
  onStatusChanged,
  actionTitle,
  actionImage,
  action,
  isOperationActive,
}: {
  gitService: GitService
  change: GitChange
  comparison: "unstaged" | "staged"
  onStatusChanged: () => Promise<void>
  actionTitle: string
  actionImage: string
  action: () => void
  isOperationActive: boolean
}) {
  const status = getStatusPresentation(change)
  const stagedState = comparison === "staged" ? "Staged" : "Working tree"

  return (
    <NavigationLink
      disabled={isOperationActive}
      destination={
        <SourceControlDiffView
          gitService={gitService}
          change={change}
          comparison={comparison}
          onChanged={onStatusChanged}
        />
      }
    >
      <HStack
        spacing={12}
        alignment="center"
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button
              title={actionTitle}
              systemImage={actionImage}
              disabled={isOperationActive}
              action={action}
            />,
          ],
        }}
      >
        <Text font="caption" bold foregroundStyle={status.color}>
          {status.label}
        </Text>
        <VStack spacing={3} alignment="leading">
          <Text font="body">{change.filepath}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {stagedState} · {change.status}
          </Text>
        </VStack>
        <Spacer />
        {isOperationActive ? <ProgressView /> : null}
      </HStack>
    </NavigationLink>
  )
}

function EmptyChangesView({ loading }: { loading: boolean }) {
  return (
    <Section>
      <VStack spacing={8} alignment="center">
        {loading ? <ProgressView /> : <Image systemName="checkmark.circle" foregroundStyle="green" />}
        <Text font="headline">{loading ? "Refreshing Changes" : "Working Tree Clean"}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          {loading ? "Checking the repository status…" : "There are no staged or unstaged changes."}
        </Text>
      </VStack>
    </Section>
  )
}

export function SourceControlChangesView({
  gitService: propGitService,
  projectPath,
}: SourceControlChangesViewProps) {
  const [service] = useState<GitService>(() => propGitService || new GitService())
  const [loading, setLoading] = useState<boolean>(true)
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasCommit, setHasCommit] = useState<boolean | null>(null)
  const [activeOperation, setActiveOperation] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState<string>("")
  const repositoryDisplayName = getRepositoryDisplayName(projectPath)

  const loadStatus = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      if (projectPath) {
        await service.openRepository(projectPath)
      }
      const repoStatus = await service.getStatus()
      setStatus(repoStatus)
      try {
        const history = await service.getHistory(1)
        setHasCommit(history.length > 0)
      } catch (historyError) {
        console.error("[Changes] history check FAILED", historyError)
        setHasCommit(null)
      }
    } catch (err) {
      console.error("[Changes] load FAILED", err)
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setHasCommit(null)
    } finally {
      setLoading(false)
    }
  }

  const handleFileOperation = async (
    operation: "stage" | "unstage",
    filepath: string,
  ) => {
    if (activeOperation !== null) return

    const operationKey = `${operation}:${filepath}`

    setActiveOperation(operationKey)
    setErrorMessage(null)
    try {
      if (operation === "stage") {
        await service.stageFile(filepath)
      } else {
        await service.unstageFile(filepath)
      }
      await loadStatus()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
  }

  const handleAllOperation = async (operation: "stageAll" | "unstageAll") => {
    if (activeOperation !== null) return

    setActiveOperation(operation)
    setErrorMessage(null)
    try {
      if (operation === "stageAll") {
        await service.stageAll()
      } else {
        await service.unstageAll()
      }
      await loadStatus()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
  }

  const handleCommit = async () => {
    const trimmedMessage = commitMessage.trim()
    if (!trimmedMessage || activeOperation !== null || !status || status.stagedChanges.length === 0) {
      return
    }

    setActiveOperation("commit")
    setErrorMessage(null)
    try {
      const result = await service.commit(trimmedMessage)
      setCommitMessage("")
      await loadStatus()
      await Dialog.alert({
        title: "Committed",
        message: result.shortOid,
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
  }

  useEffect(() => {
    loadStatus().catch(console.error)
  }, [projectPath])

  const stagedCount = status?.stagedChanges.length ?? 0
  const unstagedCount = status?.unstagedChanges.length ?? 0

  return (
    <List
      navigationTitle="Changes"
      toolbar={{
        topBarTrailing: (
          <HStack spacing={12}>
            <Menu title="More" systemImage="ellipsis.circle">
              <Button
                title="Remote"
                systemImage="arrow.triangle.2.circlepath"
                action={async () => {
                  await Navigation.present(
                    <SourceControlRemoteView
                      gitService={service}
                      onChanged={loadStatus}
                    />
                  )
                }}
              />
              <Button
                title="Snapshots"
                systemImage="archivebox"
                action={async () => {
                  await Navigation.present(
                    <SourceControlSnapshotsView
                      gitService={service}
                      onRestored={loadStatus}
                    />
                  )
                }}
              />
            </Menu>
            <Button
              title="History"
              systemImage="clock.arrow.circlepath"
              buttonStyle="borderless"
              action={async () => {
                await Navigation.present(
                  <SourceControlHistoryView
                    gitService={service}
                    projectPath={projectPath || `${FileManager.scriptsDirectory}/Source Control Stage Test`}
                  />
                )
              }}
            />
            <Button
              title="Refresh"
              systemImage="arrow.clockwise"
              buttonStyle="borderless"
              disabled={loading}
              action={loadStatus}
            />
          </HStack>
        ),
      }}
    >
      <Section>
        <VStack spacing={4} alignment="leading">
          <Text font="headline">{repositoryDisplayName}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {loading ? "Refreshing repository status…" : `${stagedCount} staged · ${unstagedCount} unstaged`}
          </Text>
        </VStack>
      </Section>

      {hasCommit === false ? (
        <Section>
          <VStack spacing={6} alignment="leading">
            <Text font="headline">Repository Initialized</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              This repository has no commits yet. Stage the files you want to include, then create your Initial Commit.
            </Text>
            {status && status.stagedChanges.length > 0 ? (
              <>
                <Text font="subheadline">
                  {status.unstagedChanges.length > 0 ? "Some files are staged." : "Ready for Initial Commit"}
                </Text>
                {status.unstagedChanges.length === 0 ? (
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    Enter a message in the Commit section below to create your Initial Commit.
                  </Text>
                ) : null}
              </>
            ) : null}
            {status && status.unstagedChanges.length > 0 ? (
              <Button
                title={
                  activeOperation === "stageAll"
                    ? "Staging…"
                    : status.stagedChanges.length > 0
                      ? "Stage Remaining"
                      : "Stage All"
                }
                buttonStyle="borderless"
                disabled={activeOperation !== null}
                action={() => handleAllOperation("stageAll")}
              />
            ) : null}
          </VStack>
        </Section>
      ) : null}

      {errorMessage ? (
        <Section>
          <VStack spacing={4} alignment="leading">
            <Text font="headline" foregroundStyle="red">Unable to Load Changes</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      {status?.isClean ? <EmptyChangesView loading={loading} /> : null}

      {status && !status.isClean ? (
        <>
          {status.stagedChanges.length > 0 ? (
            <>
              <Section
                header={
                  <HStack spacing={8} alignment="center">
                    <Text>STAGED CHANGES · {status.stagedChanges.length}</Text>
                    <Spacer />
                    <Button
                      title={activeOperation === "unstageAll" ? "Unstaging…" : "Unstage All"}
                      buttonStyle="borderless"
                      disabled={activeOperation !== null}
                      action={() => handleAllOperation("unstageAll")}
                    />
                  </HStack>
                }
              >
                {status.stagedChanges.map((change) => (
                  <ChangeItemRow
                    key={change.filepath}
                    change={change}
                    gitService={service}
                    comparison="staged"
                    onStatusChanged={loadStatus}
                    actionTitle="Unstage"
                    actionImage="minus.circle"
                    action={() => handleFileOperation("unstage", change.filepath)}
                    isOperationActive={activeOperation !== null}
                  />
                ))}
              </Section>

              <Section>
                <VStack spacing={10} alignment="leading">
                  <TextField
                    title="Commit message"
                    prompt={hasCommit === false ? "Initial commit" : "Commit message"}
                    value={commitMessage}
                    onChanged={setCommitMessage}
                  />
                  <Button
                    title={activeOperation === "commit" ? "Committing…" : "Commit"}
                    buttonStyle="borderedProminent"
                    disabled={
                      activeOperation !== null ||
                      commitMessage.trim().length === 0 ||
                      status.stagedChanges.length === 0
                    }
                    action={handleCommit}
                  />
                </VStack>
              </Section>
            </>
          ) : null}

          {status.unstagedChanges.length > 0 ? (
            <Section
              header={
                <HStack spacing={8} alignment="center">
                  <Text>CHANGES · {status.unstagedChanges.length}</Text>
                  <Spacer />
                  <Button
                    title={activeOperation === "stageAll" ? "Staging…" : "Stage All"}
                    buttonStyle="borderless"
                    disabled={activeOperation !== null}
                    action={() => handleAllOperation("stageAll")}
                  />
                </HStack>
              }
            >
              {status.unstagedChanges.map((change) => (
                <ChangeItemRow
                  key={change.filepath}
                  change={change}
                  gitService={service}
                  comparison="unstaged"
                  onStatusChanged={loadStatus}
                  actionTitle="Stage"
                  actionImage="plus.circle"
                  action={() => handleFileOperation("stage", change.filepath)}
                  isOperationActive={activeOperation !== null}
                />
              ))}
            </Section>
          ) : null}
        </>
      ) : null}
    </List>
  )
}

export default SourceControlChangesView
