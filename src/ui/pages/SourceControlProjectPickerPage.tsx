import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { GitService } from "../../core/GitService"
import { ProjectMetadata, ProjectMetadataManager, hasSourceControlConfiguration, selectProjectFolder } from "../../core/ProjectMetadata"
import { SourceControlChangesView } from "../SourceControlChangesView"
import { SourceControlSettingsView } from "../SourceControlSettingsView"
import { CloseButton } from "../CloseButton"
import { EmptyStateSection } from "../components/EmptyStateSection"
import { ErrorSection } from "../components/ErrorSection"
import { LoadingSection } from "../components/LoadingSection"
import { ProjectRow } from "../components/ProjectRow"
import { AddProjectFolderView } from "./AddProjectFolderView"
import { RelinkProjectView } from "./RelinkProjectView"
import { useTranslator } from "../useLocalization"

const PREFERENCE_PATH = `${FileManager.documentsDirectory}/Source Control/managed-projects.json`

async function syncManagedProjectsFile(projects: ProjectMetadata[]): Promise<void> {
  try {
    const directory = `${FileManager.documentsDirectory}/Source Control`
    await FileManager.createDirectory(directory, true)
    const list = projects.map((project) => ({ projectId: project.projectId, name: project.displayName, path: project.projectPath }))
    await FileManager.writeAsString(PREFERENCE_PATH, JSON.stringify(list, null, 2), "utf8")
  } catch (error) {
    console.error("[SourceControl] failed to sync managed-projects.json", error)
  }
}

export function SourceControlProjectPickerPage() {
  const { t, refreshLanguage } = useTranslator()
  const [projects, setProjects] = useState<ProjectMetadata[]>([])
  const [missingMap, setMissingMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const list = Object.values(await ProjectMetadataManager.loadProjects()).filter((project) => project.source === "manual")
      const missing: Record<string, boolean> = {}
      for (const project of list) missing[project.projectId] = !(await FileManager.exists(project.projectPath))
      const deduplicated: ProjectMetadata[] = []
      const seenIds = new Set<string>()
      const seenPaths = new Set<string>()
      for (const project of list) {
        if (seenIds.has(project.projectId) || seenPaths.has(project.projectPath)) continue
        seenIds.add(project.projectId)
        seenPaths.add(project.projectPath)
        deduplicated.push(project)
      }
      setProjects(deduplicated)
      setMissingMap(missing)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects().catch(console.error)
  }, [])

  const addProject = async (name: string, path: string) => {
    const meta = await selectProjectFolder(path, name)
    const next = [...projects.filter((project) => project.projectId !== meta.projectId && project.projectPath !== path), meta]
    setProjects(next)
    await syncManagedProjectsFile(next)
  }

  const removeProject = async (project: ProjectMetadata) => {
    const configured = hasSourceControlConfiguration(project)
    const confirmed = await Dialog.confirm({
      title: configured ? `Remove "${project.displayName}" from Source Control?` : `Remove unconfigured record "${project.displayName}"?`,
      message: "This will only remove the Source Control record. Local files and folders will not be deleted.",
      cancelLabel: "Cancel",
      confirmLabel: "Remove",
    })
    if (!confirmed) return
    await ProjectMetadataManager.removeProjectRecord(project.projectId)
    const next = projects.filter((item) => item.projectId !== project.projectId)
    setProjects(next)
    await syncManagedProjectsFile(next)
  }

  const relinkProject = async (project: ProjectMetadata) => {
    await Navigation.present(
      <RelinkProjectView
        project={project}
        onRelinked={async (newPath, newName) => {
          await selectProjectFolder(newPath, newName, project.projectId)
          await loadProjects()
        }}
      />,
    )
  }

  const openProject = async (project: ProjectMetadata) => {
    if (openingPath !== null) return
    setOpeningPath(project.projectPath)
    setErrorMessage(null)
    try {
      const targetPath = project.projectPath
      if (!(await FileManager.exists(targetPath)) || !(await FileManager.isDirectory(targetPath))) {
        await relinkProject(project)
        return
      }

      const service = new GitService()
      if (!(await service.isRepositoryInitialized(targetPath))) {
        const selected = await Dialog.actionSheet({
          title: "Initialize Repository?",
          message: `“${project.displayName}” is not currently managed by Source Control.`,
          actions: [{ label: "Initialize" }],
        })
        if (selected !== 0) return
        await service.initRepository(targetPath)
      }
      await service.openRepository(targetPath)
      await Navigation.present(<SourceControlChangesView gitService={service} projectPath={targetPath} />)
    } catch (error) {
      console.error(`[SourceControl] open failed: ${project.displayName}`, error)
      setErrorMessage(`Unable to open “${project.displayName}”.\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOpeningPath(null)
    }
  }

  const openAddProject = async () => {
    await Navigation.present(<AddProjectFolderView managedProjects={projects} onAdded={addProject} />)
    await loadProjects()
  }

  return <NavigationStack>
    <List
      navigationTitle={t("sourceControl")}
      navigationSubtitle={t("beta")}
      navigationBarTitleDisplayMode="inline"
      toolbar={{ topBarLeading: <CloseButton />, topBarTrailing: [
        <Button title={t("settings")} systemImage="gearshape" buttonStyle="borderless" action={async () => {
          await Navigation.present(<SourceControlSettingsView onLanguageChanged={refreshLanguage} />)
        }} />,
        <Button title={t("refresh")} systemImage="arrow.clockwise" disabled={loading || openingPath !== null} action={loadProjects} />,
      ] }}
    >
    {errorMessage ? <ErrorSection message={errorMessage} /> : null}
    {loading ? <LoadingSection /> : null}
    {!loading && projects.length === 0 ? <EmptyStateSection title={t("noProjects")} message={t("addProjectHint")} systemImage="folder" /> : null}
    {!loading && projects.length === 0 ? <Section><VStack spacing={8} alignment="center"><Button title={t("addProject")} systemImage="plus" buttonStyle="borderedProminent" action={openAddProject} /></VStack></Section> : null}
    {!loading && projects.length > 0 ? <Section header={<Text>{t("myProjects")}</Text>}>
      {projects.map((project) => <ProjectRow key={project.projectId || project.projectPath} project={project} isMissing={!!missingMap[project.projectId]} openingPath={openingPath} onOpen={openProject} onRemove={removeProject} onRelink={relinkProject} removeTitle={t("remove")} />)}
      <Button title={t("addProject")} systemImage="plus" action={openAddProject} />
    </Section> : null}
    </List>
  </NavigationStack>
}

export default SourceControlProjectPickerPage
