import { Script } from "scripting"
import { GitService } from "./src/core/GitService"

const projectPath = `${FileManager.scriptsDirectory}/Source Control Stage Test`
const trackedPath = `${projectPath}/tracked.txt`
const untrackedPath = `${projectPath}/untracked.txt`
const binaryPath = `${projectPath}/binary-review-test.bin`
const largePath = `${projectPath}/large-review-test.txt`

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  const git = new GitService()
  await git.openRepository(projectPath)
  // 归一化已有真实测试仓库状态，避免前次中断测试留下的暂存项影响断言。
  try {
    await git.unstageFile("tracked.txt")
  } catch {
    // 文件未暂存时无需处理。
  }
  await git.restoreFile("tracked.txt").catch(() => undefined)
  const baselineContent = await FileManager.readAsString(trackedPath, "utf8")
  await FileManager.writeAsString(trackedPath, `${baselineContent}modified working tree\n`, "utf8")
  if (!(await FileManager.exists(untrackedPath))) {
    await FileManager.writeAsString(untrackedPath, "new untracked content\n", "utf8")
  }
  const modifiedDiff = await git.getFileDiff("tracked.txt", "unstaged")
  assert(modifiedDiff.additions === 1 && modifiedDiff.deletions === 0, "modified diff 行数不正确")
  assert(modifiedDiff.hunks[0]?.lines.some((line) => line.text === "modified working tree" && line.kind === "addition"), "modified diff 缺少新增行")

  await git.stageFile("tracked.txt")
  const stagedDiff = await git.getFileDiff("tracked.txt", "staged")
  assert(stagedDiff.additions === 1 && stagedDiff.deletions === 0, "staged diff 行数不正确")
  await git.unstageFile("tracked.txt")

  const untrackedDiff = await git.getFileDiff("untracked.txt", "unstaged")
  assert(untrackedDiff.additions === 1 && untrackedDiff.deletions === 0, "untracked diff 行数不正确")
  await git.stageFile("untracked.txt")
  await git.unstageFile("untracked.txt")
  assert(await FileManager.exists(untrackedPath), "Unstage 不应删除 untracked 文件")

  let untrackedRestoreRejected = false
  try {
    await git.restoreFile("untracked.txt")
  } catch (error) {
    untrackedRestoreRejected = (error instanceof Error ? error.message : String(error)).includes("未跟踪文件不能通过 Restore 删除")
  }
  assert(untrackedRestoreRejected, "restoreFile 不应删除 untracked 文件")

  let unsafePathRejected = false
  try {
    await git.restoreFile("../outside.txt")
  } catch (error) {
    unsafePathRejected = (error instanceof Error ? error.message : String(error)).includes("路径包含不安全的向上遍历字符")
  }
  assert(unsafePathRejected, "Restore 未拒绝非法路径")

  const contentBeforeCancel = await FileManager.readAsString(trackedPath, "utf8")
  const statusBeforeCancel = JSON.stringify(await git.getStatus())
  assert(await FileManager.readAsString(trackedPath, "utf8") === contentBeforeCancel, "Cancel 模拟后文件发生变化")
  assert(JSON.stringify(await git.getStatus()) === statusBeforeCancel, "Cancel 模拟后 Git 状态发生变化")

  await git.restoreFile("tracked.txt")
  assert(await FileManager.readAsString(trackedPath, "utf8") === baselineContent, "默认 Restore 未恢复 tracked 文件")

  await FileManager.remove(trackedPath)
  const deletedDiff = await git.getFileDiff("tracked.txt", "unstaged")
  const expectedDeletedLines = baselineContent.endsWith("\n") ? baselineContent.split("\n").length - 1 : baselineContent.split("\n").length
  assert(deletedDiff.deletions === expectedDeletedLines && deletedDiff.additions === 0, "deleted diff 行数不正确")
  await git.restoreFile("tracked.txt")
  assert(await FileManager.readAsString(trackedPath, "utf8") === baselineContent, "Restore 未恢复 deleted 文件")

  await FileManager.writeAsBytes(binaryPath, new Uint8Array([0, 1, 2, 3]))
  const binaryDiff = await git.getFileDiff("binary-review-test.bin", "unstaged")
  assert(binaryDiff.isBinary && binaryDiff.message !== null, "binary 文件没有受到保护")

  await FileManager.writeAsString(largePath, "x".repeat(512 * 1024 + 1), "utf8")
  const largeDiff = await git.getFileDiff("large-review-test.txt", "unstaged")
  assert(largeDiff.isTooLarge && largeDiff.message === "File is too large to display diff.", "large 文件没有受到保护")

  await FileManager.remove(binaryPath)
  await FileManager.remove(largePath)
  const untrackedStillExists = await FileManager.exists(untrackedPath)
  assert(untrackedStillExists, "Restore 测试不应删除 untracked 文件")
  Script.exit({ ok: true, modified: modifiedDiff, untracked: untrackedDiff, deleted: deletedDiff, binary: binaryDiff.message, large: largeDiff.message })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
