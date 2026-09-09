import { Script } from "scripting"
import { GitRepository } from "../src/core/GitRepository"
import { GitRemoteCredential, IsomorphicGitAdapter } from "../src/core/types"

const remoteName = "origin"
const trackingPrefix = `refs/remotes/${remoteName}/`

type FetchOptions = Parameters<IsomorphicGitAdapter["fetch"]>[0]
type ListRefsOptions = Parameters<IsomorphicGitAdapter["listRefs"]>[0]
type ListServerRefsOptions = Parameters<IsomorphicGitAdapter["listServerRefs"]>[0]
type ResolveRefOptions = Parameters<IsomorphicGitAdapter["resolveRef"]>[0]
type DeleteRefOptions = Parameters<IsomorphicGitAdapter["deleteRef"]>[0]
type FetchResult = {
  defaultBranch: string | null
  fetchHead: string | null
  fetchHeadDescription: string | null
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

class FetchPruneFixture {
  readonly remoteBranches = new Map<string, string>([
    ["main", "oid-main"],
    ["stale", "oid-stale"],
  ])
  readonly protectedRefs = new Set(["HEAD", "refs/heads/main", "refs/tags/release", "refs/ordinary"])
  readonly deletedRefs: string[] = []
  readonly serverRefCalls: ListServerRefsOptions[] = []
  fetchOptions: FetchOptions | null = null

  constructor(private readonly fetchHead: string | null, private readonly serverBranches: string[] = []) {}

  adapter(): IsomorphicGitAdapter {
    const fixture = this
    return {
      listRemotes: async () => [{ remote: remoteName, url: "https://example.invalid/source-control.git" }],
      fetch: async (options: FetchOptions): Promise<FetchResult> => {
        fixture.fetchOptions = options
        // 模拟 vendored fetch：非空远端由原生 prune 删除 stale，空远端保留以覆盖其提前返回边界。
        if (options.prune === true && fixture.fetchHead !== null && fixture.remoteBranches.delete("stale")) {
          fixture.deletedRefs.push(`${trackingPrefix}stale`)
        }
        return { defaultBranch: "refs/heads/main", fetchHead: fixture.fetchHead, fetchHeadDescription: null }
      },
      listRefs: async (options: ListRefsOptions) => {
        if (options.filepath !== `refs/remotes/${remoteName}`) return []
        return [...fixture.remoteBranches.keys(), "HEAD", "feature/HEAD"]
      },
      resolveRef: async (options: ResolveRefOptions) => {
        const branch = options.ref.startsWith(trackingPrefix) ? options.ref.slice(trackingPrefix.length) : ""
        const oid = fixture.remoteBranches.get(branch)
        if (!oid) throw new Error(`missing ref: ${options.ref}`)
        return oid
      },
      listServerRefs: async (options: ListServerRefsOptions) => {
        fixture.serverRefCalls.push(options)
        return fixture.serverBranches.map((branch, index) => ({ ref: `refs/heads/${branch}`, oid: `server-oid-${index}` }))
      },
      deleteRef: async (options: DeleteRefOptions) => {
        fixture.deletedRefs.push(options.ref)
        if (options.ref.startsWith(trackingPrefix)) fixture.remoteBranches.delete(options.ref.slice(trackingPrefix.length))
      },
    } as unknown as IsomorphicGitAdapter
  }

  repository(): GitRepository {
    const repository = new GitRepository("/fixture/source-control", "/fixture/gitdir", this.adapter(), {})
    // 测试不读取真实 Keychain；Fetch 行为本身不依赖 credential。
    const internals = repository as unknown as {
      getRemoteCredential: (name: string) => Promise<GitRemoteCredential | null>
    }
    internals.getRemoteCredential = async (_name: string) => null
    return repository
  }
}

async function verifyNativePrune(): Promise<void> {
  const fixture = new FetchPruneFixture("oid-main")
  const result = await fixture.repository().fetchRemote(remoteName)
  const options = fixture.fetchOptions
  assert(options !== null && options.prune === true, "fetchRemote 向全量 Fetch 传入 prune: true")
  const rawOptions = options as unknown as Record<string, unknown>
  assert(!Object.prototype.hasOwnProperty.call(rawOptions, "pruneTags"), "全量 Fetch 未启用 pruneTags")
  assert(fixture.serverRefCalls.length === 0, "正常非空远端不额外请求服务器 refs")
  assert(!fixture.remoteBranches.has("stale") && fixture.remoteBranches.has("main"), "原生 prune 清理已删除分支并保留现存分支")
  assert(result.branch === "main" && result.fetched, "Fetch 后 listRemoteBranches 返回当前远端分支")
  assert(fixture.deletedRefs.every((ref) => ref.startsWith(trackingPrefix)), "原生 prune 的删除目标仅在当前 remote-tracking namespace")
  assert(fixture.deletedRefs.every((ref) => ref !== "HEAD" && !ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")), "原生 prune 不删除 HEAD、本地 branches 或 tags")
  const branches = await fixture.repository().listRemoteBranches(remoteName)
  assert(branches.length === 1 && branches[0].name === "main", "listRemoteBranches 排除 remote HEAD 及嵌套 HEAD")
}

async function verifyEmptyRemoteFallback(): Promise<void> {
  const fixture = new FetchPruneFixture(null)
  const repository = fixture.repository()
  await repository.fetchRemote(remoteName)
  assert(fixture.serverRefCalls.length === 1 && fixture.serverRefCalls[0].prefix === "refs/heads/", "完全空远端使用 refs/heads/ 查询兜底")
  assert(fixture.remoteBranches.size === 0, "完全空远端兜底清理全部旧 remote-tracking refs")
  assert(fixture.deletedRefs.length === 2 && fixture.deletedRefs.every((ref) => ref.startsWith(trackingPrefix)), "空远端兜底只删除当前 remote-tracking refs")
  assert(fixture.deletedRefs.every((ref) => !fixture.protectedRefs.has(ref)), "空远端兜底不删除 HEAD、branches、tags 或普通 refs")
  assert((await repository.listRemoteBranches(remoteName)).length === 0, "清理后 listRemoteBranches 不返回陈旧分支")
}

async function run(): Promise<void> {
  await verifyNativePrune()
  await verifyEmptyRemoteFallback()
  console.log("🎉 Fetch 后远端分支清理专项验证通过")
}

run().catch((error: unknown) => console.error("Fetch 后远端分支清理专项验证失败:", error)).finally(() => Script.exit())
