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
import { CloseButton } from "./CloseButton"
import { GitCommitInfo } from "../core/types"
import { GitService } from "../core/GitService"
import { AppLanguage, createTranslator } from "./localization"
import { HistoryRow } from "./HistoryRow"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"

export interface SourceControlHistoryViewProps {
  gitService: GitService
  projectPath: string
  language?: AppLanguage
}

export function SourceControlHistoryView({ gitService, projectPath, language = "en" }: SourceControlHistoryViewProps) {
  const dismiss = Navigation.useDismiss()
  const t = createTranslator(language)
  const [history, setHistory] = useState<GitCommitInfo[]>([])
  const [remoteOids, setRemoteOids] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadHistory = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const localHistory = await gitService.getHistory(30)
      setHistory(localHistory)
      try {
        const remotes = await gitService.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]; const branch = await gitService.getCurrentBranch()
        if (remote && branch && (await gitService.listRemoteBranches(remote.name)).some((item) => item.name === branch)) setRemoteOids(new Set((await gitService.getRemoteHistory(remote.name, branch, 200)).map((item) => item.oid)))
        else setRemoteOids(null)
      } catch { setRemoteOids(null) }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory().catch(console.error)
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
      navigationTitle={t("historyTitle")}
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading} action={loadHistory} />,
      }}
    >
      <Section>
        <Text font="footnote" foregroundStyle="secondaryLabel">{t("historyHint")}</Text>
      </Section>
      {errorMessage ? (
        <Section>
          <VStack spacing={8} alignment="leading">
            <HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">{t("historyError")}</Text></HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
            <Button title={t("retry")} action={loadHistory} />
          </VStack>
        </Section>
      ) : null}
      {loading && history.length === 0 ? <Section><ProgressView /></Section> : null}
      {!loading && history.length === 0 && !errorMessage ? <Section><VStack spacing={8} alignment="center"><Text font="headline">{t("noHistory")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("noHistoryHint")}</Text></VStack></Section> : null}
      {history.length > 0 ? <Section header={<Text>{`${t("historyTitle")} · ${history.length}`}</Text>}>{history.map((commit) => <HistoryRow key={commit.oid} commit={commit} language={language} syncState={remoteOids === null ? "unknown" : remoteOids.has(commit.oid) ? "synced" : "local"} onSelect={() => { openCommitDetail(commit).catch(console.error) }} />)}</Section> : null}
    </List>
  )
}

export default SourceControlHistoryView
