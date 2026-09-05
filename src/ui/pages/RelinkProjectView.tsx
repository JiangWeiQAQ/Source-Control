import { Button, List, Navigation, NavigationStack, Section, Text, useEffect, useState } from "scripting"
import { ProjectMetadata, RelocationCandidate, findRelocationCandidates } from "../../core/ProjectMetadata"
import { CloseButton } from "../CloseButton"
import { ErrorSection } from "../components/ErrorSection"

function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

export function RelinkProjectView({ project, onRelinked }: {
  project: ProjectMetadata
  onRelinked: (newPath: string, newName: string) => Promise<void>
}) {
  const dismiss = Navigation.useDismiss()
  const [, setCandidates] = useState<RelocationCandidate[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    findRelocationCandidates(project).then(setCandidates).catch(() => setCandidates([]))
  }, [project])

  const chooseFolder = async () => {
    try {
      const selected = await DocumentPicker.pickDirectory()
      if (!selected) return
      await onRelinked(selected, projectName(selected))
      dismiss()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return <NavigationStack>
    <List navigationTitle="重新选择项目文件夹" toolbar={{ topBarLeading: <CloseButton /> }}>
    {errorMessage ? <ErrorSection message={errorMessage} /> : null}
    <Section><Button title="选择项目文件夹" systemImage="folder" action={chooseFolder} /></Section>
    <Section><Text foregroundStyle="secondaryLabel">可直接选择改名或移动后的真实项目文件夹。</Text></Section>
    </List>
  </NavigationStack>
}

export default RelinkProjectView
