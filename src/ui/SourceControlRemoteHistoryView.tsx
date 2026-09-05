import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Text, useEffect, useState, VStack } from "scripting"
import { GitCommitInfo } from "../core/types"
import { GitService } from "../core/GitService"
import { CloseButton } from "./CloseButton"
import { AppLanguage, createTranslator } from "./localization"
import { HistoryRow } from "./HistoryRow"
import { SourceControlCommitDetailView } from "./SourceControlCommitDetailView"

export interface SourceControlRemoteHistoryViewProps { gitService: GitService; language?: AppLanguage }
type RemoteHistoryTarget = { remote: string; branch: string } | null

export function SourceControlRemoteHistoryView({ gitService, language = "en" }: SourceControlRemoteHistoryViewProps) {
  const dismiss = Navigation.useDismiss(); const t = createTranslator(language)
  const [target, setTarget] = useState<RemoteHistoryTarget>(null); const [history, setHistory] = useState<GitCommitInfo[]>([])
  const [loading, setLoading] = useState(true); const [fetching, setFetching] = useState(false); const [errorMessage, setErrorMessage] = useState<string | null>(null); const [needsFetch, setNeedsFetch] = useState(false)

  const resolveTarget = async (): Promise<RemoteHistoryTarget> => {
    const remotes = await gitService.listRemotes(); const remote = remotes.find((item) => item.name === "origin") || remotes[0]
    const branch = await gitService.getCurrentBranch()
    return remote && branch ? { remote: remote.name, branch } : null
  }

  const loadHistory = async () => {
    setLoading(true); setErrorMessage(null); setNeedsFetch(false)
    try {
      const nextTarget = await resolveTarget(); setTarget(nextTarget)
      if (!nextTarget) { setHistory([]); setNeedsFetch(true); return }
      setHistory(await gitService.getRemoteHistory(nextTarget.remote, nextTarget.branch, 50))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/REMOTE_BRANCH_NOT_FOUND|尚未获取远端分支/.test(message)) { setHistory([]); setNeedsFetch(true) } else setErrorMessage(message)
    } finally { setLoading(false) }
  }

  const fetchAndReload = async () => {
    const nextTarget = target || await resolveTarget()
    if (!nextTarget || fetching) { setNeedsFetch(true); return }
    setFetching(true); setErrorMessage(null)
    try { await gitService.fetchRemote(nextTarget.remote); await loadHistory() } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)) } finally { setFetching(false) }
  }

  useEffect(() => { loadHistory().catch(console.error) }, [])

  return <NavigationStack>
    <List navigationTitle={t("githubHistory")} toolbar={{ topBarLeading: <CloseButton />, topBarTrailing: <Button title={fetching ? t("fetching") : t("refresh")} systemImage="arrow.clockwise" disabled={loading || fetching} action={fetchAndReload} /> }}>
    <Section><VStack spacing={4} alignment="leading"><Text font="headline">{target ? `${target.remote} · ${target.branch}` : "GitHub"}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("githubHistoryHint")}</Text></VStack></Section>
    {loading && !history.length ? <Section><ProgressView /></Section> : null}
    {needsFetch ? <Section><VStack spacing={8} alignment="leading"><Text font="headline">{t("fetchGithubStatusRequired")}</Text><Button title={fetching ? t("fetching") : t("fetchStatus")} buttonStyle="borderedProminent" disabled={fetching} action={fetchAndReload} /></VStack></Section> : null}
    {errorMessage ? <Section><VStack spacing={8} alignment="leading"><HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">{t("remoteHistoryLoadFailed")}</Text></HStack><Text font="footnote" foregroundStyle="red">{errorMessage}</Text><Button title={t("retry")} action={loadHistory} /></VStack></Section> : null}
    {!loading && !needsFetch && !errorMessage && history.length === 0 ? <Section><VStack spacing={8} alignment="center"><Text font="headline">{t("noGithubHistory")}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{t("noGithubHistoryHint")}</Text></VStack></Section> : null}
    {history.length ? <Section header={<Text>{`${t("githubHistory")} · ${history.length}`}</Text>}>{history.map((commit) => <HistoryRow key={commit.oid} commit={commit} language={language} onSelect={() => { Navigation.present(<SourceControlCommitDetailView gitService={gitService} oid={commit.oid} shortOid={commit.shortOid} readOnly />).catch(console.error) }} />)}</Section> : null}
    </List>
  </NavigationStack>
}
export default SourceControlRemoteHistoryView
