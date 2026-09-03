import {
  Button,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  Path,
  ProgressView,
  Section,
  Spacer,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { GitService } from "../core/GitService"
import { SourceControlChangesView } from "./SourceControlChangesView"
import { SourceControlSettingsView } from "./SourceControlSettingsView"
import { CloseButton } from "./CloseButton"
import { useTranslator } from "./useLocalization"

interface ManagedProject {
  name: string
  path: string
}

const PREFERENCE_PATH = `${FileManager.documentsDirectory}/Source Control/managed-projects.json`
const AUTOMATED_TEST_PROJECT_PREFIXES = [
  "Source Control Snapshot Test-",
  "Source Control Restore Snapshot Test-",
  "Source Control Empty Repository Test-",
  "Source Control Empty Repository Repro-",
  "Source Control Revert Core Test-",
  "Source Control List Snapshots Test-",
  "Source Control Snapshot Smoke-",
  "Source Control Remote Core Test-",
  "Source Control Fetch Core Test-",
  "Source Control Pull Core Test-",
  "Source Control Push Core Test-",
]

function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

function isCandidateProject(name: string): boolean {
  return !name.startsWith(".") && !AUTOMATED_TEST_PROJECT_PREFIXES.some((prefix) => name.startsWith(prefix))
}

async function readManagedProjects(): Promise<ManagedProject[]> {
  try {
    if (!await FileManager.exists(PREFERENCE_PATH)) return []
    const raw = await FileManager.readAsString(PREFERENCE_PATH, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ManagedProject => {
      if (!item || typeof item !== "object") return false
      const candidate = item as { name?: unknown; path?: unknown }
      return typeof candidate.name === "string" && typeof candidate.path === "string"
    })
  } catch (error) {
    console.error("[SourceControl] failed to read managed projects", error)
    return []
  }
}

async function writeManagedProjects(projects: ManagedProject[]): Promise<void> {
  const directory = `${FileManager.documentsDirectory}/Source Control`
  await FileManager.createDirectory(directory, true)
  await FileManager.writeAsString(PREFERENCE_PATH, JSON.stringify(projects), "utf8")
}

function ProjectRow({
  project,
  openingPath,
  onOpen,
  onRemove,
  removeTitle,
}: {
  project: ManagedProject
  openingPath: string | null
  onOpen: (project: ManagedProject) => void
  onRemove: (project: ManagedProject) => void
  removeTitle: string
}) {
  const [exists, setExists] = useState<boolean | null>(null)

  useEffect(() => {
    FileManager.exists(project.path).then(setExists).catch(() => setExists(false))
  }, [project.path])

  const isOpening = openingPath === project.path
  return (
    <HStack spacing={10} alignment="center">
      <Button
        action={() => onOpen(project)}
        disabled={openingPath !== null}
      >
        <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Image systemName="folder" foregroundStyle="systemBlue" />
          <VStack spacing={2} alignment="leading">
            <Text font="body">{project.name}</Text>
            {exists === false ? <Text font="caption" foregroundStyle="red">Project Not Found</Text> : null}
          </VStack>
          <Spacer />
          {isOpening ? <ProgressView /> : <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />}
        </HStack>
      </Button>
      <Menu title="More" systemImage="ellipsis.circle">
        <Button title={removeTitle} role="destructive" disabled={openingPath !== null} action={() => onRemove(project)} />
      </Menu>
    </HStack>
  )
}

function AddProjectView({
  managedProjects,
  onAdded,
}: {
  managedProjects: ManagedProject[]
  onAdded: (project: ManagedProject) => Promise<void>
}) {
  const dismiss = Navigation.useDismiss()
  const [projects, setProjects] = useState<ManagedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const entries = await FileManager.readDirectory(FileManager.scriptsDirectory)
        const candidates = await Promise.all(entries.map(async (entry) => {
          const path = Path.join(FileManager.scriptsDirectory, entry)
          return { name: projectName(entry), path, isDirectory: await FileManager.isDirectory(path) }
        }))
        setProjects(candidates
          .filter((item) => item.isDirectory && isCandidateProject(item.name))
          .map(({ name, path }) => ({ name, path })))
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setLoading(false)
      }
    }
    load().catch(console.error)
  }, [])

  const addProject = async (project: ManagedProject) => {
    if (managedProjects.some((item) => item.path === project.path)) return
    const confirmed = await Dialog.confirm({
      title: `Add "${project.name}" to Source Control?`,
      message: "The project will be added to your managed projects list.",
      cancelLabel: "Cancel",
      confirmLabel: "Add",
    })
    if (confirmed) {
      await onAdded(project)
      dismiss()
    }
  }

  return (
    <List
      navigationTitle="Add Project"
      toolbar={{
        topBarLeading: <CloseButton />,
      }}
    >
      {errorMessage ? <Section><Text foregroundStyle="red">{errorMessage}</Text></Section> : null}
      {loading ? <Section><ProgressView /></Section> : null}
      {!loading ? (
        <Section>
          {projects.map((project) => {
            const added = managedProjects.some((item) => item.path === project.path)
            return (
              <Button key={project.path} title={added ? `${project.name} · Added` : project.name} disabled={added} action={() => addProject(project)} />
            )
          })}
        </Section>
      ) : null}
    </List>
  )
}

export function SourceControlProjectPickerView() {
  const { t, refreshLanguage } = useTranslator()
  const [projects, setProjects] = useState<ManagedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      setProjects(await readManagedProjects())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects().catch(console.error)
  }, [])

  const addProject = async (project: ManagedProject) => {
    const next = [...projects, project]
    await writeManagedProjects(next)
    setProjects(next)
  }

  const removeProject = async (project: ManagedProject) => {
    const confirmed = await Dialog.confirm({
      title: `Remove "${project.name}" from Source Control?`,
      message: "This will only remove it from this list. The project and Git repository will not be deleted.",
      cancelLabel: "Cancel",
      confirmLabel: "Remove",
    })
    if (!confirmed) return
    const next = projects.filter((item) => item.path !== project.path)
    await writeManagedProjects(next)
    setProjects(next)
  }

  const openProject = async (project: ManagedProject) => {
    if (openingPath !== null) return
    setOpeningPath(project.path)
    setErrorMessage(null)
    try {
      if (!await FileManager.exists(project.path)) {
        setErrorMessage(`Project Not Found: ${project.name}`)
        return
      }
      const service = new GitService()
      if (!await service.isRepositoryInitialized(project.path)) {
        const selected = await Dialog.actionSheet({
          title: "Initialize Repository?",
          message: `“${project.name}” is not currently managed by Source Control.`,
          actions: [{ label: "Initialize" }],
        })
        if (selected !== 0) return
        await service.initRepository(project.path)
      }
      await service.openRepository(project.path)
      await Navigation.present(<SourceControlChangesView gitService={service} projectPath={project.path} />)
    } catch (error) {
      console.error(`[SourceControl] open failed: ${project.name}`, error)
      setErrorMessage(`Unable to open “${project.name}”.\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOpeningPath(null)
    }
  }

  return (
    <List
      navigationTitle={t("sourceControl")}
      navigationSubtitle={t("beta")}
      toolbar={{
        topBarLeading: <CloseButton />,
        topBarTrailing: (
          <HStack spacing={8}>
            <Button title={t("settings")} systemImage="gearshape" buttonStyle="borderless" action={async () => {
              await Navigation.present(<SourceControlSettingsView onLanguageChanged={refreshLanguage} />)
            }} />
            <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || openingPath !== null} action={loadProjects} />
          </HStack>
        ),
      }}
    >
      {errorMessage ? <Section><Text foregroundStyle="red">{errorMessage}</Text></Section> : null}
      {loading ? <Section><ProgressView /></Section> : null}
      {!loading && projects.length === 0 ? (
        <Section>
          <VStack spacing={8} alignment="center">
            <Image systemName="folder" font="largeTitle" foregroundStyle="tertiaryLabel" />
            <Text font="headline">{t("noProjects")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">{t("addProjectHint")}</Text>
            <Button title={t("addProject")} systemImage="plus" buttonStyle="borderedProminent" action={async () => {
              await Navigation.present(<AddProjectView managedProjects={projects} onAdded={addProject} />)
              await loadProjects()
            }} />
          </VStack>
        </Section>
      ) : null}
      {!loading && projects.length > 0 ? (
        <Section header={<Text>{t("myProjects")}</Text>}>
          {projects.map((project) => (
            <ProjectRow key={project.path} project={project} openingPath={openingPath} onOpen={openProject} onRemove={removeProject} removeTitle={t("remove")} />
          ))}
          <Button title={t("addProject")} systemImage="plus" action={async () => {
            await Navigation.present(<AddProjectView managedProjects={projects} onAdded={addProject} />)
            await loadProjects()
          }} />
        </Section>
      ) : null}
    </List>
  )
}

export default SourceControlProjectPickerView
