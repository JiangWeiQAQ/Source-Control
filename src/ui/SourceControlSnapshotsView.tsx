import {
  Button,
  HStack,
  Image,
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
import { GitSafetySnapshotInfo } from "../core/types"
import { formatHistoryTime } from "./formatDate"

export interface SourceControlSnapshotsViewProps {
  gitService: GitService
  onRestored: () => Promise<void>
}

export function SourceControlSnapshotsView({
  gitService,
  onRestored,
}: SourceControlSnapshotsViewProps) {
  const dismiss = Navigation.useDismiss()
  const [snapshots, setSnapshots] = useState<GitSafetySnapshotInfo[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeOperation, setActiveOperation] = useState<"create" | `restore:${string}` | null>(null)

  const loadSnapshots = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      setSnapshots(await gitService.listSafetySnapshots(50))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSnapshots().catch(console.error)
  }, [])

  const createSnapshot = async () => {
    if (activeOperation !== null) return

    const reason = await Dialog.prompt({
      title: "Create Snapshot",
      message: "Reason",
      placeholder: "before refactor",
      cancelLabel: "Cancel",
      confirmLabel: "Create",
    })
    if (reason === null) return

    setActiveOperation("create")
    setErrorMessage(null)
    try {
      const result = await gitService.createSafetySnapshot(reason.trim())
      if (result.created) {
        await loadSnapshots()
        await Dialog.alert({ title: "Snapshot Created", message: result.shortOid || "" })
      } else {
        await Dialog.alert({ title: "No Changes", message: "Working tree is clean." })
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  const restoreSnapshot = async (snapshot: GitSafetySnapshotInfo) => {
    if (activeOperation !== null) return

    const selected = await Dialog.actionSheet({
      title: "Restore Snapshot?",
      message: "This will restore the snapshot into the current working tree.\n\nCurrent working tree must be clean.",
      actions: [{ label: "Restore", destructive: true }],
    })
    if (selected !== 0) return

    const operation = `restore:${snapshot.ref}` as const
    setActiveOperation(operation)
    setErrorMessage(null)
    try {
      const result = await gitService.restoreSafetySnapshot(snapshot.ref)
      await Dialog.alert({ title: "Snapshot Restored", message: `${result.changedFiles} files restored` })
      await onRestored()
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  return (
    <List
      navigationTitle="Safety Snapshots"
      toolbar={{
        topBarLeading: <Button title="Close" systemImage="xmark" buttonStyle="borderless" action={() => dismiss()} />,
        topBarTrailing: (
          <HStack spacing={12}>
            <Button
              title="Refresh"
              systemImage="arrow.clockwise"
              buttonStyle="borderless"
              disabled={loading || activeOperation !== null}
              action={loadSnapshots}
            />
            <Button
              title={activeOperation === "create" ? "Creating…" : "Create Snapshot"}
              systemImage="archivebox"
              buttonStyle="borderless"
              disabled={activeOperation !== null}
              action={createSnapshot}
            />
          </HStack>
        ),
      }}
    >
      {errorMessage ? (
        <Section>
          <VStack spacing={6} alignment="leading">
            <HStack spacing={6}>
              <Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" />
              <Text font="headline" foregroundStyle="red">Snapshot Operation Failed</Text>
            </HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      <Section>
        <Button
          title={activeOperation === "create" ? "Creating Snapshot…" : "Create Snapshot"}
          systemImage="archivebox"
          buttonStyle="borderedProminent"
          disabled={activeOperation !== null}
          action={createSnapshot}
        />
      </Section>

      {loading && snapshots.length === 0 ? (
        <Section>
          <VStack spacing={12} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ top: 24, bottom: 24 }}>
            <ProgressView />
            <Text font="subheadline" foregroundStyle="secondaryLabel">Loading safety snapshots…</Text>
          </VStack>
        </Section>
      ) : null}

      {!loading && snapshots.length === 0 && !errorMessage ? (
        <Section>
          <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ top: 24, bottom: 24 }}>
            <Image systemName="archivebox" font="largeTitle" foregroundStyle="tertiaryLabel" />
            <Text font="headline">No Safety Snapshots</Text>
          </VStack>
        </Section>
      ) : null}

      {snapshots.length > 0 ? (
        <Section header={<Text font="footnote">{`SNAPSHOTS · ${snapshots.length}`}</Text>}>
          {snapshots.map((snapshot) => {
            const isRestoring = activeOperation === `restore:${snapshot.ref}`
            return (
              <HStack key={snapshot.ref} spacing={12} alignment="center">
                <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="headline">{snapshot.reason || "Safety Snapshot"}</Text>
                  <HStack spacing={6}>
                    <Text font="caption" foregroundStyle="systemBlue" monospaced>{snapshot.shortOid}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">· {formatHistoryTime(snapshot.timestamp)}</Text>
                  </HStack>
                </VStack>
                <Spacer />
                {isRestoring ? <ProgressView /> : null}
                <Button
                  title={isRestoring ? "Restoring…" : "Restore"}
                  systemImage="arrow.counterclockwise"
                  buttonStyle="bordered"
                  role="destructive"
                  disabled={activeOperation !== null}
                  action={() => restoreSnapshot(snapshot)}
                />
              </HStack>
            )
          })}
        </Section>
      ) : null}
    </List>
  )
}

export default SourceControlSnapshotsView
