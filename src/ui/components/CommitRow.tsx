import { HStack, Text, VStack } from "scripting"
import { GitCommitInfo } from "../../core/types"
import { AppLanguage, createTranslator } from "../localization"
import { formatHistoryTime } from "../formatDate"

export interface CommitRowProps {
  commit: GitCommitInfo
  onSelect?: () => void
  language: AppLanguage
  syncState?: "synced" | "local" | "remote" | "unknown"
}

export function CommitRow({ commit, onSelect, language, syncState }: CommitRowProps) {
  const t = createTranslator(language)
  return <VStack alignment="leading" spacing={6} onTapGesture={onSelect} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <Text font="headline" lineLimit={0}>{commit.message || t("noCommitMessage")}</Text>
    <HStack spacing={8} alignment="center">
      <Text font="caption" foregroundStyle="secondaryLabel">{formatHistoryTime(commit.timestamp)} · {commit.shortOid}</Text>
    </HStack>
    {syncState ? <Text font="caption" foregroundStyle={syncState === "local" || syncState === "remote" ? "orange" : "secondaryLabel"}>{syncState === "synced" ? "✓ 已同步" : syncState === "local" ? "仅本地" : syncState === "remote" ? "仅云端" : "同步状态未知"}</Text> : null}
  </VStack>
}
