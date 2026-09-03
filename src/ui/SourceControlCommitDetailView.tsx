import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  ProgressView,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { GitService } from "../core/GitService"
import { GitCommitChangedFile, GitCommitDetail } from "../core/types"
import { CloseButton } from "./CloseButton"

export interface SourceControlCommitDetailViewProps {
  gitService: GitService
  oid: string
  shortOid?: string
  onCommitReverted?: () => Promise<void>
  readOnly?: boolean
}

function formatCommitTime(timestamp: number): string {
  const commitDate = new Date(timestamp * 1000)
  const now = new Date()

  const isToday =
    commitDate.getFullYear() === now.getFullYear() &&
    commitDate.getMonth() === now.getMonth() &&
    commitDate.getDate() === now.getDate()

  const isSameYear = commitDate.getFullYear() === now.getFullYear()

  const pad = (n: number) => String(n).padStart(2, "0")
  const hours = pad(commitDate.getHours())
  const minutes = pad(commitDate.getMinutes())

  if (isToday) {
    return `${hours}:${minutes}`
  }

  const month = commitDate.getMonth() + 1
  const day = commitDate.getDate()

  if (isSameYear) {
    return `${month}月${day}日 ${hours}:${minutes}`
  }

  return `${commitDate.getFullYear()}年${month}月${day}日`
}

function formatChangeTypeBadge(changeType: GitCommitChangedFile["changeType"]): {
  symbol: string
  color: "green" | "orange" | "red"
} {
  switch (changeType) {
    case "added":
      return { symbol: "A", color: "green" }
    case "deleted":
      return { symbol: "D", color: "red" }
    case "modified":
    default:
      return { symbol: "M", color: "orange" }
  }
}

function splitPath(filepath: string): { filename: string; directory: string | null } {
  const segments = filepath.split("/")
  const filename = segments.pop() || filepath
  const directory = segments.length > 0 ? segments.join("/") : null
  return { filename, directory }
}

function formatVersionSummary(shortOid: string, message: string): string {
  const summary = message.replace(/\s+/g, " ").trim() || "No commit message"
  return `${shortOid} · ${summary}`
}

export function SourceControlCommitDetailView({
  gitService,
  oid,
  shortOid,
  onCommitReverted,
  readOnly = false,
}: SourceControlCommitDetailViewProps) {
  const dismiss = Navigation.useDismiss()
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [restoreErrorTitle, setRestoreErrorTitle] = useState<string | null>(null)
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null)
  const [restoreErrorDetail, setRestoreErrorDetail] = useState<string | null>(null)
  const [restoreOperation, setRestoreOperation] = useState<"restoring" | "resetting" | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadDetail = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const data = await gitService.getCommitDetail(oid)
      setDetail(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetail()
  }, [oid])

  const handleRestore = async () => {
    if (!detail || restoreOperation !== null) return

    setRestoreErrorTitle(null)
    setRestoreErrorMessage(null)
    setRestoreErrorDetail(null)
    const selected = await Dialog.actionSheet({
      title: "恢复方式",
      message: `恢复目标：${detail.shortOid}\n\n保存为最新版本（推荐）\n使用该历史版本的文件内容恢复工作区。\n当前版本和全部历史都会保留。\n恢复后请填写版本说明并保存为新的本地版本。\n\n直接回退（高级）\n将本地分支直接回退到此 Commit。\n此 Commit 之后的版本将不再属于当前分支历史。`,
      actions: [
        { label: "1. 保存为最新版本（推荐）" },
        { label: "2. 直接回退（高级）", destructive: true },
      ],
    })

    if (selected === null) return
    if (selected === 0) {
      const confirmed = await Dialog.confirm({
        title: "恢复此版本？",
        message: "将使用此版本的文件内容恢复工作区。\n\n当前版本和全部历史都会保留。\n恢复后需要填写版本说明并保存为新的本地版本。\n\n不会自动同步到 GitHub。",
        cancelLabel: "取消",
        confirmLabel: "恢复",
      })
      if (!confirmed) return

      setRestoreOperation("restoring")
      try {
        const result = await gitService.restoreCommitToWorkingTree(detail.oid)
        if (!result.restored && result.changedFiles === 0) {
          await Dialog.alert({ title: "已经是此版本", message: "当前文件内容与所选版本一致。" })
          return
        }

        await Dialog.alert({
          title: "版本内容已恢复",
          message: `已恢复 ${result.changedFiles} 个文件。\n这些改动保持为未暂存状态。\n请返回首页填写版本说明并保存为新的本地版本。\n\n不会自动同步到 GitHub。`,
        })
        try {
          await onCommitReverted?.()
        } catch (callbackError) {
          console.error("[CommitDetail] restore callback failed", callbackError)
        }
        dismiss({ restored: true, oid: result.oid, shortOid: result.shortOid, changedFiles: result.changedFiles })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isDirty = message.includes("Working tree must be clean before restoring a historical version.") || message.includes("当前工作区必须干净") || message.includes("DIRTY_WORKTREE")
        setRestoreErrorMessage(isDirty ? "当前还有暂存、未暂存或未跟踪的改动。\n请先保存或处理这些改动，再恢复历史版本。" : "无法恢复版本")
        setRestoreErrorDetail(message)
      } finally {
        setRestoreOperation(null)
      }
      return
    }

    const firstConfirmed = await Dialog.confirm({
      title: "直接回退到此版本？",
      message: "此操作会把当前本地分支移动到所选版本。\n\n此版本之后的本地提交将不再显示在当前分支历史中。\n\nSource Control 会保留一个内部恢复点，因此之后仍有机会找回回退前版本。\n\n不会自动修改 GitHub。",
      cancelLabel: "取消",
      confirmLabel: "继续",
    })
    if (!firstConfirmed) return

    setRestoreOperation("resetting")
    try {
      const currentHistory = await gitService.getHistory(1)
      const currentVersion = currentHistory[0]
      if (!currentVersion) {
        setRestoreErrorTitle("无法直接回退")
        setRestoreErrorMessage("无法读取当前本地版本。\n请稍后重试。")
        return
      }

      const secondSelection = await Dialog.actionSheet({
        title: "确认直接回退？",
        message: `当前版本：\n${formatVersionSummary(currentVersion.shortOid, currentVersion.message)}\n\n目标版本：\n${formatVersionSummary(detail.shortOid, detail.message)}\n\n回退后 Working Tree 和 Index 都会切换到目标版本。\n\n如果当前版本已经同步到 GitHub，本地与 GitHub 可能暂时不一致。`,
        cancelButton: false,
        actions: [
          { label: "取消" },
          { label: "直接回退", destructive: true },
        ],
      })
      if (secondSelection !== 1) return

      const result = await gitService.resetBranchToCommit(detail.oid)
      if (!result.reset) {
        await Dialog.alert({ title: "已经位于此版本", message: "当前本地分支已经位于所选版本。" })
        return
      }

      await Dialog.alert({
        title: "已回退到此版本",
        message: `当前本地分支已回退到：${result.shortOid}\n\n回退前版本已保留为内部恢复点。\n\nGitHub 未被修改。`,
      })
      try {
        await onCommitReverted?.()
      } catch (callbackError) {
        console.error("[CommitDetail] reset callback failed", callbackError)
      }
      dismiss({ reset: true, fromOid: result.fromOid, toOid: result.toOid, shortOid: result.shortOid })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isDirty = message.includes("Working tree must be clean before resetting the branch.") || message.includes("当前工作区必须干净") || message.includes("RESET_DIRTY_WORKTREE")
      const isNonAncestor = message.includes("Target commit is not an ancestor of the current branch.") || message.includes("RESET_NON_ANCESTOR")
      setRestoreErrorTitle("无法直接回退")
      if (isDirty) {
        setRestoreErrorMessage("当前还有未保存的本地改动。\n请先保存或处理这些改动。")
      } else if (isNonAncestor) {
        setRestoreErrorMessage("只能直接回退到当前本地分支中的历史版本。")
      } else {
        setRestoreErrorMessage("直接回退没有完成。")
      }
      setRestoreErrorDetail(message)
    } finally {
      setRestoreOperation(null)
    }
  }

  const title = shortOid || (detail ? detail.shortOid : "Commit Detail")

  return (
    <List
      navigationTitle={title}
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: (
          <Button
            title="Done"
            buttonStyle="borderless"
            action={() => {
              dismiss()
            }}
          />
        ),
      }}
    >
      {errorMessage ? (
        <Section>
          <VStack
            spacing={8}
            alignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <HStack spacing={6} alignment="center">
              <Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" />
              <Text font="headline" foregroundStyle="red">
                加载提交失败
              </Text>
            </HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {errorMessage}
            </Text>
            <Button
              title="重试"
              action={async () => {
                await loadDetail()
              }}
            />
          </VStack>
        </Section>
      ) : null}

      {loading && !detail ? (
        <Section>
          <VStack
            spacing={12}
            alignment="center"
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 20, bottom: 20 }}
          >
            <ProgressView />
            <Text font="footnote" foregroundStyle="secondaryLabel">
              正在读取 Commit 信息...
            </Text>
          </VStack>
        </Section>
      ) : null}

      {detail ? (
        <>
          <Section header={<Text font="footnote">COMMIT</Text>}>
            <VStack
              spacing={10}
              alignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <Text font="title3">
                {detail.message || "No commit message"}
              </Text>

              <HStack spacing={8} alignment="center">
                <Text font="subheadline" foregroundStyle="blue" monospaced>
                  {detail.shortOid}
                </Text>
                <Text font="caption" foregroundStyle="tertiaryLabel">
                  {formatCommitTime(detail.timestamp)}
                </Text>
              </HStack>

              <VStack spacing={4} alignment="leading">
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  FULL OID
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel" monospaced>
                  {detail.oid}
                </Text>
              </VStack>

              <VStack spacing={4} alignment="leading">
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  AUTHOR
                </Text>
                <Text font="subheadline">
                  {detail.author.name}
                </Text>
                {detail.author.email ? (
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {detail.author.email}
                  </Text>
                ) : null}
              </VStack>
            </VStack>
          </Section>

          {restoreErrorMessage ? (
            <Section>
              <VStack spacing={6} alignment="leading">
                <HStack spacing={6} alignment="center">
                  <Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" />
                  <Text font="headline" foregroundStyle="red">
                    {restoreErrorTitle || "无法恢复版本"}
                  </Text>
                </HStack>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {restoreErrorMessage}
                </Text>
                {restoreErrorDetail ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {restoreErrorDetail}
                  </Text>
                ) : null}
              </VStack>
            </Section>
          ) : null}

          {!readOnly ? (
            <Section header={<Text font="footnote">恢复</Text>}>
              <VStack spacing={6} alignment="leading">
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  推荐使用“保存为最新版本”：创建新的本地版本，不删除现有历史。
                </Text>
                <Text font="caption" foregroundStyle="tertiaryLabel">
                  恢复后不会自动暂存、提交或同步到 GitHub。
                </Text>
                <Button
                  title="恢复此版本"
                  systemImage="arrow.uturn.backward"
                  buttonStyle="bordered"
                  disabled={loading || restoreOperation !== null}
                  action={handleRestore}
                />
              </VStack>
            </Section>
          ) : null}

          <Section header={<Text font="footnote">{`PARENTS · ${detail.parents.length}`}</Text>}>
            {detail.parents.length === 0 ? (
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                Root commit (No parent)
              </Text>
            ) : (
              detail.parents.map((parentOid) => {
                const parentShort = parentOid.slice(0, 7)
                return (
                  <HStack key={parentOid} spacing={8} alignment="center">
                    <Image systemName="arrow.triangle.branch" foregroundStyle="secondaryLabel" />
                    <Text font="subheadline" foregroundStyle="blue" monospaced>
                      {parentShort}
                    </Text>
                    <Text font="caption" foregroundStyle="tertiaryLabel" monospaced>
                      {parentOid}
                    </Text>
                  </HStack>
                )
              })
            )}
          </Section>

          <Section header={<Text font="footnote">{`CHANGED FILES · ${detail.changedFiles.length}`}</Text>}>
            {detail.changedFiles.length === 0 ? (
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                无文件变动
              </Text>
            ) : (
              detail.changedFiles.map((file) => {
                const badge = formatChangeTypeBadge(file.changeType)
                const { filename, directory } = splitPath(file.filepath)

                return (
                  <HStack
                    key={file.filepath}
                    spacing={10}
                    alignment="center"
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font="headline" foregroundStyle={badge.color} monospaced>
                      {badge.symbol}
                    </Text>

                    <VStack spacing={2} alignment="leading">
                      <Text font="body" lineLimit={1}>
                        {filename}
                      </Text>
                      {directory ? (
                        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                          {directory}
                        </Text>
                      ) : null}
                    </VStack>
                  </HStack>
                )
              })
            )}
          </Section>
        </>
      ) : null}
    </List>
  )
}
export default SourceControlCommitDetailView
