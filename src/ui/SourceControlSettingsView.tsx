import { Button, List, Navigation, Section, Text, useState } from "scripting"
import { getLanguagePreference, LanguagePreference, setLanguagePreference } from "./localization"
import { useTranslator } from "./useLocalization"

export interface SourceControlSettingsViewProps {
  onLanguageChanged?: () => void
}

export function SourceControlSettingsView({ onLanguageChanged }: SourceControlSettingsViewProps) {
  const dismiss = Navigation.useDismiss()
  const { t } = useTranslator()
  const [preference, setPreference] = useState<LanguagePreference>(getLanguagePreference())

  const chooseLanguage = async () => {
    const selected = await Dialog.actionSheet({
      title: "Language",
      actions: [
        { label: "System" },
        { label: "简体中文" },
        { label: "English" },
      ],
    })
    const next: LanguagePreference | null = selected === 0 ? "system" : selected === 1 ? "zh-Hans" : selected === 2 ? "en" : null
    if (!next) return
    setLanguagePreference(next)
    setPreference(next)
    onLanguageChanged?.()
  }

  const label = preference === "system" ? "System" : preference === "zh-Hans" ? "简体中文" : "English"

  return (
    <List
      navigationTitle={t("settings")}
      toolbar={{
        topBarLeading: <Button title="Close" systemImage="xmark" action={() => dismiss()} />,
      }}
    >
      <Section header={<Text>{t("language")}</Text>}>
        <Button title={`Language · ${label}`} systemImage="globe" action={chooseLanguage} />
      </Section>
    </List>
  )
}

export default SourceControlSettingsView
