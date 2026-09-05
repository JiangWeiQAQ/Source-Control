import { ProgressView, Section, Text, VStack } from "scripting"

export function LoadingSection({ message }: { message?: string }) {
  return <Section><VStack spacing={10} alignment="center"><ProgressView />{message ? <Text font="footnote" foregroundStyle="secondaryLabel">{message}</Text> : null}</VStack></Section>
}
