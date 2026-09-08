import { Button, List, Navigation, NavigationStack, Path, Section, Text, TextField, useEffect, useState } from "scripting"
import { isValidVersion, JsonStore, ProjectRegistry } from "../core"
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
  onSaved?: (config: ScriptConfig) => Promise<void> | void
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function SourceControlProjectConfigView({ projectPath, onSaved }: SourceControlProjectConfigViewProps) {
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
    const trimmedVersion = version.trim()
    if (!isValidVersion(trimmedVersion)) {
      setErrorMessage("版本号必须符合 SemVer 2.0 规范，例如 1.0.1、1.0.0-beta.1")
      return
    }
    setErrorMessage(null)
    setSaved(false)

    try {
      // 1. 保留原始 JSON 对象未知字段，同时合并最新磁盘内容以防外部并发修改
      let baseConfig: ScriptConfig = { ...config }
      if (await FileManager.exists(scriptJsonPath)) {
        try {
          const currentParsed = JSON.parse(await FileManager.readAsString(scriptJsonPath, "utf8")) as ScriptConfig
          if (currentParsed && typeof currentParsed === "object" && !Array.isArray(currentParsed)) {
            baseConfig = { ...baseConfig, ...currentParsed }
          }
        } catch {
          // 降级使用当前内存中的 config
        }
      }

      // 2. 生成更新后的 JSON 对象
      const updated: ScriptConfig = { ...baseConfig, version: trimmedVersion, description }
      if ("author" in config && config.author && typeof config.author === "object") {
        updated.author = { ...(config.author as Record<string, unknown>), name: authorName }
      }
      if ("icon" in config) updated.icon = icon
      if ("color" in config) updated.color = color

      // 3. 通过 JsonStore.writeAtomic 进行原子写入（写入临时文件 -> JSON.parse 校验 -> 备份 -> rename 原子替换 -> 异常自动恢复原文件）
      await JsonStore.writeAtomic(scriptJsonPath, updated)
      setConfig(updated)
      setSaved(true)

      // 4. 刷新当前项目 metadata 状态（同步 projects.json 中的项目信息）
      try {
        const registry = new ProjectRegistry()
        await registry.getOrCreateProject(projectPath)
      } catch (metaErr) {
        console.error("[ProjectConfig] refresh project metadata failed", metaErr)
      }

      // 5. 触发外部回调以同步父级视图（如 SettingsView 中的 releaseVersion）
      if (onSaved) {
        await onSaved(updated)
      }
    } catch (error) {
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
