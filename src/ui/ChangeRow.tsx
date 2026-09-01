import { Button, HStack, Image, Spacer, Text, VStack } from "scripting"
import { GitChange } from "../core/types"

interface ChangeRowProps {
  change: GitChange
  onStage?: () => void
  onUnstage?: () => void
  onRestore?: () => void
}

function getStatusBadge(change: GitChange): { label: string; color: "green" | "blue" | "red" | "orange" } {
  if (change.status === "added") return { label: "A", color: "green" }
  if (change.status === "deleted") return { label: "D", color: "red" }
  if (change.status === "untracked") return { label: "U", color: "green" }
  return { label: "M", color: "blue" }
}

export function ChangeRow({ change, onStage, onUnstage, onRestore }: ChangeRowProps) {
  const badge = getStatusBadge(change)

  return (
    <HStack spacing={12} alignment="center">
      <Text font="caption" bold foregroundStyle={badge.color}>
        {badge.label}
      </Text>

      <VStack spacing={2} alignment="leading">
        <Text font="body">
          {change.filepath}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {change.staged ? "已暂存" : "未暂存"} · {change.status}
        </Text>
      </VStack>

      <Spacer />

      {onStage && (
        <Button action={onStage}>
          <Image systemName="plus.circle" foregroundStyle="tintColor" />
        </Button>
      )}

      {onUnstage && (
        <Button action={onUnstage}>
          <Image systemName="minus.circle" foregroundStyle="secondaryLabel" />
        </Button>
      )}

      {onRestore && (
        <Button action={onRestore}>
          <Image systemName="arrow.uturn.backward" foregroundStyle="red" />
        </Button>
      )}
    </HStack>
  )
}
