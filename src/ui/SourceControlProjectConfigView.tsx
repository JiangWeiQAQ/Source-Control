import { Button, List, Navigation, NavigationStack, Path, Section, Text, TextField, useEffect, useState } from "scripting"

import { CloseButton } from "./CloseButton"

interface ScriptConfig {
  name?: unknown
  localizedNames?: unknown
  version?: unknown
  description?: unknown
  author?: unknown
  icon?: unknown
  color?: unknown
  [key: string]: unknown
}

export interface SourceControlProjectConfigViewProps {
  projectPath: string
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function versionIsValid(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.trim())
}

export function SourceControlProjectConfigView({ projectPath }: SourceControlProjectConfigViewProps) {
  const dismiss = Navigation.useDismiss()
  const [config, setConfig] = useState<ScriptConfig | null>(null)
  const [version, setVersion] = useState("")
  const [description, setDescription] = useState("")
  const [authorName, setAuthorName] = useState("")
  const [icon, setIcon] = useState("")
  const [color, setColor] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const scriptJsonPath = Path.join(projectPath, "script.json")

  useEffect(() => {
    const load = async () => {
      try {
        const parsed = JSON.parse(await FileManager.readAsString(scriptJsonPath, "utf8")) as ScriptConfig
        setConfig(parsed)
        setVersion(textValue(parsed.version))
        setDescription(textValue(parsed.description))
        setAuthorName(parsed.author && typeof parsed.author === "object" ? textValue((parsed.author as { name?: unknown }).name) : "")
        setIcon(textValue(parsed.icon))
        setColor(textValue(parsed.color))
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }
    load().catch(console.error)
  }, [scriptJsonPath])

  const save = async () => {
    if (!config) return
    if (!versionIsValid(version)) {
      setErrorMessage("版本号必须符合 major.minor.patch，例如 1.0.1")
      return
    }
    setErrorMessage(null)
    setSaved(false)
    const originalText = await FileManager.readAsString(scriptJsonPath, "utf8")
    const updated: ScriptConfig = { ...config, version: version.trim(), description }
    if ("author" in config && config.author && typeof config.author === "object") {
      updated.author = { ...(config.author as Record<string, unknown>), name: authorName }
    }
    if ("icon" in config) updated.icon = icon
    if ("color" in config) updated.color = color
    const updatedText = `${JSON.stringify(updated, null, 2)}\n`
    JSON.parse(updatedText)
    try {
      await FileManager.writeAsString(scriptJsonPath, updatedText, "utf8")
      const savedText = await FileManager.readAsString(scriptJsonPath, "utf8")
      JSON.parse(savedText)
      setConfig(updated)
      setSaved(true)
    } catch (error) {
      try {
        await FileManager.writeAsString(scriptJsonPath, originalText, "utf8")
      } catch (restoreError) {
        console.error("[ProjectConfig] restore original script.json failed", restoreError)
      }
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <NavigationStack>
      <List navigationTitle="项目配置" toolbar={{ topBarLeading: <CloseButton /> }}>
      {errorMessage ? <Section><Text foregroundStyle="red">{errorMessage}</Text></Section> : null}
      {saved ? <Section><Text foregroundStyle="green">已保存到当前项目的 script.json</Text></Section> : null}
      <Section header={<Text>常用字段</Text>}>
        <TextField title="Version" value={version} onChanged={setVersion} prompt="1.0.1" />
        <TextField title="Description" value={description} onChanged={setDescription} axis="vertical" prompt="项目说明" />
        {config && config.author && typeof config.author === "object" ? <TextField title="Author Name" value={authorName} onChanged={setAuthorName} /> : null}
        {config && "icon" in config ? <TextField title="Icon" value={icon} onChanged={setIcon} /> : null}
        {config && "color" in config ? <TextField title="Color" value={color} onChanged={setColor} /> : null}
      </Section>
      <Section>
        <Button title="保存项目配置" buttonStyle="borderedProminent" action={save} />
      </Section>
      </List>
    </NavigationStack>
  )
}

export default SourceControlProjectConfigView
