import { Button, HStack, Image, Menu, ProgressView, Spacer, Text, VStack } from "scripting"
import { ProjectMetadata } from "../../core/ProjectMetadata"

export function ProjectRow({ project, isMissing, openingPath, onOpen, onRemove, onRelink, removeTitle }: {
  project: ProjectMetadata
  isMissing: boolean
  openingPath: string | null
  onOpen: (project: ProjectMetadata) => void
  onRemove: (project: ProjectMetadata) => void
  onRelink: (project: ProjectMetadata) => void
  removeTitle: string
}) {
  const isOpening = openingPath === project.projectPath
  return <HStack spacing={10} alignment="center">
    <Button action={() => { if (isMissing) onRelink(project); else onOpen(project) }} disabled={openingPath !== null}>
      <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Image systemName={isMissing ? "exclamationmark.triangle" : "folder"} foregroundStyle={isMissing ? "systemOrange" : "systemBlue"} />
        <VStack spacing={2} alignment="leading">
          <Text font="body">{project.displayName}</Text>
          {isMissing ? <HStack spacing={6} alignment="center"><Text font="caption" foregroundStyle="orange">项目位置已变化</Text><Text font="caption" foregroundStyle="systemBlue">[ 重新关联 ]</Text></HStack> : null}
        </VStack>
        <Spacer />
        {isOpening ? <ProgressView /> : <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />}
      </HStack>
    </Button>
    <Menu title="More" systemImage="ellipsis.circle">
      {isMissing ? <Button title="重新选择文件夹" disabled={openingPath !== null} action={() => onRelink(project)} /> : null}
      <Button title={removeTitle} role="destructive" disabled={openingPath !== null} action={() => onRemove(project)} />
    </Menu>
  </HStack>
}
