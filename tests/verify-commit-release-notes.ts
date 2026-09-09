import { Script } from "scripting"
import { validateCommitTitle, COMMIT_MESSAGE_MAX_LENGTH } from "../src/ui/commitMessage"
import { getReleaseNotes, releaseNotesStorageKey, setReleaseNotes } from "../src/ui/releaseNotesStorage"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

async function run(): Promise<void> {
  const short = validateCommitTitle("  Fix commit flow  ")
  assert(short.error === null && short.value === "Fix commit flow", "短标题通过并 trim 首尾空白")
  assert(validateCommitTitle("").error === "empty", "空标题被拒绝")
  assert(validateCommitTitle("title\nbody").error === "multiline", "多行标题被拒绝")
  assert(validateCommitTitle("x".repeat(COMMIT_MESSAGE_MAX_LENGTH)).error === null, "72 个 Unicode 字符通过")
  assert(validateCommitTitle("x".repeat(COMMIT_MESSAGE_MAX_LENGTH + 1)).error === "too-long", "73 个 Unicode 字符被拒绝")
  assert(validateCommitTitle("界".repeat(COMMIT_MESSAGE_MAX_LENGTH)).error === null, "Unicode 字符按 code point 计数")
  assert(validateCommitTitle("😀".repeat(COMMIT_MESSAGE_MAX_LENGTH)).error === null, "emoji 按 Unicode code point 计数")

  const projectA = "/tmp/source-control-release-notes-a"
  const projectB = "/tmp/source-control-release-notes-b"
  setReleaseNotes(projectA, "Release A\n- details")
  setReleaseNotes(projectB, "Release B")
  assert(getReleaseNotes(projectA) === "Release A\n- details", "Release Notes 可以保存并重新读取")
  assert(getReleaseNotes(projectB) === "Release B", "不同项目的 Release Notes 可以分别读取")
  assert(releaseNotesStorageKey(projectA) !== releaseNotesStorageKey(projectB), "不同项目使用隔离的 Storage key")
  assert(getReleaseNotes(`${projectA}/`) === "Release A\n- details", "路径末尾斜杠规范化后仍读取同一草稿")

  Script.exit({ ok: true, scenarios: ["commit-title-validation", "release-notes-storage"] })
}

run().catch((error: unknown) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
