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
  const [operation, setOperation] = useState<"revert" | null>(null)
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

  const handleRevert = async () => {
    if (!detail || detail.parents.length !== 1 || operation !== null) return

    const selected = await Dialog.actionSheet({
      title: "Revert Commit?",
      message: `Revert "${detail.message}"?\n\nA new commit will be created. History will be preserved.`,
      actions: [{ label: "Revert", destructive: true }],
    })
    if (selected !== 0) return

    setOperation("revert")
    setErrorMessage(null)
    try {
      const result = await gitService.revertCommit(detail.oid)
      await Dialog.alert({ title: "Reverted", message: result.shortOid })
      await onCommitReverted?.()
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  const title = shortOid || (detail ? detail.shortOid : "Commit Detail")

  return (
    <List
      navigationTitle={title}
      toolbar={{
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

          {!readOnly && detail.parents.length === 1 ? (
            <Section header={<Text font="footnote">REVERT</Text>}>
              <VStack spacing={6} alignment="leading">
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  Revert creates a new commit and preserves history.
                </Text>
                <Button
                  title={operation === "revert" ? "Reverting…" : "Revert Commit"}
                  systemImage="arrow.uturn.backward"
                  buttonStyle="bordered"
                  role="destructive"
                  disabled={operation !== null}
                  action={handleRevert}
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
