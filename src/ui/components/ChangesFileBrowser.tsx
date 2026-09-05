import { Button, Divider, HStack, Image, Navigation, Spacer, Text, VStack } from "scripting"
import { GitChange } from "../../core/types"
import { AppLanguage, formatChangeType } from "../localization"
import { GitService } from "../../core/GitService"
import { SourceControlDiffView } from "../SourceControlDiffView"
import { SourceControlProjectConfigView } from "../SourceControlProjectConfigView"
import { ChangeFileRow } from "./ChangeFileRow"

export type ChangeFilter = "staged" | "unstaged"
export interface FolderGroup { path: string; files: GitChange[] }

function formatFolderPath(path: string, language: AppLanguage): string {
  return path === "ROOT" && language === "zh-Hans" ? "根目录" : path === "ROOT" ? "Root" : path
}

function fileParts(filepath: string): { directory: string; filename: string } {
  const parts = filepath.split("/")
  const filename = parts.pop() || filepath
  return { filename, directory: parts.join("/") || "ROOT" }
}

export function folderGroups(changes: GitChange[]): FolderGroup[] {
  const groups = new Map<string, GitChange[]>()
  groups.set("ROOT", [])
  for (const change of changes) {
    const directory = fileParts(change.filepath).directory
    groups.set(directory, [...(groups.get(directory) || []), change])
  }
  return Array.from(groups.entries())
    .map(([path, files]) => ({ path, files: files.sort((a, b) => fileParts(a.filepath).filename.localeCompare(fileParts(b.filepath).filename)) }))
    .sort((a, b) => a.path === "ROOT" ? -1 : b.path === "ROOT" ? 1 : a.path.localeCompare(b.path))
}

export function ChangesFileBrowser({ groups, selectedFolder, onSelect, service, filter, onChanged, disabled, language, projectPath }: {
  groups: FolderGroup[]
  selectedFolder: string
  onSelect: (folder: string) => void
  service: GitService
  filter: ChangeFilter
  onChanged: () => Promise<void>
  disabled: boolean
  language: AppLanguage
  projectPath?: string
}) {
  const selected = groups.find((group) => group.path === selectedFolder)
  return <HStack spacing={8} alignment="top">
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "文件夹" : "Folders"}</Text>
      {groups.map((group) => <ButtonFolderRow key={group.path} group={group} selected={group.path === selectedFolder} language={language} disabled={disabled} onSelect={() => onSelect(group.path)} />)}
    </VStack>
    <Divider />
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">{formatFolderPath(selectedFolder, language)}</Text>
      {(selected?.files || []).map((change) => {
        const filename = fileParts(change.filepath).filename
        if (filename === "script.json" && projectPath) {
          return <ChangeFileRow key={change.filepath} change={change} subtitle="项目配置" showsChevron onPress={() => { Navigation.present(<SourceControlProjectConfigView projectPath={projectPath} />).catch(console.error) }} disabled={disabled} />
        }
        return <ChangeFileRow key={change.filepath} change={change} subtitle={`${change.status === "untracked" ? "?" : change.status === "added" ? "A" : change.status === "deleted" ? "D" : "M"} · ${formatChangeType(change.status, language)}`} destination={<SourceControlDiffView gitService={service} change={change} comparison={filter} onChanged={onChanged} />} disabled={disabled} />
      })}
    </VStack>
  </HStack>
}

function ButtonFolderRow({ group, selected, language, disabled, onSelect }: { group: FolderGroup; selected: boolean; language: AppLanguage; disabled: boolean; onSelect: () => void }) {
  return <Button disabled={disabled} buttonStyle={selected ? "bordered" : "plain"} action={onSelect}>
    <HStack spacing={6} alignment="center">
      <Image systemName="folder" foregroundStyle={selected ? "blue" : "secondaryLabel"} />
      <Text font="caption" foregroundStyle={selected ? "blue" : "secondaryLabel"} lineLimit={2}>{formatFolderPath(group.path, language)}</Text>
      <Spacer />
      <Text font="caption" foregroundStyle="secondaryLabel">{group.files.length}</Text>
      {selected ? <Image systemName="checkmark" foregroundStyle="blue" /> : null}
    </HStack>
  </Button>
}
