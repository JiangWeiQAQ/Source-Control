import { Button, HStack, Image, Spacer, Text, VStack } from "scripting"
import { uiColors, uiTypography } from "../design"
import { useUISettings } from "../useUISettings"

export function ChangesSummaryCard({
  summary,
  stageTitle,
  stageSubtitle,
  onStage,
  stageDisabled,
  commitMessageTitle,
  commitMessageValue,
  onCommitMessage,
  commitMessageDisabled,
  commitButtonTitle,
  commitButtonDisabled,
  commitBusy,
  onCommit,
  syncSummary,
  syncButtonTitle,
  onSync,
  syncDisabled,
}: {
  summary: string
  stageTitle?: string
  stageSubtitle?: string
  onStage?: () => void
  stageDisabled?: boolean
  commitMessageTitle: string
  commitMessageValue: string
  onCommitMessage: () => void
  commitMessageDisabled: boolean
  commitButtonTitle: string
  commitButtonDisabled: boolean
  commitBusy: boolean
  onCommit: () => void
  syncSummary: string
  syncButtonTitle: string
  onSync: () => void
  syncDisabled: boolean
}) {
  const { tokens } = useUISettings()
  return <VStack spacing={tokens.groupSpacing} alignment="leading">
    <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText}>{summary}</Text>
    {onStage ? <Button action={onStage} disabled={stageDisabled} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
      <HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.rowHeight, alignment: "leading" }} padding={{ horizontal: tokens.cardPadding, vertical: 10 }} background={uiColors.cardBackground} clipShape={{ type: "rect", cornerRadius: tokens.cardRadius }}>
        <Image systemName="plus" foregroundStyle={uiColors.accent} />
        <VStack spacing={tokens.compactSpacing} alignment="leading"><Text font={uiTypography.body}>{stageTitle || ""}</Text>{stageSubtitle ? <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText}>{stageSubtitle}</Text> : null}</VStack>
        <Spacer /><Image systemName="chevron.right" foregroundStyle={uiColors.secondaryText} />
      </HStack>
    </Button> : null}
    <Button action={onCommitMessage} disabled={commitMessageDisabled} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
      <HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.rowHeight, alignment: "leading" }} padding={{ horizontal: tokens.cardPadding, vertical: 10 }} background={uiColors.cardBackground} clipShape={{ type: "rect", cornerRadius: tokens.cardRadius }}>
        <Image systemName="note.text" foregroundStyle={uiColors.accent} />
        <VStack spacing={tokens.compactSpacing} alignment="leading"><Text font={uiTypography.body}>{commitMessageTitle}</Text><Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText} lineLimit={1}>{commitMessageValue}</Text></VStack>
        <Spacer /><Image systemName="chevron.right" foregroundStyle={uiColors.secondaryText} />
      </HStack>
    </Button>
    <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText}>{syncSummary}</Text>
    <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Button action={onCommit} disabled={commitButtonDisabled} buttonStyle="borderedProminent" frame={{ maxWidth: "infinity", minHeight: tokens.buttonHeight }}><Text font={uiTypography.body} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{commitBusy ? "…" : commitButtonTitle}</Text></Button>
      <Button action={onSync} disabled={syncDisabled} buttonStyle="borderedProminent" frame={{ maxWidth: "infinity", minHeight: tokens.buttonHeight }}><Text font={uiTypography.body} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{syncButtonTitle}</Text></Button>
    </HStack>
  </VStack>
}
