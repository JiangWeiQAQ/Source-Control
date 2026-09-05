import { Button, HStack, Image, Spacer, Text, VStack, VirtualNode } from "scripting"
import { useUISettings } from "../useUISettings"
import { uiColors, uiTypography } from "../design"

export function SettingsRow({ icon, title, subtitle, value, trailing, onPress, disabled, minHeight }: {
  icon: string
  title: string
  subtitle?: string
  value?: string
  trailing?: VirtualNode | null
  onPress: () => void
  disabled?: boolean
  minHeight?: number
}) {
  const { tokens } = useUISettings()
  const resolvedMinHeight = minHeight ?? tokens.rowHeight
  return <Button action={onPress} disabled={disabled} buttonStyle="plain" contentShape={{ kind: "interaction", shape: "rect" }}>
    <HStack spacing={tokens.rowContentSpacing} alignment="center" frame={{ maxWidth: "infinity", minHeight: resolvedMinHeight, alignment: "leading" }}>
      <Image systemName={icon} foregroundStyle={uiColors.accent} />
      <VStack spacing={tokens.compactSpacing} alignment="leading">
        <Text font={uiTypography.body}>{title}</Text>
        {subtitle ? <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText} lineLimit={1}>{subtitle}</Text> : null}
      </VStack>
      <Spacer />
      {value ? <Text font={uiTypography.secondary} foregroundStyle={uiColors.secondaryText} lineLimit={1}>{value}</Text> : null}
      {trailing === undefined ? <Image systemName="chevron.right" foregroundStyle={uiColors.secondaryText} /> : trailing}
    </HStack>
  </Button>
}
