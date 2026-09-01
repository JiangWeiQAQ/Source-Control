import { HStack, Text, VStack } from "scripting"
import { GitCommitInfo } from "../core/types"
import { formatHistoryTime } from "./formatDate"

interface HistoryRowProps {
  commit: GitCommitInfo
  onSelect?: () => void
}

export function HistoryRow({ commit, onSelect }: HistoryRowProps) {
  const timeText = formatHistoryTime(commit.timestamp)

  return (
    <VStack
      alignment="leading"
      spacing={6}
      onTapGesture={onSelect}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text font="headline" lineLimit={2}>
        {commit.message || "No commit message"}
      </Text>

      <HStack spacing={8} alignment="center">
        <Text font="caption" foregroundStyle="systemBlue" monospaced>
          {commit.shortOid}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {commit.authorName} · {timeText}
        </Text>
      </HStack>
    </VStack>
  )
}
export default HistoryRow
