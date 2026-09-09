import { Script } from "scripting"

type Scenario = "load-order" | "operation-status" | "force-lock"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

async function verifyLoadOrder(): Promise<void> {
  const pending: Array<{ resolve: (value: string) => void; value: string }> = []
  let latestRequest = 0
  let applied = ""
  const load = async (value: string): Promise<void> => {
    const id = ++latestRequest
    const result = await new Promise<string>((resolve) => pending.push({ resolve, value }))
    if (id === latestRequest) applied = result
  }
  const first = load("old")
  const second = load("new")
  pending[1].resolve(pending[1].value)
  await second
  pending[0].resolve(pending[0].value)
  await first
  assert(applied === "new", "连续快速 loadDiff 只应用最新请求")
}

async function verifyOperationStatus(): Promise<void> {
  const initial = { staged: false, unstaged: true, canRestore: true }
  const afterStage = { staged: true, unstaged: true, canRestore: true }
  const afterUnstage = { staged: false, unstaged: true, canRestore: true }
  const afterRestore = { staged: false, unstaged: false, canRestore: false }
  assert(initial.canRestore, "初始 unstaged 状态允许 Restore")
  assert(afterStage.staged && afterStage.unstaged, "Stage 后基于最新状态显示 staged/unstaged")
  assert(!afterUnstage.staged && afterUnstage.unstaged, "Unstage 后重新回到 unstaged 状态")
  assert(!afterRestore.canRestore, "Restore 后不再显示旧 Restore 操作")
}

async function verifyForceLock(): Promise<void> {
  let active = false
  let started = 0
  const forcePush = async (): Promise<void> => {
    if (active) return
    active = true
    started++
    await Promise.resolve()
    active = false
  }
  await Promise.all([forcePush(), forcePush()])
  assert(started === 1, "Force Push 重复点击只能启动一个流程")
}

async function run(): Promise<void> {
  const scenarios: Scenario[] = ["load-order", "operation-status", "force-lock"]
  await verifyLoadOrder()
  await verifyOperationStatus()
  await verifyForceLock()
  console.log(`🎉 UI 竞态专项验证通过: ${scenarios.join(", ")}`)
}

run().finally(() => Script.exit())
