import { Button, HStack, Image, Spacer, Text, VStack } from "scripting"
import { RepoItem } from "./types"

interface ProjectListProps {
  projects: RepoItem[]
  onSelect: (repo: RepoItem) => void
  onInit: (repo: RepoItem) => void
}

export function ProjectList({ projects, onSelect, onInit }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <VStack alignment="center" spacing={8}>
        <Text font="body" foregroundStyle="secondaryLabel">
          未检测到项目目录
        </Text>
      </VStack>
    )
  }

  return (
    <VStack alignment="leading" spacing={8}>
      {projects.map((proj) => (
        <HStack key={proj.path} spacing={12} alignment="center">
          <Image
            systemName={proj.isGit ? "folder.fill" : "folder.badge.plus"}
            font={20}
            foregroundStyle={proj.isGit ? "systemBlue" : "secondaryLabel"}
          />
          <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="headline">{proj.name}</Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {proj.isGit ? "Git 已启用" : "未初始化 Git"}
            </Text>
          </VStack>
          <Spacer />
          {proj.isGit ? (
            <Button title="打开" action={() => onSelect(proj)} />
          ) : (
            <Button title="初始化" action={() => onInit(proj)} />
          )}
        </HStack>
      ))}
    </VStack>
  )
}
