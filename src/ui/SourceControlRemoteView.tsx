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
import { GitAheadBehind, GitRemoteBranch, GitRemoteInfo, GitRepositoryStatus } from "../core/types"
import { GitService } from "../core/GitService"
import { useTranslator } from "./useLocalization"

export interface SourceControlRemoteViewProps {
  gitService: GitService
  onChanged: () => Promise<void>
}

type ActiveOperation = "remote" | "credential" | "fetch" | "push" | "pull" | null

type OperationError = "Fetch Failed" | "Push Failed" | "Pull Failed" | "Remote Update Failed" | "Credential Update Failed"

function isHttpsRemote(url: string): boolean {
  return /^https:\/\//i.test(url)
}

function sanitizeRemoteUrl(url: string): string {
  return url.replace(/^(https?:\/\/)([^/@]+@)/i, "$1••••@")
}

function syncStatusText(sync: GitAheadBehind | null): string {
  if (!sync) return "Remote Branch Unavailable"
  if (sync.diverged) return "Branches Diverged"
  if (sync.ahead === 0 && sync.behind === 0) return "Up to Date"
  if (sync.ahead > 0 && sync.behind === 0) return `${sync.ahead} Commits to Push`
  if (sync.ahead === 0 && sync.behind > 0) return `${sync.behind} Commits to Pull`
  return "Branches Diverged"
}

export function SourceControlRemoteView({ gitService, onChanged }: SourceControlRemoteViewProps) {
  const { t } = useTranslator()
  const dismiss = Navigation.useDismiss()
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([])
  const [selectedRemoteName, setSelectedRemoteName] = useState<string | null>(null)
  const [branches, setBranches] = useState<GitRemoteBranch[]>([])
  const [localBranch, setLocalBranch] = useState<string | null>(null)
  const [repositoryStatus, setRepositoryStatus] = useState<GitRepositoryStatus | null>(null)
  const [sync, setSync] = useState<GitAheadBehind | null>(null)
  const [hasCredential, setHasCredential] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorTitle, setErrorTitle] = useState<OperationError>("Remote Update Failed")

  const selectedRemote = remotes.find((remote) => remote.name === selectedRemoteName) ?? null
  const matchingRemoteBranch = localBranch
    ? branches.find((branch) => branch.name === localBranch) ?? null
    : null
  const isBusy = activeOperation !== null
  const canPush = Boolean(sync && sync.ahead > 0 && sync.behind === 0 && !sync.diverged)
  const canPull = Boolean(sync && sync.ahead === 0 && sync.behind > 0 && !sync.diverged && repositoryStatus?.isClean)

  const loadRemoteData = async (preferredRemoteName?: string | null) => {
    setLoading(true)
    setErrorMessage(null)
    setErrorTitle("Remote Update Failed")
    try {
      const [nextRemotes, nextLocalBranch, nextStatus] = await Promise.all([
        gitService.listRemotes(),
        gitService.getCurrentBranch(),
        gitService.getStatus(),
      ])
      setRemotes(nextRemotes)
      setLocalBranch(nextLocalBranch)
      setRepositoryStatus(nextStatus)

      const nextSelectedName = preferredRemoteName && nextRemotes.some((remote) => remote.name === preferredRemoteName)
        ? preferredRemoteName
        : nextRemotes.find((remote) => remote.name === "origin")?.name ?? nextRemotes[0]?.name ?? null
      setSelectedRemoteName(nextSelectedName)

      if (!nextSelectedName) {
        setBranches([])
        setSync(null)
        setHasCredential(false)
        return
      }

      const nextRemote = nextRemotes.find((remote) => remote.name === nextSelectedName)
      const [nextBranches, credentialExists] = await Promise.all([
        gitService.listRemoteBranches(nextSelectedName),
        nextRemote && isHttpsRemote(nextRemote.url) ? gitService.hasRemoteCredential(nextSelectedName) : Promise.resolve(false),
      ])
      setBranches(nextBranches)
      setHasCredential(credentialExists)

      if (nextLocalBranch && nextBranches.some((branch) => branch.name === nextLocalBranch)) {
        setSync(await gitService.getAheadBehind(nextSelectedName, nextLocalBranch))
      } else {
        setSync(null)
      }
    } catch (error) {
      setErrorTitle("Remote Update Failed")
      setErrorTitle("Remote Update Failed")
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRemoteData().catch(console.error)
  }, [])

  const chooseRemote = async (name: string) => {
    if (isBusy || name === selectedRemoteName) return
    setErrorMessage(null)
    await loadRemoteData(name)
  }

  const addRemote = async () => {
    if (isBusy) return
    const name = await Dialog.prompt({
      title: "Add Remote",
      message: "Remote Name",
      defaultValue: "origin",
      placeholder: "origin",
      cancelLabel: "Cancel",
      confirmLabel: "Next",
    })
    if (name === null) return

    const url = await Dialog.prompt({
      title: "Add Remote",
      message: "Remote URL",
      placeholder: "https://example.com/owner/repository.git",
      cancelLabel: "Cancel",
      confirmLabel: "Add",
    })
    if (url === null) return

    setActiveOperation("remote")
    setErrorMessage(null)
    setErrorTitle("Remote Update Failed")
    try {
      await gitService.addRemote(name.trim(), url.trim())
      await loadRemoteData(name.trim())
    } catch (error) {
      setErrorTitle("Remote Update Failed")
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const setCredential = async () => {
    if (!selectedRemote || isBusy) return
    const username = await Dialog.prompt({ title: "Set Credential", message: "Username", placeholder: "Username", cancelLabel: "Cancel", confirmLabel: "Next" })
    if (username === null) return
    const password = await Dialog.prompt({ title: "Set Credential", message: "Password / Token", placeholder: "Password / Token", obscureText: true, cancelLabel: "Cancel", confirmLabel: "Save" })
    if (password === null) return
    setActiveOperation("credential")
    setErrorMessage(null)
    setErrorTitle("Credential Update Failed")
    try {
      await gitService.setRemoteCredential(selectedRemote.name, { username, password })
      setHasCredential(await gitService.hasRemoteCredential(selectedRemote.name))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const removeCredential = async () => {
    if (!selectedRemote || isBusy) return
    const selected = await Dialog.actionSheet({ title: "Remove Stored Credential?", message: "This removes the saved credential from Keychain.\nThe remote configuration will remain unchanged.", actions: [{ label: "Remove", destructive: true }] })
    if (selected !== 0) return
    setActiveOperation("credential")
    setErrorMessage(null)
    setErrorTitle("Credential Update Failed")
    try {
      await gitService.removeRemoteCredential(selectedRemote.name)
      setHasCredential(await gitService.hasRemoteCredential(selectedRemote.name))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const fetchRemote = async () => {
    if (!selectedRemote || isBusy) return
    setActiveOperation("fetch")
    setErrorMessage(null)
    setErrorTitle("Fetch Failed")
    try {
      const result = await gitService.fetchRemote(selectedRemote.name)
      await loadRemoteData(selectedRemote.name)
      await Dialog.alert({ title: "Fetch Completed", message: result.branch ? `${selectedRemote.name}/${result.branch}` : "Fetch completed." })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const pushRemote = async () => {
    if (!selectedRemote || !sync || !canPush || isBusy) return
    setActiveOperation("push")
    setErrorMessage(null)
    setErrorTitle("Push Failed")
    try {
      const result = await gitService.pushRemote(selectedRemote.name, sync.remoteBranch)
      await loadRemoteData(selectedRemote.name)
      const refreshedSync = await gitService.getAheadBehind(selectedRemote.name, sync.remoteBranch)
      if (result.pushed && refreshedSync.ahead === 0 && refreshedSync.behind === 0) await Dialog.alert({ title: "Push Completed", message: "Up to Date" })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const pullRemote = async () => {
    if (!selectedRemote || !sync || !canPull || isBusy) return
    const selected = await Dialog.actionSheet({ title: `Pull from ${selectedRemote.name}/${sync.remoteBranch}?`, message: "This will fast-forward your local branch and update files in the working tree.", actions: [{ label: "Pull" }] })
    if (selected !== 0) return
    setActiveOperation("pull")
    setErrorMessage(null)
    setErrorTitle("Pull Failed")
    try {
      const result = await gitService.pullRemote(selectedRemote.name, sync.remoteBranch)
      await onChanged()
      await loadRemoteData(selectedRemote.name)
      if (result.pulled) await Dialog.alert({ title: "Pull Completed", message: "Working tree updated." })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      if (message.includes("Pull failed and rollback was incomplete") || message.includes("Repository requires manual inspection")) await Dialog.alert({ title: "Repository Requires Inspection", message })
    } finally {
      setActiveOperation(null)
    }
  }

  return (
    <List
      navigationTitle="Remote"
      toolbar={{
        topBarLeading: <Button title="Close" systemImage="xmark" buttonStyle="borderless" action={() => dismiss()} />,
        topBarTrailing: (
          <Button
            title={t("refresh")}
            systemImage="arrow.clockwise"
            buttonStyle="borderless"
            disabled={loading || isBusy}
            action={() => loadRemoteData(selectedRemoteName)}
          />
        ),
      }}
    >
      {errorMessage ? (
        <Section>
          <VStack spacing={5} alignment="leading">
            <HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">{errorTitle}</Text></HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      {loading ? <Section><ProgressView /></Section> : null}

      {!loading && remotes.length === 0 ? (
        <Section>
          <VStack spacing={8} alignment="leading">
            <Text font="headline">{t("noRemote")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{t("noRemoteHint")}</Text>
            <Button title={t("addRemote")} systemImage="plus" buttonStyle="borderedProminent" disabled={isBusy} action={addRemote} />
          </VStack>
        </Section>
      ) : null}

      {!loading && selectedRemote ? (
        <>
          <Section header={<Text>{t("remote")}</Text>}>
            <VStack spacing={6} alignment="leading">
              <Text font="headline">Local Branch</Text>
              <Text font="body" foregroundStyle="secondaryLabel">{localBranch ?? "Detached HEAD"}</Text>
              <Text font="headline">Remote</Text>
              <Text font="body">{selectedRemote.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{sanitizeRemoteUrl(selectedRemote.url)}</Text>
            </VStack>
          </Section>

          {remotes.length > 1 ? (
            <Section header={<Text>{t("remotes")}</Text>}>
              {remotes.map((remote) => (
                <Button key={remote.name} title={remote.name} disabled={isBusy || remote.name === selectedRemote.name} action={() => chooseRemote(remote.name)} />
              ))}
            </Section>
          ) : null}

          <Section header={<Text>{t("syncStatus")}</Text>}>
            <VStack spacing={6} alignment="leading">
              <Text font="headline" foregroundStyle={sync?.diverged ? "orange" : undefined}>{syncStatusText(sync)}</Text>
              {sync ? <Text font="footnote" foregroundStyle="secondaryLabel">Local {sync.ahead} · Remote {sync.behind}</Text> : <Text font="footnote" foregroundStyle="secondaryLabel">Fetch this remote to load a matching remote branch.</Text>}
              {sync?.diverged ? <Text font="footnote" foregroundStyle="secondaryLabel">Automatic merge is not supported yet.</Text> : null}
            </VStack>
          </Section>

          <Section header={<Text>{t("remoteBranch")}</Text>}>
            {matchingRemoteBranch ? <Text font="body">{selectedRemote.name}/{matchingRemoteBranch.name}</Text> : <Text font="body" foregroundStyle="secondaryLabel">Remote Branch Unavailable</Text>}
          </Section>

          {isHttpsRemote(selectedRemote.url) ? (
            <Section header={<Text>{t("authentication")}</Text>}>
              <VStack spacing={7} alignment="leading">
                <Text font="body">{hasCredential ? "Configured" : "Not Configured"}</Text>
                <HStack spacing={10}>
                  <Button title="Set Credential" disabled={isBusy} action={setCredential} />
                  {hasCredential ? <Button title="Remove Credential" role="destructive" disabled={isBusy} action={removeCredential} /> : null}
                </HStack>
              </VStack>
            </Section>
          ) : null}

          <Section header={<Text>{t("actions")}</Text>} footer={!repositoryStatus?.isClean && sync && sync.behind > 0 ? <Text>Commit or discard local changes before pulling.</Text> : undefined}>
            <HStack spacing={10}>
              <Button title={activeOperation === "fetch" ? "Fetching…" : "Fetch"} disabled={isBusy} action={fetchRemote} />
              <Button title={activeOperation === "push" ? "Pushing…" : "Push"} disabled={isBusy || !canPush} action={pushRemote} />
              <Button title={activeOperation === "pull" ? "Pulling…" : "Pull"} disabled={isBusy || !canPull} action={pullRemote} />
            </HStack>
          </Section>
        </>
      ) : null}
    </List>
  )
}

export default SourceControlRemoteView
