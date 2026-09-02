import { Button, List, Navigation, Section, Text, useState } from "scripting"
import { getLanguagePreference, LanguagePreference, setLanguagePreference } from "./localization"
import { useTranslator } from "./useLocalization"
import { SourceControlRemoteView } from "./SourceControlRemoteView"
import { GitService } from "../core/GitService"

export interface SourceControlSettingsViewProps {
  onLanguageChanged?: () => void
  gitService?: GitService
}

export function SourceControlSettingsView({ onLanguageChanged, gitService }: SourceControlSettingsViewProps) {
  const dismiss = Navigation.useDismiss()
  const { t } = useTranslator()
  const [preference, setPreference] = useState<LanguagePreference>(getLanguagePreference())

  const chooseLanguage = async () => {
    const selected = await Dialog.actionSheet({ title: "Language", actions: [{ label: "System" }, { label: "简体中文" }, { label: "English" }] })
    const next: LanguagePreference | null = selected === 0 ? "system" : selected === 1 ? "zh-Hans" : selected === 2 ? "en" : null
    if (!next) return
    setLanguagePreference(next)
    setPreference(next)
    onLanguageChanged?.()
  }

  const label = preference === "system" ? "System" : preference === "zh-Hans" ? "简体中文" : "English"
  return <List navigationTitle={t("settings")} toolbar={{ topBarLeading: <Button title={t("close")} systemImage="xmark" action={() => dismiss()} /> }}>
    <Section header={<Text>常规</Text>}><Button title={`${t("language")} · ${label}`} systemImage="globe" action={chooseLanguage} /></Section>
    {gitService ? <Section header={<Text>GitHub</Text>}><Button title="GitHub 同步" systemImage="arrow.triangle.2.circlepath" action={async () => { await Navigation.present(<SourceControlRemoteView gitService={gitService} onChanged={async () => undefined} />) }} /></Section> : null}
    <Section header={<Text>说明</Text>}><Text font="footnote" foregroundStyle="secondaryLabel">本地版本：选择文件 → 填写版本说明 → 保存本地版本。{"\n"}GitHub：保存本地版本后，可在 GitHub 同步中上传。{"\n"}本地提交不会自动上传到 GitHub。</Text></Section>
  </List>
}

export default SourceControlSettingsView
