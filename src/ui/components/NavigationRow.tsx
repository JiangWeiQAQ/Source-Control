import { Button, HStack, Image, Spacer, Text, VStack, VirtualNode } from "scripting"
import { uiColors, uiTypography } from "../design"
import { useUISettings } from "../useUISettings"

export function NavigationRow({ icon, title, subtitle, trailing, onPress, disabled }: { icon: string; title: string; subtitle?: string; trailing?: VirtualNode | null; onPress: () => void; disabled?: boolean }) {
  const { tokens } = useUISettings()
  return <Button buttonStyle="plain" disabled={disabled} action={onPress} contentShape={{ kind: "interaction", shape: "rect" }}><HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: tokens.cardRowHeight, alignment: "leading" }} padding={{ horizontal: tokens.cardPadding, vertical: tokens.cardPadding }} background={uiColors.cardBackground} clipShape={{ type: "rect", cornerRadius: tokens.cardRadius }}><Image systemName={icon} foregroundStyle={uiColors.accent} /><VStack spacing={tokens.compactSpacing} alignment="leading"><Text font={uiTypography.body}>{title}</Text>{subtitle ? <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText} lineLimit={1}>{subtitle}</Text> : null}</VStack><Spacer />{trailing}{trailing === undefined ? <Image systemName="chevron.right" foregroundStyle={uiColors.secondaryText} /> : null}</HStack></Button>
}
