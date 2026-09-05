import { Button, HStack, Image, List, Navigation, Section, Spacer, Text, TextField, useEffect, useState, VStack } from "scripting"
import { GitHubReleaseService } from "../core/GitHubReleaseService"
import { GitService } from "../core/GitService"
import { GitHubReleaseResult } from "../core/types"
import { CloseButton } from "./CloseButton"
import { ErrorSection } from "./components/ErrorSection"
import { LoadingSection } from "./components/LoadingSection"
import { formatRemoteRepository } from "../core/remote/RemoteValidation"
import { useUISettings } from "./useUISettings"

export interface SourceControlReleaseViewProps {
  gitService: GitService
  projectPath: string
}

function normalizeVersion(value: string): string | null {
  const normalized = value.trim().replace(/^v/i, "")
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : null
}

function displayRepository(url: string): string {
  return formatRemoteRepository(url)
}

export function SourceControlReleaseView({ gitService, projectPath }: SourceControlReleaseViewProps) {
  const dismiss = Navigation.useDismiss()
  const { tokens } = useUISettings()
  const [version, setVersion] = useState("")
  const [notes, setNotes] = useState("")
  const [commitOid, setCommitOid] = useState("")
  const [repository, setRepository] = useState("")
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<GitHubReleaseResult | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        await gitService.openRepository(projectPath)
        const service = new GitHubReleaseService(gitService, projectPath)
        setVersion(await service.getProjectVersion())
        const remotes = await gitService.listRemotes()
        const remote = remotes.find((item) => item.name === "origin") || remotes[0]
        if (remote) {
          setRepository(displayRepository(remote.url))
          setConfigured(/^https:\/\//i.test(remote.url) && await gitService.hasRemoteCredential(remote.name))
        }
        const history = await gitService.getHistory(1)
        setCommitOid(history[0]?.shortOid || "")
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setLoading(false)
      }
    }
    load().catch(console.error)
  }, [gitService, projectPath])

  const publish = async () => {
    const normalized = normalizeVersion(version)
    if (!normalized) { setErrorMessage("版本号格式不正确\n示例：1.2.0"); return }
    if (!configured || publishing) return
    const tag = `v${normalized}`
    const confirmed = await Dialog.confirm({
      title: "发布 Release？",
      message: `版本：${normalized}\nTag：${tag}\n当前 Commit：${commitOid}\n将创建 ZIP 并上传到 GitHub Release。`,
      cancelLabel: "取消",
      confirmLabel: "发布",
    })
    if (!confirmed) return
    setPublishing(true)
    setErrorMessage(null)
    setResult(null)
    try {
      const releaseService = new GitHubReleaseService(gitService, projectPath)
      setResult(await releaseService.publishCurrentProject({ version: normalized, releaseNotes: notes }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPublishing(false)
    }
  }

  const normalizedVersion = normalizeVersion(version)
  const canPublish = !loading && configured && !publishing && normalizedVersion !== null
  return <List navigationTitle="发布 Release" toolbar={{ topBarLeading: <CloseButton /> }}>
    {errorMessage ? <ErrorSection message={errorMessage} /> : null}
    {loading ? <LoadingSection message="正在读取 Release 配置…" /> : null}
    <Section>
      <VStack spacing={tokens.rowContentSpacing} alignment="leading">
        <Text font="headline">版本号</Text>
        <TextField title="版本号" value={version} onChanged={setVersion} prompt="1.0.1" />
        <Text font="headline">更新说明</Text>
        <TextField title="更新说明" value={notes} onChanged={setNotes} axis="vertical" prompt="本次更新内容" />
      </VStack>
    </Section>
    <Section>
      <VStack spacing={tokens.compactSpacing} alignment="leading">
        <Text font="subheadline">当前 Commit</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" monospaced>{commitOid || "—"}</Text>
        <Text font="subheadline">GitHub 仓库</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">{repository || "尚未配置"}</Text>
      </VStack>
    </Section>
    <Section>
      <Button title={publishing ? "发布中…" : "发布到 GitHub"} systemImage="arrow.up.circle" buttonStyle="borderedProminent" disabled={!canPublish} action={publish} frame={{ minHeight: tokens.buttonHeight }} />
    </Section>
    {result ? <Section header={<Text>发布成功</Text>}><VStack spacing={6} alignment="leading"><Text font="subheadline">{`Source Control ${result.version}`}</Text><Text font="caption" foregroundStyle="secondaryLabel">ZIP：{result.assetName}</Text><Button title="查看 Release" action={async () => { await Safari.openURL(result.releaseUrl) }} /><Button title="复制下载链接" action={async () => { await Pasteboard.setString(result.assetUrl); await Dialog.alert({ title: "下载链接已复制", message: "" }) }} /></VStack></Section> : null}
  </List>
}

export default SourceControlReleaseView
