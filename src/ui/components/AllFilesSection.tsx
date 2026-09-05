import { Button, Divider, HStack, Image, Section, Spacer, Text, VStack } from "scripting"
import { ProjectFileEntry } from "../projectFiles"

export interface ProjectFileGroup { path: string; files: ProjectFileEntry[] }

export function projectFileGroups(files: ProjectFileEntry[]): ProjectFileGroup[] {
  const groups = new Map<string, ProjectFileEntry[]>()
  groups.set("ROOT", [])
  for (const file of files) {
    if (file.directory !== "ROOT") {
      const segments = file.directory.split("/")
      for (let index = 1; index <= segments.length; index += 1) {
        const directory = segments.slice(0, index).join("/")
        if (!groups.has(directory)) groups.set(directory, [])
      }
    }
    groups.set(file.directory, [...(groups.get(file.directory) || []), file])
  }
  return Array.from(groups.entries())
    .map(([path, groupFiles]) => ({ path, files: groupFiles.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.path === "ROOT" ? -1 : b.path === "ROOT" ? 1 : a.path.localeCompare(b.path))
}

function formatFolderPath(path: string, language: "zh-Hans" | "en"): string {
  return path === "ROOT" && language === "zh-Hans" ? "根目录" : path === "ROOT" ? "Root" : path
}

function AllFilesFolderRow({ group, selected, language, onSelect }: { group: ProjectFileGroup; selected: boolean; language: "zh-Hans" | "en"; onSelect: () => void }) {
  return <ButtonFolderRow group={group} selected={selected} language={language} onSelect={onSelect} />
}

function ButtonFolderRow({ group, selected, language, onSelect }: { group: ProjectFileGroup; selected: boolean; language: "zh-Hans" | "en"; onSelect: () => void }) {
  return <Button buttonStyle={selected ? "bordered" : "plain"} action={onSelect}>
    <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Image systemName="folder" foregroundStyle={selected ? "blue" : "secondaryLabel"} />
      <Text font="caption" foregroundStyle={selected ? "blue" : "secondaryLabel"} lineLimit={2}>{formatFolderPath(group.path, language)}</Text>
      <Spacer />
      <Text font="caption" foregroundStyle="secondaryLabel">{group.files.length}</Text>
      {selected ? <Image systemName="checkmark" foregroundStyle="blue" /> : null}
    </HStack>
  </Button>
}

export function AllFilesBrowser({ groups, selectedFolder, onSelect, language }: { groups: ProjectFileGroup[]; selectedFolder: string; onSelect: (folder: string) => void; language: "zh-Hans" | "en" }) {
  const selected = groups.find((group) => group.path === selectedFolder)
  return <HStack spacing={8} alignment="top">
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "文件夹" : "Folders"}</Text>
      {groups.map((group) => <AllFilesFolderRow key={group.path} group={group} selected={group.path === selectedFolder} language={language} onSelect={() => onSelect(group.path)} />)}
    </VStack>
    <Divider />
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">{formatFolderPath(selectedFolder, language)}</Text>
      {selected?.files.length ? selected.files.map((file) => <HStack key={file.relativePath} spacing={7} alignment="center" frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}><Image systemName="doc" foregroundStyle="secondaryLabel" /><Text font="subheadline" lineLimit={2}>{file.name}</Text></HStack>) : <Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "此文件夹暂无文件。" : "No files in this folder."}</Text>}
    </VStack>
  </HStack>
}

export function AllFilesSection({ files, showAllFiles, onToggle, selectedFolder, onSelect, language }: { files: ProjectFileEntry[]; showAllFiles: boolean; onToggle: () => void; selectedFolder: string; onSelect: (folder: string) => void; language: "zh-Hans" | "en" }) {
  const groups = projectFileGroups(files)
  return <Section header={<Text>{language === "zh-Hans" ? "全部文件" : "All Files"}</Text>}>
    <Button action={onToggle} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
      <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", minHeight: 58, alignment: "leading" }} padding={{ horizontal: 14, vertical: 10 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}>
        <Image systemName="folder" foregroundStyle="blue" />
        <VStack spacing={2} alignment="leading"><Text font="subheadline">{language === "zh-Hans" ? `全部文件 · ${files.length}` : `All Files · ${files.length}`}</Text><Text font="caption" foregroundStyle="secondaryLabel">{language === "zh-Hans" ? "浏览项目中的所有文件" : "Browse all project files"}</Text></VStack>
        <Spacer /><Image systemName={showAllFiles ? "chevron.up" : "chevron.right"} foregroundStyle="secondaryLabel" />
      </HStack>
    </Button>
    {showAllFiles ? <AllFilesBrowser groups={groups} selectedFolder={selectedFolder} onSelect={onSelect} language={language} /> : null}
  </Section>
}
