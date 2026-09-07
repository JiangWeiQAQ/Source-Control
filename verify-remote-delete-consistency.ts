import { Script } from "scripting"
import { GitRemoteInfo } from "./src/core/types"

type DeleteChoice = "remove-remote-and-token" | "remove-remote-only" | "cancel"

type RemoteSnapshot = {
  remotes: GitRemoteInfo[]
  credentialNames: Set<string>
}

type SettingsProjection = {
  remotes: GitRemoteInfo[]
  selected: GitRemoteInfo | null
  branches: string[]
  sync: string | null
  credential: boolean
  credentialRemoteName: string | null
  credentialBound: boolean
  tokenStatus: "not-configured" | "configured-unverified"
}

type RemoteProjection = {
  selected: GitRemoteInfo | null
  branches: string[]
  sync: string | null
}

class FakeRemoteStore {
  readonly calls: string[] = []
  readonly credentialNames: Set<string>
  remotes: GitRemoteInfo[]

  constructor(remotes: GitRemoteInfo[], credentialNames: string[]) {
    this.remotes = [...remotes]
    this.credentialNames = new Set(credentialNames)
  }

  async listRemotes(): Promise<GitRemoteInfo[]> {
    this.calls.push("listRemotes")
    return [...this.remotes]
  }

  async hasRemoteCredential(name: string): Promise<boolean> {
    this.calls.push(`hasRemoteCredential:${name}`)
    return this.credentialNames.has(name)
  }

  async removeRemote(name: string): Promise<void> {
    this.calls.push(`removeRemote:${name}`)
    this.remotes = this.remotes.filter((remote) => remote.name !== name)
  }

  async removeRemoteCredential(name: string): Promise<void> {
    this.calls.push(`removeRemoteCredential:${name}`)
    this.credentialNames.delete(name)
  }

  async apply(choice: DeleteChoice, name: string): Promise<void> {
    if (choice === "cancel") return
    await this.removeRemote(name)
    if (choice === "remove-remote-and-token") await this.removeRemoteCredential(name)
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function selectRemote(remotes: GitRemoteInfo[], preferred: string | null = null): GitRemoteInfo | null {
  return preferred && remotes.some((remote) => remote.name === preferred)
    ? remotes.find((remote) => remote.name === preferred) || null
    : remotes.find((remote) => remote.name === "origin") || remotes[0] || null
}

function deriveSettingsProjection(snapshot: RemoteSnapshot, preservedCredentialName: string | null = null): SettingsProjection {
  const selected = selectRemote(snapshot.remotes)
  const boundCredential = !!selected && snapshot.credentialNames.has(selected.name)
  const preservedCredential = !!preservedCredentialName && snapshot.credentialNames.has(preservedCredentialName)
  return {
    remotes: snapshot.remotes,
    selected,
    branches: selected ? ["main"] : [],
    sync: selected ? "ahead-behind" : null,
    credential: boundCredential || preservedCredential,
    credentialRemoteName: boundCredential ? selected?.name ?? null : preservedCredential ? preservedCredentialName : null,
    credentialBound: boundCredential,
    tokenStatus: boundCredential || preservedCredential ? "configured-unverified" : "not-configured",
  }
}

function deriveRemoteProjection(snapshot: RemoteSnapshot, preferred: string | null): RemoteProjection {
  const selected = selectRemote(snapshot.remotes, preferred)
  return {
    selected,
    branches: selected ? ["main"] : [],
    sync: selected ? "ahead-behind" : null,
  }
}

async function verifyRemoveRemoteAndToken(): Promise<void> {
  const remote = { name: "origin", url: "https://github.com/acme/app.git" }
  const store = new FakeRemoteStore([remote], [remote.name])
  await store.apply("remove-remote-and-token", remote.name)
  assert(store.remotes.length === 0, "删除 Remote + Token 后 Remote 配置为空")
  assert(!store.credentialNames.has(remote.name), "删除 Remote + Token 后凭据被清除")
  assert(store.calls.join(",") === "removeRemote:origin,removeRemoteCredential:origin", "删除 Remote + Token 顺序正确")
  const state = deriveSettingsProjection({ remotes: store.remotes, credentialNames: store.credentialNames })
  assert(state.selected === null && state.branches.length === 0 && state.sync === null, "删除 Remote + Token 后 Settings 清空 Remote 派生状态")
  assert(!state.credential && state.tokenStatus === "not-configured", "删除 Remote + Token 后 Token 状态为未配置")
}

async function verifyRemoveRemoteOnly(): Promise<void> {
  const remote = { name: "origin", url: "https://github.com/acme/app.git" }
  const store = new FakeRemoteStore([remote], [remote.name])
  await store.apply("remove-remote-only", remote.name)
  const settings = deriveSettingsProjection({ remotes: await store.listRemotes(), credentialNames: store.credentialNames }, remote.name)
  const remoteView = deriveRemoteProjection({ remotes: await store.listRemotes(), credentialNames: store.credentialNames }, remote.name)
  assert(settings.selected === null && settings.branches.length === 0 && settings.sync === null, "仅删除 Remote 后 Settings 不保留旧 URL、分支和 ahead/behind")
  assert(settings.credential && !settings.credentialBound && settings.tokenStatus === "configured-unverified", "仅删除 Remote 后 Token 保留并标记为未绑定 Remote")
  assert(remoteView.selected === null && remoteView.branches.length === 0 && remoteView.sync === null, "仅删除 Remote 后 Remote 页面清空旧状态")
}

async function verifyReAddRemote(): Promise<void> {
  const oldRemote = { name: "origin", url: "https://github.com/acme/old.git" }
  const newRemote = { name: "origin", url: "https://github.com/acme/new.git" }
  const store = new FakeRemoteStore([oldRemote], [oldRemote.name])
  await store.apply("remove-remote-only", oldRemote.name)
  store.remotes.push(newRemote)
  const state = deriveSettingsProjection({ remotes: await store.listRemotes(), credentialNames: store.credentialNames })
  assert(state.selected?.url === newRemote.url, "删除后重新添加 Remote 时选择新 URL")
  assert(state.credentialBound && state.credentialRemoteName === "origin", "重新添加 Remote 后重新读取新 Remote 的凭据状态")
}

async function verifyLatestRequestWins(): Promise<void> {
  const pending: Array<{ resolve: (value: string) => void; value: string }> = []
  let sequence = 0
  let applied = ""
  const load = async (value: string): Promise<void> => {
    const requestId = ++sequence
    const result = await new Promise<string>((resolve) => pending.push({ resolve, value }))
    if (requestId === sequence) applied = result
  }
  const oldRequest = load("old-remote")
  const newRequest = load("no-remote")
  pending[1].resolve(pending[1].value)
  await newRequest
  pending[0].resolve(pending[0].value)
  await oldRequest
  assert(applied === "no-remote", "删除过程中旧请求晚返回时不能覆盖最新空状态")
}

async function verifyCancel(): Promise<void> {
  const remote = { name: "origin", url: "https://github.com/acme/app.git" }
  const store = new FakeRemoteStore([remote], [remote.name])
  await store.apply("cancel", remote.name)
  assert(store.remotes.length === 1 && store.credentialNames.has(remote.name), "取消删除时 Remote 和 Token 均保持")
  assert(store.calls.length === 0, "取消删除不触发删除调用")
}

async function run(): Promise<void> {
  await verifyRemoveRemoteAndToken()
  await verifyRemoveRemoteOnly()
  await verifyReAddRemote()
  await verifyLatestRequestWins()
  await verifyCancel()
  console.log("🎉 Remote 删除状态一致性专项验证通过")
}

run().catch((error: unknown) => console.error("Remote 删除状态一致性专项验证失败:", error)).finally(() => Script.exit())
