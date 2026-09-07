import { Script } from "scripting"
import { GitAheadBehind, GitCommitInfo, GitRemoteBranch, GitRemoteInfo } from "./src/core/types"
import { RemoteStatusService, createRemoteStatusLoader, readRemoteStatus } from "./src/ui/useRemoteStatus"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function remote(name: string, url: string): GitRemoteInfo {
  return { name, url }
}

function commit(): GitCommitInfo {
  return { oid: "a", shortOid: "a", message: "commit", authorName: "Tester", authorEmail: "tester@example.com", timestamp: 1, parentOids: [] }
}

class FakeService implements RemoteStatusService {
  remotes: GitRemoteInfo[]
  credentialNames: Set<string>
  currentBranch: string | null
  branchesByRemote: Record<string, GitRemoteBranch[]>
  history: GitCommitInfo[]
  aheadBehind: GitAheadBehind | null
  delay = 0

  constructor(remotes: GitRemoteInfo[], credentialNames: string[] = [], currentBranch = "main") {
    this.remotes = remotes
    this.credentialNames = new Set(credentialNames)
    this.currentBranch = currentBranch
    this.branchesByRemote = Object.fromEntries(remotes.map((item) => [item.name, [{ name: currentBranch, remote: item.name, ref: `refs/remotes/${item.name}/${currentBranch}`, oid: "remote" }]]))
    this.history = [commit()]
    this.aheadBehind = { localBranch: "main", remote: "origin", remoteBranch: "main", ahead: 1, behind: 0, diverged: false, localOid: "local", remoteOid: "remote" }
  }

  async listRemotes(): Promise<GitRemoteInfo[]> {
    if (this.delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.delay))
    return [...this.remotes]
  }

  async getCurrentBranch(_required: string = "current"): Promise<string | null> { return this.currentBranch }
  async getHistory(_limit?: number): Promise<GitCommitInfo[]> { return [...this.history] }
  async listRemoteBranches(remoteName?: string): Promise<GitRemoteBranch[]> { return remoteName ? [...(this.branchesByRemote[remoteName] || [])] : [] }
  async hasRemoteCredential(name: string): Promise<boolean> { return this.credentialNames.has(name) }
  async getAheadBehind(_remoteName?: string, _branchName?: string): Promise<GitAheadBehind> { if (!this.aheadBehind) throw new Error("no ahead/behind") ; return this.aheadBehind }
}

async function verifyBothPagesProjection(): Promise<void> {
  const service = new FakeService([
    remote("backup", "https://github.com/acme/backup.git"),
    remote("origin", "https://github.com/acme/app.git"),
  ], ["origin"])
  const settings = await readRemoteStatus(service, { includeLocalCommit: false })
  const remotePage = await readRemoteStatus(service, { includeLocalCommit: true })
  assert(settings.selected?.name === "origin" && remotePage.selected?.name === "origin", "Settings / Remote 使用相同的 origin fallback")
  assert(settings.branch === remotePage.branch && settings.aheadBehind?.ahead === remotePage.aheadBehind?.ahead, "Settings / Remote 分支与 ahead/behind 读取一致")
  assert(settings.credentialBound && remotePage.credentialBound === true, "Settings / Remote 对当前 Remote 的 credential 绑定判断一致")
  assert(!settings.hasLocalCommit && remotePage.hasLocalCommit, "hasLocalCommit 只在 Remote 页面按需读取")
}

async function verifyPreferredFallbackAndUnboundCredential(): Promise<void> {
  const service = new FakeService([remote("origin", "https://github.com/acme/app.git")], ["backup"])
  const state = await readRemoteStatus(service, { preferredRemoteName: "missing", preservedCredentialRemoteName: "backup" })
  assert(state.selected?.name === "origin", "不存在 preferred Remote 时回退到 origin")
  assert(state.credential && !state.credentialBound && state.credentialRemoteName === "backup", "仅删除 Remote 后保留未绑定 credential")
  const empty = new FakeService([])
  const emptyState = await readRemoteStatus(empty, { includeLocalCommit: true })
  assert(emptyState.selected === null && emptyState.branches.length === 0 && emptyState.aheadBehind === null, "无 Remote 时 selected、branches、ahead/behind 正确为空")
}

async function verifyRequestSequence(): Promise<void> {
  const loader = createRemoteStatusLoader()
  const oldService = new FakeService([remote("origin", "https://github.com/acme/old.git")])
  const newService = new FakeService([])
  const pending: Array<{ resolve: (value: RemoteStatusService) => void; service: RemoteStatusService }> = []
  const load = async (service: RemoteStatusService): Promise<ReturnType<typeof readRemoteStatus> | null> => {
    const requestId = loader.next()
    await new Promise<void>((resolve) => { pending.push({ resolve: () => resolve(), service }) })
    if (!loader.isCurrent(requestId)) return null
    return readRemoteStatus(service)
  }
  const oldRequest = load(oldService)
  const newRequest = load(newService)
  pending[1].resolve(newService)
  assert(loader.isCurrent(2), "新请求生成后 request sequence 指向最新请求")
  pending[0].resolve(oldService)
  const [oldResult] = await Promise.all([oldRequest, newRequest])
  assert(oldResult === null, "旧请求晚返回时被丢弃")
}

async function run(): Promise<void> {
  await verifyBothPagesProjection()
  await verifyPreferredFallbackAndUnboundCredential()
  await verifyRequestSequence()
  console.log("🎉 Remote 状态 helper 一致性与竞态专项验证通过")
}

run().catch((error: unknown) => console.error("Remote 状态 helper 专项验证失败:", error)).finally(() => Script.exit())
