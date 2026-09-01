import { HStack, Text, VStack } from "scripting"
import { formatHistoryTime } from "./formatDate"
import { AppLanguage, createTranslator } from "./localization"
import { GitCommitInfo } from "../core/types"

interface HistoryRowProps {
  commit: GitCommitInfo
  onSelect?: () => void
  language: AppLanguage
}

export function HistoryRow({ commit, onSelect, language }: HistoryRowProps) {
  const timeText = formatHistoryTime(commit.timestamp)
  const t = createTranslator(language)

  return (
    <VStack alignment="leading" spacing={6} onTapGesture={onSelect} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="headline" lineLimit={0}>
        {commit.message || t("noCommitMessage")}
      </Text>
      <HStack spacing={8} alignment="center">
        <Text font="caption" foregroundStyle="secondaryLabel">
          {timeText} · {commit.shortOid}
        </Text>
      </HStack>
    </VStack>
  )
}

export default HistoryRow
