import { Button, List, Navigation, Section, useState } from "scripting"
import { ProjectMetadata } from "../../core/ProjectMetadata"
import { CloseButton } from "../CloseButton"
import { ErrorSection } from "../components/ErrorSection"

function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

export interface AddProjectFolderViewProps {
  managedProjects: ProjectMetadata[]
  onAdded: (name: string, path: string) => Promise<void>
}

export function AddProjectFolderView({ managedProjects, onAdded }: AddProjectFolderViewProps) {
  const dismiss = Navigation.useDismiss()
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const chooseFolder = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const selected = await DocumentPicker.pickDirectory()
      if (!selected) return
      const name = projectName(selected)
      if (managedProjects.some((project) => project.projectPath === selected)) return
      await onAdded(name, selected)
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return <List navigationTitle="选择项目文件夹" toolbar={{ topBarLeading: <CloseButton /> }}>
    {errorMessage ? <ErrorSection message={errorMessage} /> : null}
    <Section><Button title={loading ? "正在读取…" : "选择项目文件夹"} systemImage="folder" disabled={loading} action={chooseFolder} /></Section>
  </List>
}

export default AddProjectFolderView
