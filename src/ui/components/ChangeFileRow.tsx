import { Button, HStack, Image, NavigationLink, Spacer, Text, VStack, VirtualNode } from "scripting"
import { GitChange } from "../../core/types"
import { ChangeStatusBadge } from "./ChangeStatusBadge"

export function ChangeFileRow({
  change,
  subtitle,
  destination,
  onPress,
  disabled,
  showsChevron = false,
  minHeight = 54,
}: {
  change: GitChange
  subtitle?: string
  destination?: VirtualNode
  onPress?: () => void
  disabled?: boolean
  showsChevron?: boolean
  minHeight?: number
}) {
  const content = <HStack spacing={7} alignment="center" frame={{ maxWidth: "infinity", minHeight, alignment: "leading" }}>
    <ChangeStatusBadge change={change} />
    <VStack spacing={2} alignment="leading">
      <Text font="subheadline" lineLimit={2}>{change.filepath.split("/").pop() || change.filepath}</Text>
      {subtitle ? <Text font="caption2" foregroundStyle="secondaryLabel">{subtitle}</Text> : null}
    </VStack>
    <Spacer />
    {showsChevron ? <Image systemName="chevron.right" foregroundStyle="secondaryLabel" /> : null}
  </HStack>

  if (destination) return <NavigationLink disabled={disabled} destination={destination}>{content}</NavigationLink>
  return <Button disabled={disabled} buttonStyle="plain" action={onPress || (() => undefined)}>{content}</Button>
}
