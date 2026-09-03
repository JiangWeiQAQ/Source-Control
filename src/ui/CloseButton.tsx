import { Button, HStack, Image, Navigation } from "scripting"

export function CloseButton() {
  const dismiss = Navigation.useDismiss()
  return (
    <Button
      action={() => dismiss()}
      buttonStyle="borderless"
      contentShape={{ kind: "interaction", shape: "rect" }}
    >
      <HStack frame={{ width: 44, height: 44, alignment: "center" }}>
        <Image systemName="xmark" />
      </HStack>
    </Button>
  )
}
