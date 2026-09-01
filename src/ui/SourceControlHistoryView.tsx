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
import { GitCommitInfo } from "../core/types"
import { HistoryRow } from "./HistoryRow"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"

export interface SourceControlHistoryViewProps {
  gitService: GitService
  projectPath: string
}

export function SourceControlHistoryView({
  gitService,
  projectPath,
}: SourceControlHistoryViewProps) {
  const dismiss = Navigation.useDismiss()
  const [history, setHistory] = useState<GitCommitInfo[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadHistory = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const list = await gitService.getHistory(30)
      setHistory(list)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [projectPath])

  const openCommitDetail = async (commit: GitCommitInfo) => {
    await Navigation.present(
      <SourceControlCommitDetailView
        gitService={gitService}
        oid={commit.oid}
        shortOid={commit.shortOid}
        onCommitReverted={loadHistory}
      />
    )
  }

  return (
    <List
      navigationTitle="History"
      toolbar={{
        topBarLeading: (
          <Button
            title="Done"
            buttonStyle="borderless"
            action={() => {
              dismiss()
            }}
          />
        ),
        topBarTrailing: (
          <Button
            title="Refresh"
            systemImage="arrow.clockwise"
            buttonStyle="borderless"
            disabled={loading}
            action={loadHistory}
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
                加载提交历史失败
              </Text>
            </HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {errorMessage}
            </Text>
            <Button
              title="重试"
              action={async () => {
                await loadHistory()
              }}
            />
          </VStack>
        </Section>
      ) : null}

      {loading && history.length === 0 ? (
        <Section>
          <VStack
            spacing={12}
            alignment="center"
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 24, bottom: 24 }}
          >
            <ProgressView />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              正在加载提交历史...
            </Text>
          </VStack>
        </Section>
      ) : null}

      {!loading && history.length === 0 && !errorMessage ? (
        <Section>
          <VStack
            spacing={8}
            alignment="center"
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 24, bottom: 24 }}
          >
            <Image systemName="clock.arrow.circlepath" font="largeTitle" foregroundStyle="tertiaryLabel" />
            <Text font="headline">No Commits</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              当前分支暂无任何提交记录
            </Text>
          </VStack>
        </Section>
      ) : null}

      {history.length > 0 ? (
        <Section header={<Text font="footnote">{`COMMITS · ${history.length}`}</Text>}>
          {history.map((commit) => (
            <HistoryRow
              key={commit.oid}
              commit={commit}
              onSelect={() => {
                openCommitDetail(commit)
              }}
            />
          ))}
        </Section>
      ) : null}
    </List>
  )
}
export default SourceControlHistoryView
