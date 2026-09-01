import { Script } from "scripting"
import { GitService } from "./src/core/GitService"

const path = `${FileManager.scriptsDirectory}/Source Control Empty Repository Test-${Date.now()}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/index.tsx`, "export default {}\n", "utf8")
  await FileManager.writeAsString(`${path}/script.json`, "{}\n", "utf8")

  const service = new GitService()
  await service.initRepository(path, `empty-repository-${Date.now()}`)
  await service.openRepository(path)

  const initialHistory = await service.getHistory()
  assert(initialHistory.length === 0, "unborn repository 的 History 应为空")

  const initialStatus = await service.getStatus()
  assert(!initialStatus.isClean, "含项目文件的 unborn repository 不应为 clean")
  assert(initialStatus.unstagedChanges.length === 2, "应显示两个未跟踪文件")
  for (const filepath of ["index.tsx", "script.json"]) {
    const change = initialStatus.unstagedChanges.find((item) => item.filepath === filepath)
    assert(change?.status === "untracked" && change.worktreeStatus === "untracked", `${filepath} 应为 untracked`)
  }

  const untrackedDiff = await service.getFileDiff("index.tsx", "unstaged")
  assert(untrackedDiff.additions === 1 && untrackedDiff.deletions === 0, "untracked 文件应显示 Added Diff")

  await service.stageFile("index.tsx")
  const stagedDiff = await service.getFileDiff("index.tsx", "staged")
  assert(stagedDiff.additions === 1 && stagedDiff.deletions === 0, "首次暂存文件应显示 Added Diff")
  const stagedStatus = await service.getStatus()
  const staged = stagedStatus.stagedChanges.find((item) => item.filepath === "index.tsx")
  assert(staged?.status === "added" && staged.indexStatus === "added", "首次暂存应显示 added")

  await service.unstageFile("index.tsx")
  const unstagedStatus = await service.getStatus()
  const unstaged = unstagedStatus.unstagedChanges.find((item) => item.filepath === "index.tsx")
  assert(unstaged?.status === "untracked" && !unstaged.staged, "首次取消暂存应恢复 untracked")

  await service.stageFile("index.tsx")
  await service.stageFile("script.json")
  const commit = await service.commit("Initial commit")
  assert(commit.oid.length === 40, "首次 Commit 应返回完整 oid")
  const history = await service.getHistory()
  assert(history.length === 1 && history[0].oid === commit.oid, "首次 Commit 后 History 应有一条记录")
  const cleanStatus = await service.getStatus()
  assert(cleanStatus.isClean, "全部文件首次 Commit 后工作区应 clean")

  Script.exit({ ok: true, scenarios: ["unborn-status", "untracked", "unstaged-diff", "stage", "staged-diff", "unstage", "initial-commit", "history"] })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
