import {
  Button,
  HStack,
  Image,
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
import { GitSafetySnapshotInfo } from "../core/types"
import { CloseButton } from "./CloseButton"
import { formatHistoryTime } from "./formatDate"
import { useTranslator } from "./useLocalization"

export interface SourceControlSnapshotsViewProps {
  gitService: GitService
  onRestored: () => Promise<void>
}

export function SourceControlSnapshotsView({
  gitService,
  onRestored,
}: SourceControlSnapshotsViewProps) {
  const { t } = useTranslator()
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
      title: t("createSnapshot"),
      message: t("snapshotReason"),
      placeholder: t("snapshotReasonPlaceholder"),
      cancelLabel: t("cancel"),
      confirmLabel: t("create"),
    })
    if (reason === null) return

    setActiveOperation("create")
    setErrorMessage(null)
    try {
      const result = await gitService.createSafetySnapshot(reason.trim())
      if (result.created) {
        await loadSnapshots()
        await Dialog.alert({ title: t("snapshotCreated"), message: result.shortOid || "" })
      } else {
        await Dialog.alert({ title: t("noChangesTitle"), message: t("workingTreeIsClean") })
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
      title: t("restoreSnapshotQuestion"),
      message: t("restoreSnapshotMessage"),
      actions: [{ label: t("restore"), destructive: true }],
    })
    if (selected !== 0) return

    const operation = `restore:${snapshot.ref}` as const
    setActiveOperation(operation)
    setErrorMessage(null)
    try {
      const result = await gitService.restoreSafetySnapshot(snapshot.ref)
      await Dialog.alert({ title: t("snapshotRestored"), message: t("filesRestored").replace("{count}", String(result.changedFiles)) })
      await onRestored()
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveOperation(null)
    }
  }

  return (
    <NavigationStack>
      <List
      navigationTitle={t("safetySnapshots")}
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: (
          <HStack spacing={12}>
            <Button
              title={t("refresh")}
              systemImage="arrow.clockwise"
              buttonStyle="borderless"
              disabled={loading || activeOperation !== null}
              action={loadSnapshots}
            />
            <Button
              title={activeOperation === "create" ? t("creating") : t("createSnapshot")}
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
              <Text font="headline" foregroundStyle="red">{t("snapshotOperationFailed")}</Text>
            </HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
          </VStack>
        </Section>
      ) : null}

      <Section>
        <Button
          title={activeOperation === "create" ? t("creatingSnapshot") : t("createSnapshot")}
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
            <Text font="subheadline" foregroundStyle="secondaryLabel">{t("loadingSafetySnapshots")}</Text>
          </VStack>
        </Section>
      ) : null}

      {!loading && snapshots.length === 0 && !errorMessage ? (
        <Section>
          <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ top: 24, bottom: 24 }}>
            <Image systemName="archivebox" font="largeTitle" foregroundStyle="tertiaryLabel" />
            <Text font="headline">{t("noSafetySnapshots")}</Text>
          </VStack>
        </Section>
      ) : null}

      {snapshots.length > 0 ? (
        <Section header={<Text font="footnote">{t("snapshotsHeader").replace("{count}", String(snapshots.length))}</Text>}>
          {snapshots.map((snapshot) => {
            const isRestoring = activeOperation === `restore:${snapshot.ref}`
            return (
              <HStack key={snapshot.ref} spacing={12} alignment="center">
                <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="headline">{snapshot.reason || t("safetySnapshot")}</Text>
                  <HStack spacing={6}>
                    <Text font="caption" foregroundStyle="systemBlue" monospaced>{snapshot.shortOid}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">· {formatHistoryTime(snapshot.timestamp)}</Text>
                  </HStack>
                </VStack>
                <Spacer />
                {isRestoring ? <ProgressView /> : null}
                <Button
                  title={isRestoring ? t("restoring") : t("restore")}
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
    </NavigationStack>
  )
}

export default SourceControlSnapshotsView
