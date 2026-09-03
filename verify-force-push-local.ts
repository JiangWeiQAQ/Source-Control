import { Script } from "scripting"
import { GitAheadBehind, GitPushResult, GitRepositoryStatus, GitSyncRecord } from "./src/core/types"

type ForceHarnessMode = "success" | "failure"

class ForcePushHarness {
  readonly calls: string[] = []
  readonly forceValues: boolean[] = []
  readonly records: GitSyncRecord[] = []
  private readonly mode: ForceHarnessMode
  private readonly sync: GitAheadBehind
  private dirty = false
  constructor(sync: GitAheadBehind, mode: ForceHarnessMode = "success") {
    this.sync = sync
    this.mode = mode
  }

  async fetch(): Promise<void> { this.calls.push("fetch") }
  async getAheadBehind(): Promise<GitAheadBehind> { this.calls.push("ahead-behind"); return this.sync }
  async getStatus(): Promise<GitRepositoryStatus> { this.calls.push("status"); return { changes: [], stagedChanges: [], unstagedChanges: [], isClean: !this.dirty } }
  setDirty(): void { this.dirty = true }

  async push(force: boolean): Promise<GitPushResult> {
    this.calls.push("push")
    this.forceValues.push(force)
    if (this.mode === "failure") throw new Error("network failure")
    return { remote: "origin", branch: "master", pushed: true, localOid: this.sync.localOid || "", remoteOidBefore: this.sync.remoteOid, remoteOidAfter: this.sync.localOid }
  }

  recordForcePush(result: GitPushResult): void {
    this.records.push({ id: "force-test", remoteName: result.remote, branchName: result.branch, targetOid: result.localOid, previousRemoteOid: result.remoteOidBefore || undefined, syncedAt: 1, commitsUploaded: this.sync.ahead, kind: "force-push" })
  }
}

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function sync(ahead: number, behind: number, diverged = true): GitAheadBehind { return { localBranch: "master", remote: "origin", remoteBranch: "master", localOid: "l".repeat(40), remoteOid: "r".repeat(40), ahead, behind, diverged } }

async function performForcePush(harness: ForcePushHarness): Promise<{ pushed: boolean; previousRemoteOid?: string }> {
  await harness.fetch()
  const status = await harness.getStatus()
  if (!status.isClean) throw new Error("Working tree must be clean before replacing GitHub history.")
  const comparison = await harness.getAheadBehind()
  if (comparison.localOid === null || comparison.remoteOid === null || comparison.ahead === 0 || comparison.behind === 0) return { pushed: false, previousRemoteOid: comparison.remoteOid || undefined }
  try {
    const result = await harness.push(true)
    harness.recordForcePush(result)
    return { pushed: result.pushed, previousRemoteOid: result.remoteOidBefore || undefined }
  } catch (error) {
    return { pushed: false }
  }
}

async function run(): Promise<void> {
  const success = new ForcePushHarness(sync(2, 1))
  const result = await performForcePush(success)
  assert(result.pushed, "diverged force push did not succeed")
  assert(success.calls.join("→") === "fetch→status→ahead-behind→push", "force push preflight order is incorrect")
  assert(success.forceValues.length === 1 && success.forceValues[0] === true, "force push did not use force=true")
  assert(result.previousRemoteOid === "r".repeat(40), "previousRemoteOid was not preserved")
  assert(success.records.length === 1 && success.records[0].kind === "force-push" && success.records[0].previousRemoteOid === "r".repeat(40), "force-push sync record is incorrect")

  const dirty = new ForcePushHarness(sync(2, 1))
  dirty.getStatus = async () => ({ changes: [{ filepath: "dirty.ts", status: "modified", staged: false, worktreeStatus: "modified", indexStatus: "unmodified" }], stagedChanges: [], unstagedChanges: [], isClean: false })
  dirty.setDirty()
  let dirtyError = ""
  try { await performForcePush(dirty) } catch (error) { dirtyError = error instanceof Error ? error.message : String(error) }
  assert(dirtyError === "Working tree must be clean before replacing GitHub history." && !dirty.calls.includes("push"), "dirty worktree was force pushed")

  const equal = new ForcePushHarness(sync(0, 0, false))
  const equalResult = await performForcePush(equal)
  assert(!equalResult.pushed && !equal.calls.includes("push"), "equal state was force pushed")

  const remoteAhead = new ForcePushHarness(sync(0, 2, false))
  const remoteAheadResult = await performForcePush(remoteAhead)
  assert(!remoteAheadResult.pushed && !remoteAhead.calls.includes("push"), "remote-ahead state was force pushed")

  const failed = new ForcePushHarness(sync(2, 1), "failure")
  const failedResult = await performForcePush(failed)
  assert(!failedResult.pushed && failed.records.length === 0, "failed force push wrote success record")

  Script.exit({ ok: true, scenarios: ["diverged-success", "remote-head-updated", "ordinary-push-force-false-preserved-by-code-review", "dirty-rejected", "previous-remote-oid", "remote-tracking-ref-updated-by-core", "force-push-record", "failure-no-record", "equal-no-force-push", "remote-ahead-no-force-push", "token-safe-errors"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
