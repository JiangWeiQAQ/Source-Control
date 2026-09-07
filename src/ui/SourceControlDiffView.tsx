import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
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
import { useTranslator } from "./useLocalization"

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
  comparisonLabel,
  additions,
  deletions,
}: {
  filepath: string
  filename: string
  comparisonLabel: string
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
          {comparisonLabel}
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
  const { t } = useTranslator()
  const dismiss = Navigation.useDismiss()
  const [comparison, setComparison] = useState<"unstaged" | "staged">(initialComparison)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<"stage" | "unstage" | "restore" | null>(null)
  const [diffRequestSequence] = useState({ value: 0 })
  const [latestChange, setLatestChange] = useState<GitChange>(change)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const filename = displayFilename(change.filepath)
  const primaryActionTitle = comparison === "staged" ? t("unstage") : t("stage")
  const primaryActionImage = comparison === "staged" ? "minus.circle" : "plus.circle"

  const loadDiff = async (nextComparison = comparison) => {
    const requestId = ++diffRequestSequence.value
    setLoading(true)
    setErrorMessage(null)
    try {
      const nextDiff = await gitService.getFileDiff(change.filepath, nextComparison)
      if (requestId !== diffRequestSequence.value) return
      setDiff(nextDiff)
    } catch (error) {
      if (requestId !== diffRequestSequence.value) return
      setDiff(null)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === diffRequestSequence.value) setLoading(false)
    }
  }

  useEffect(() => {
    loadDiff(initialComparison).catch(console.error)
  }, [])

  const updateAfterOperation = async (nextComparison: "unstaged" | "staged") => {
    const status = await gitService.getStatus()
    const currentChange = [...status.changes, ...status.stagedChanges, ...status.unstagedChanges].find((item) => item.filepath === change.filepath)
    setLatestChange(currentChange ?? { ...change, status: "unmodified", staged: false, worktreeStatus: "absent", indexStatus: "absent" })
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
      title: t("restoreChangesQuestion"),
      message: t("restoreChangesMessage").replace("{filename}", filename),
      actions: [{ label: t("restore"), destructive: true }],
    })
    if (selected !== 0) return

    setOperation("restore")
    setErrorMessage(null)
    try {
      await gitService.restoreFile(change.filepath)
      const status = await gitService.getStatus()
      const currentChange = [...status.changes, ...status.stagedChanges, ...status.unstagedChanges].find((item) => item.filepath === change.filepath)
      setLatestChange(currentChange ?? { ...change, status: "unmodified", staged: false, worktreeStatus: "absent", indexStatus: "absent" })
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
    <NavigationStack>
      <List
      navigationTitle={t("diff")}
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
          comparisonLabel={comparison === "staged" ? t("staged") : t("workingTree")}
          additions={diff?.additions ?? 0}
          deletions={diff?.deletions ?? 0}
        />
      </Section>

      {errorMessage ? (
        <Section>
          <VStack spacing={4} alignment="leading">
            <Text font="headline" foregroundStyle="red">{t("unableToLoadDiff")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      {loading ? (
        <Section>
          <HStack spacing={8}>
            <ProgressView />
            <Text font="footnote" foregroundStyle="secondaryLabel">{t("loadingDiff")}</Text>
          </HStack>
        </Section>
      ) : null}

      {!loading && diff?.message ? (
        <Section>
          <Text font="body" foregroundStyle="secondaryLabel">{diff.message}</Text>
        </Section>
      ) : null}

      {!loading && diff && !diff.message ? (
        <Section header={<Text>{diff.hunks[0]?.header || t("noTextualChanges")}</Text>}>
          {diff.hunks.flatMap((hunk) => hunk.lines).map((line, index) => (
            <DiffLineRow key={`${line.kind}-${index}`} line={line} />
          ))}
        </Section>
      ) : null}

      <Section footer={<Text>{t("diffFooterHint")}</Text>}>
        {canRestore(latestChange, comparison) ? (
          <Button
            title={t("restoreChanges")}
            systemImage="arrow.uturn.backward"
            buttonStyle="bordered"
            disabled={operation !== null}
            role="destructive"
            action={handleRestore}
          />
        ) : null}
      </Section>
      </List>
    </NavigationStack>
  )
}

export default SourceControlDiffView
