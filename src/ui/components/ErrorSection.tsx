import { Section, Text } from "scripting"

export function ErrorSection({ message, title, severity = "error" }: { message: string; title?: string; severity?: "error" | "warning" }) {
  const color = severity === "warning" ? "orange" : "red"
  return (
    <Section>
      {title ? <Text font="headline" foregroundStyle={color}>{title}</Text> : null}
      <Text font="footnote" foregroundStyle={color}>{message}</Text>
    </Section>
  )
}
