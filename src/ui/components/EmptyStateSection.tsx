import { Image, Section, Text, VStack } from "scripting"

export function EmptyStateSection({ title, message, systemImage = "tray" }: { title: string; message?: string; systemImage?: string }) {
  return <Section><VStack spacing={8} alignment="center"><Image systemName={systemImage} font="largeTitle" foregroundStyle="tertiaryLabel" /><Text font="headline">{title}</Text>{message ? <Text font="footnote" foregroundStyle="secondaryLabel">{message}</Text> : null}</VStack></Section>
}
