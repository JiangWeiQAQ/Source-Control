import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { GitAheadBehind, GitRemoteBranch, GitRemoteInfo, GitRepositoryStatus } from "../core/types"
import { GitService } from "../core/GitService"

export interface SourceControlRemoteViewProps {
  gitService: GitService
  onChanged: () => Promise<void>
}

type ActiveOperation = "remote" | "credential" | "fetch" | "push" | "pull" | null

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

  const selectedRemote = remotes.find((remote) => remote.name === selectedRemoteName) ?? null
  const matchingRemoteBranch = localBranch
    ? branches.find((branch) => branch.name === localBranch) ?? null
    : null
  const isBusy = activeOperation !== null
  const canPush = Boolean(sync && sync.ahead > 0 && sync.behind === 0 && !sync.diverged)
  const canPull = Boolean(sync && sync.ahead === 0 && sync.behind > 0 && !sync.diverged && repositoryStatus?.isClean)

  const loadRemoteData = async (preferredRemoteName?: string | null) => {
    setLoading(true)
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
    try {
      await gitService.addRemote(name.trim(), url.trim())
      await loadRemoteData(name.trim())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const setCredential = async () => {
    if (!selectedRemote || isBusy) return
    const username = await Dialog.prompt({
      title: "Set Credential",
      message: "Username",
      placeholder: "Username",
      cancelLabel: "Cancel",
      confirmLabel: "Next",
    })
    if (username === null) return
    const password = await Dialog.prompt({
      title: "Set Credential",
      message: "Password / Token",
      placeholder: "Password / Token",
      obscureText: true,
      cancelLabel: "Cancel",
      confirmLabel: "Save",
    })
    if (password === null) return

    setActiveOperation("credential")
    setErrorMessage(null)
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
    const selected = await Dialog.actionSheet({
      title: "Remove stored credential?",
      message: "This removes the stored credential for this remote, not the remote itself.",
      actions: [{ label: "Remove", destructive: true }],
    })
    if (selected !== 0) return

    setActiveOperation("credential")
    setErrorMessage(null)
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
    try {
      await gitService.fetchRemote(selectedRemote.name)
      await loadRemoteData(selectedRemote.name)
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
    try {
      await gitService.pushRemote(selectedRemote.name, sync.remoteBranch)
      await loadRemoteData(selectedRemote.name)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const pullRemote = async () => {
    if (!selectedRemote || !sync || !canPull || isBusy) return
    const selected = await Dialog.actionSheet({
      title: `Pull from ${selectedRemote.name}/${sync.remoteBranch}?`,
      message: "This will fast-forward your local branch and update files in the working tree.",
      actions: [{ label: "Pull" }],
    })
    if (selected !== 0) return

    setActiveOperation("pull")
    setErrorMessage(null)
    try {
      await gitService.pullRemote(selectedRemote.name, sync.remoteBranch)
      await onChanged()
      await loadRemoteData(selectedRemote.name)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  return (
    <List
      navigationTitle="Remote"
      toolbar={{
        topBarTrailing: (
          <Button
            title="Refresh"
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
            <HStack spacing={6}><Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" /><Text font="headline" foregroundStyle="red">Sync Operation Failed</Text></HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      {loading ? <Section><ProgressView /></Section> : null}

      {!loading && remotes.length === 0 ? (
        <Section>
          <VStack spacing={8} alignment="leading">
            <Text font="headline">No Remote</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">This repository is not connected to a remote repository.</Text>
            <Button title="Add Remote" systemImage="plus" buttonStyle="borderedProminent" disabled={isBusy} action={addRemote} />
          </VStack>
        </Section>
      ) : null}

      {!loading && selectedRemote ? (
        <>
          <Section header={<Text>REMOTE</Text>}>
            <VStack spacing={6} alignment="leading">
              <Text font="headline">Local Branch</Text>
              <Text font="body" foregroundStyle="secondaryLabel">{localBranch ?? "Detached HEAD"}</Text>
              <Text font="headline">Remote</Text>
              <Text font="body">{selectedRemote.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{sanitizeRemoteUrl(selectedRemote.url)}</Text>
            </VStack>
          </Section>

          {remotes.length > 1 ? (
            <Section header={<Text>REMOTES</Text>}>
              {remotes.map((remote) => (
                <Button key={remote.name} title={remote.name} disabled={isBusy || remote.name === selectedRemote.name} action={() => chooseRemote(remote.name)} />
              ))}
            </Section>
          ) : null}

          <Section header={<Text>SYNC STATUS</Text>}>
            <VStack spacing={6} alignment="leading">
              <Text font="headline" foregroundStyle={sync?.diverged ? "orange" : undefined}>{syncStatusText(sync)}</Text>
              {sync ? <Text font="footnote" foregroundStyle="secondaryLabel">{sync.ahead} ahead · {sync.behind} behind</Text> : <Text font="footnote" foregroundStyle="secondaryLabel">Fetch this remote to load a matching remote branch.</Text>}
              {sync?.diverged ? <Text font="footnote" foregroundStyle="secondaryLabel">Automatic merge is not supported yet.</Text> : null}
            </VStack>
          </Section>

          <Section header={<Text>REMOTE BRANCH</Text>}>
            {matchingRemoteBranch ? <Text font="body">{selectedRemote.name}/{matchingRemoteBranch.name}</Text> : <Text font="body" foregroundStyle="secondaryLabel">Remote Branch Unavailable</Text>}
          </Section>

          {isHttpsRemote(selectedRemote.url) ? (
            <Section header={<Text>AUTHENTICATION</Text>}>
              <VStack spacing={7} alignment="leading">
                <Text font="body">{hasCredential ? "Configured" : "Not Configured"}</Text>
                <HStack spacing={10}>
                  <Button title="Set Credential" disabled={isBusy} action={setCredential} />
                  {hasCredential ? <Button title="Remove Credential" role="destructive" disabled={isBusy} action={removeCredential} /> : null}
                </HStack>
              </VStack>
            </Section>
          ) : null}

          <Section header={<Text>ACTIONS</Text>} footer={!repositoryStatus?.isClean && sync && sync.behind > 0 ? <Text>Commit or discard local changes before pulling.</Text> : undefined}>
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
