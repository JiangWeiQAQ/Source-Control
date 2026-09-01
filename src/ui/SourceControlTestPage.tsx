import { useMemo } from "scripting"
import { GitService } from "../core/GitService"
import { SourceControlChangesView } from "./SourceControlChangesView"

export interface SourceControlTestPageProps {
  projectPath?: string
}

export default function SourceControlTestPage({
  projectPath = `${FileManager.scriptsDirectory}/Source Control Stage Test`,
}: SourceControlTestPageProps) {
  const gitService = useMemo(() => new GitService(), [])

  return (
    <SourceControlChangesView
      gitService={gitService}
      projectPath={projectPath}
    />
  )
}
