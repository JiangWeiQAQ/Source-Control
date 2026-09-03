import {
  Button,
  HStack,
  List,
  Navigation,
  ProgressView,
  Section,
  Spacer,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { GitService } from "../core/GitService"
import { GitChange, GitDiffLine, GitDiffResult } from "../core/types"
import { CloseButton } from "./CloseButton"

export interface SourceControlDiffViewProps {
  gitService: GitService
  change: GitChange
  comparison: "unstaged" | "staged"
  onChanged?: () => Promise<void>
}

function displayFilename(filepath: string): string {
  return filepath.split("/").filter(Boolean).pop() || filepath
}

function canRestore(change: GitChange, comparison: "unstaged" | "staged"): boolean {
  return comparison === "unstaged" && change.worktreeStatus !== "untracked" && change.indexStatus !== "absent"
}

function DiffLineRow({ line }: { line: GitDiffLine }) {
  const prefix = line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "
  const oldNumber = line.oldLineNumber === null ? "" : String(line.oldLineNumber)
  const newNumber = line.newLineNumber === null ? "" : String(line.newLineNumber)
  const lineText = line.kind === "addition" ? (
    <Text font="body" foregroundStyle="green">{prefix}{line.text}</Text>
  ) : line.kind === "deletion" ? (
    <Text font="body" foregroundStyle="red">{prefix}{line.text}</Text>
  ) : (
    <Text font="body">{prefix}{line.text}</Text>
  )

  return (
    <HStack spacing={8} alignment="top">
      <HStack spacing={4}>
        <Text font="caption" foregroundStyle="secondaryLabel">{oldNumber}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">{newNumber}</Text>
      </HStack>
      {lineText}
    </HStack>
  )
}

function DiffSummary({
  filepath,
  filename,
  comparison,
  additions,
  deletions,
}: {
  filepath: string
  filename: string
  comparison: "unstaged" | "staged"
  additions: number
  deletions: number
}) {
  return (
    <VStack spacing={5} alignment="leading">
      <HStack spacing={8} alignment="center">
        <VStack spacing={3} alignment="leading">
          <Text font="headline">{filename}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{filepath}</Text>
        </VStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          {comparison === "staged" ? "Staged" : "Working tree"}
        </Text>
      </HStack>
      <HStack spacing={12}>
        <Text font="footnote" foregroundStyle="green">+{additions}</Text>
        <Text font="footnote" foregroundStyle="red">−{deletions}</Text>
      </HStack>
    </VStack>
  )
}

export function SourceControlDiffView({ gitService, change, comparison: initialComparison, onChanged }: SourceControlDiffViewProps) {
  const dismiss = Navigation.useDismiss()
  const [comparison, setComparison] = useState<"unstaged" | "staged">(initialComparison)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<"stage" | "unstage" | "restore" | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const filename = displayFilename(change.filepath)
  const primaryActionTitle = comparison === "staged" ? "Unstage" : "Stage"
  const primaryActionImage = comparison === "staged" ? "minus.circle" : "plus.circle"

  const loadDiff = async (nextComparison = comparison) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      setDiff(await gitService.getFileDiff(change.filepath, nextComparison))
    } catch (error) {
      setDiff(null)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiff(initialComparison).catch(console.error)
  }, [])

  const updateAfterOperation = async (nextComparison: "unstaged" | "staged") => {
    setComparison(nextComparison)
    await onChanged?.()
    await loadDiff(nextComparison)
  }

  const handleStage = async () => {
    setOperation("stage")
    setErrorMessage(null)
    try {
      await gitService.stageFile(change.filepath)
      await updateAfterOperation("staged")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const handleUnstage = async () => {
    setOperation("unstage")
    setErrorMessage(null)
    try {
      await gitService.unstageFile(change.filepath)
      await updateAfterOperation("unstaged")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const handleRestore = async () => {
    const selected = await Dialog.actionSheet({
      title: "Restore Changes?",
      message: `This will discard uncommitted changes in "${filename}".`,
      actions: [{ label: "Restore", destructive: true }],
    })
    if (selected !== 0) return

    setOperation("restore")
    setErrorMessage(null)
    try {
      await gitService.restoreFile(change.filepath)
      await onChanged?.()
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const handlePrimaryAction = comparison === "staged" ? handleUnstage : handleStage

  return (
    <List
      navigationTitle="Diff"
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: (
          <Button
            title={primaryActionTitle}
            systemImage={primaryActionImage}
            buttonStyle="borderless"
            disabled={operation !== null}
            action={handlePrimaryAction}
          />
        ),
      }}
    >
      <Section>
        <DiffSummary
          filepath={change.filepath}
          filename={filename}
          comparison={comparison}
          additions={diff?.additions ?? 0}
          deletions={diff?.deletions ?? 0}
        />
      </Section>

      {errorMessage ? (
        <Section>
          <VStack spacing={4} alignment="leading">
            <Text font="headline" foregroundStyle="red">Unable to Load Diff</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      {loading ? (
        <Section>
          <HStack spacing={8}>
            <ProgressView />
            <Text font="footnote" foregroundStyle="secondaryLabel">Loading diff…</Text>
          </HStack>
        </Section>
      ) : null}

      {!loading && diff?.message ? (
        <Section>
          <Text font="body" foregroundStyle="secondaryLabel">{diff.message}</Text>
        </Section>
      ) : null}

      {!loading && diff && !diff.message ? (
        <Section header={<Text>{diff.hunks[0]?.header || "No textual changes"}</Text>}>
          {diff.hunks.flatMap((hunk) => hunk.lines).map((line, index) => (
            <DiffLineRow key={`${line.kind}-${index}`} line={line} />
          ))}
        </Section>
      ) : null}

      <Section footer={<Text>Swipe a file in Changes for the same stage action.</Text>}>
        {canRestore(change, comparison) ? (
          <Button
            title="Restore Changes"
            systemImage="arrow.uturn.backward"
            buttonStyle="bordered"
            disabled={operation !== null}
            role="destructive"
            action={handleRestore}
          />
        ) : null}
      </Section>
    </List>
  )
}

export default SourceControlDiffView
