import {
  Button,
  HStack,
  Image,
  List,
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

interface ScriptingProject {
  name: string
  path: string
}

function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

const AUTOMATED_TEST_PROJECT_PREFIXES = [
  "Source Control Snapshot Test-",
  "Source Control Restore Snapshot Test-",
  "Source Control Empty Repository Test-",
  "Source Control Empty Repository Repro-",
  "Source Control Revert Core Test-",
  "Source Control List Snapshots Test-",
  "Source Control Snapshot Smoke-",
]
const HIDDEN_PROJECT_NAMES = new Set(["Source Control Stage Test"])

function isVisibleProject(name: string): boolean {
  return !HIDDEN_PROJECT_NAMES.has(name) && !AUTOMATED_TEST_PROJECT_PREFIXES.some((prefix) => name.startsWith(prefix))
}

export function SourceControlProjectPickerView() {
  const [projects, setProjects] = useState<ScriptingProject[]>([])
  const [loading, setLoading] = useState(true)
  const [openingProjectPath, setOpeningProjectPath] = useState<string | null>(null)
  const [openingProjectName, setOpeningProjectName] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const entries = await FileManager.readDirectory(FileManager.scriptsDirectory)
      const directories = await Promise.all(entries.map(async (entry) => {
        const path = Path.join(FileManager.scriptsDirectory, entry)
        return {
          name: projectName(entry),
          path,
          isDirectory: await FileManager.isDirectory(path),
        }
      }))
      setProjects(directories
        .filter((item) => item.isDirectory && !item.name.startsWith(".") && isVisibleProject(item.name))
        .map(({ name, path }) => ({ name, path }))
        .sort((left, right) => left.name.localeCompare(right.name)))
    } catch (error) {
      console.error("Unable to load projects:", error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const presentChanges = async (project: ScriptingProject, service: GitService) => {
    await Navigation.present(
      <SourceControlChangesView
        gitService={service}
        projectPath={project.path}
      />
    )
  }

  const initializeProject = async (project: ScriptingProject, service: GitService) => {
    const selected = await Dialog.actionSheet({
      title: "Initialize Repository?",
      message: `“${project.name}” is not currently managed by Source Control.`,
      actions: [{ label: "Initialize" }],
    })
    if (selected !== 0) return false

    await service.initRepository(project.path)
    await service.openRepository(project.path)
    return true
  }

  const handleOpenProject = async (project: ScriptingProject) => {
    if (openingProjectPath !== null) return

    setOpeningProjectPath(project.path)
    setOpeningProjectName(project.name)
    setErrorMessage(null)

    try {
      const service = new GitService()
      const initialized = await service.isRepositoryInitialized(project.path)

      if (!initialized) {
        const didInitialize = await initializeProject(project, service)
        if (!didInitialize) return
      } else {
        await service.openRepository(project.path)
      }

      await presentChanges(project, service)
    } catch (error) {
      console.error(`[SourceControl] open failed: ${project.name}`, error)
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(`Unable to open “${project.name}”.\n${message}`)
    } finally {
      setOpeningProjectPath(null)
    }
  }

  useEffect(() => {
    loadProjects().catch(console.error)
  }, [])

  return (
    <List
      navigationTitle="Source Control"
      toolbar={{
        topBarTrailing: (
          <Button
            title="Refresh"
            systemImage="arrow.clockwise"
            buttonStyle="borderless"
            disabled={loading || openingProjectPath !== null}
            action={loadProjects}
          />
        ),
      }}
    >
      {errorMessage ? (
        <Section>
          <VStack spacing={8} alignment="leading">
            <HStack spacing={6}>
              <Image systemName="exclamationmark.triangle.fill" foregroundStyle="red" />
              <Text font="headline" foregroundStyle="red">
              {openingProjectName ? `Unable to open “${openingProjectName}”` : "Unable to Open Project"}
            </Text>
            </HStack>
            <Text font="footnote" foregroundStyle="secondaryLabel">{errorMessage}</Text>
            <Button title="Retry" action={loadProjects} />
          </VStack>
        </Section>
      ) : null}

      {loading && projects.length === 0 ? (
        <Section>
          <VStack spacing={12} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ top: 24, bottom: 24 }}>
            <ProgressView />
            <Text font="subheadline" foregroundStyle="secondaryLabel">Loading Scripting projects…</Text>
          </VStack>
        </Section>
      ) : null}

      {!loading && projects.length === 0 && !errorMessage ? (
        <Section>
          <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ top: 24, bottom: 24 }}>
            <Image systemName="folder" font="largeTitle" foregroundStyle="tertiaryLabel" />
            <Text font="headline">No Scripting Projects</Text>
          </VStack>
        </Section>
      ) : null}

      {projects.length > 0 ? (
        <Section header={<Text font="footnote">PROJECTS</Text>}>
          {projects.map((project) => {
            const isOpening = openingProjectPath === project.path
            return (
              <Button
                key={project.path}
                disabled={openingProjectPath !== null}
                action={() => {
                  handleOpenProject(project).catch(console.error)
                }}
              >
                <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Image systemName={project.name === "Source Control" ? "folder.badge.gearshape" : "folder"} foregroundStyle="systemBlue" />
                  <VStack spacing={2} alignment="leading">
                    <Text font="body">{project.name}</Text>
                    {project.name === "Source Control" ? (
                      <Text font="caption" foregroundStyle="secondaryLabel">Current Tool</Text>
                    ) : null}
                  </VStack>
                  <Spacer />
                  {isOpening ? <ProgressView /> : <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />}
                </HStack>
              </Button>
            )
          })}
        </Section>
      ) : null}
    </List>
  )
}

export default SourceControlProjectPickerView
