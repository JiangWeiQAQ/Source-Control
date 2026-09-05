import { Button, HStack, Image } from "scripting"
import { uiTokens } from "../design"

export function ToolbarIconButton({ systemImage, onPress, disabled }: { systemImage: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Button
      action={onPress}
      disabled={disabled}
      buttonStyle="borderless"
      contentShape={{ kind: "interaction", shape: "rect" }}
    >
      <HStack frame={{ width: uiTokens.toolbarIconHitArea, height: uiTokens.toolbarIconHitArea, alignment: "center" }}>
        <Image systemName={systemImage} />
      </HStack>
    </Button>
  )
}
