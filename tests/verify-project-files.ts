import { Script } from "scripting"
import { enumerateProjectFilesWithReader, ProjectFileScanCancellationController, PROJECT_FILE_SCAN_CONCURRENCY, ProjectFileScanReader } from "../src/ui/projectFiles"

class FixtureReader implements ProjectFileScanReader {
  private readonly directories: Map<string, string[]>
  private readonly failures: Set<string>

  constructor(directories: Record<string, string[]>, failures: string[] = []) {
    this.directories = new Map(Object.entries(directories))
    this.failures = new Set(failures)
  }

  async readDirectory(path: string): Promise<string[]> {
    if (this.failures.has(path)) throw new Error(`read failed: ${path}`)
    return this.directories.get(path) || []
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.directories.has(path)
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

async function verifyNormalScan(): Promise<void> {
  const root = "/fixture/normal"
  const result = await enumerateProjectFilesWithReader(root, new FixtureReader({
    [root]: ["README.md", "src"],
    [`${root}/src`]: ["index.ts"],
  }))
  assert(result.files.length === 2, "正常扫描返回全部文件")
  assert(result.skippedDirectories.length === 0 && !result.hasPartialFailure, "正常扫描没有跳过目录")
}

async function verifySingleDirectoryFailure(): Promise<void> {
  const root = "/fixture/single-failure"
  const blocked = `${root}/blocked`
  const result = await enumerateProjectFilesWithReader(root, new FixtureReader({
    [root]: ["blocked", "after.txt"],
    [blocked]: [],
  }, [blocked]))
  assert(result.hasPartialFailure, "单目录读取失败标记为部分失败")
  assert(result.skippedDirectories.length === 1 && result.skippedDirectories[0] === blocked, "单目录失败记录目录路径")
  assert(result.files.length === 1 && result.files[0].relativePath === "after.txt", "单目录失败后仍返回其他文件")
}

async function verifyMultipleDirectoryFailures(): Promise<void> {
  const root = "/fixture/multiple-failures"
  const blockedA = `${root}/blocked-a`
  const blockedB = `${root}/blocked-b`
  const result = await enumerateProjectFilesWithReader(root, new FixtureReader({
    [root]: ["blocked-b", "keep", "blocked-a"],
    [blockedA]: [],
    [blockedB]: [],
    [`${root}/keep`]: ["kept.txt"],
  }, [blockedA, blockedB]))
  assert(result.hasPartialFailure, "多目录读取失败标记为部分失败")
  assert(result.skippedDirectories.length === 2, "多目录失败 skippedDirectories 数量正确")
  assert(result.files.length === 1 && result.files[0].relativePath === "keep/kept.txt", "多目录失败后其他目录文件仍返回")
}

async function verifyConcurrencyLimit(): Promise<void> {
  const root = "/fixture/concurrency"
  const directoryNames = Array.from({ length: PROJECT_FILE_SCAN_CONCURRENCY * 4 }, (_, index) => `dir-${index}`)
  const directories: Record<string, string[]> = {
    [root]: directoryNames,
  }
  for (const directoryName of directoryNames) directories[`${root}/${directoryName}`] = [`${directoryName}.txt`]

  let activeOperations = 0
  let maxActiveOperations = 0
  const reader: ProjectFileScanReader = {
    readDirectory: async (path) => {
      activeOperations += 1
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations)
      await Promise.resolve()
      try { return directories[path] || [] } finally { activeOperations -= 1 }
    },
    isDirectory: async (path) => {
      activeOperations += 1
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations)
      await Promise.resolve()
      try { return Object.prototype.hasOwnProperty.call(directories, path) } finally { activeOperations -= 1 }
    },
  }

  const result = await enumerateProjectFilesWithReader(root, reader)
  assert(maxActiveOperations > 1 && maxActiveOperations <= PROJECT_FILE_SCAN_CONCURRENCY, `扫描并发不超过 ${PROJECT_FILE_SCAN_CONCURRENCY}`)
  assert(result.files.length === directoryNames.length && result.files[0].relativePath === "dir-0/dir-0.txt", "受控并发仍返回完整且排序后的文件结果")
  assert(result.skippedDirectories.length === 0 && !result.hasPartialFailure, "受控并发不改变部分失败结果")
}

async function verifyCancellation(): Promise<void> {
  const root = "/fixture/cancellation"
  const directoryNames = Array.from({ length: PROJECT_FILE_SCAN_CONCURRENCY * 4 }, (_, index) => `dir-${index}`)
  const directories: Record<string, string[]> = { [root]: directoryNames }
  for (const directoryName of directoryNames) directories[`${root}/${directoryName}`] = [`${directoryName}.txt`]

  const controller = new ProjectFileScanCancellationController()
  const reader: ProjectFileScanReader = {
    readDirectory: async (path) => {
      if (path !== root) for (let index = 0; index < 8; index += 1) await Promise.resolve()
      return directories[path] || []
    },
    isDirectory: async (path) => Object.prototype.hasOwnProperty.call(directories, path),
  }

  const scan = enumerateProjectFilesWithReader(root, reader, controller.signal)
  await Promise.resolve()
  controller.abort()
  const result = await scan
  assert(result.files.length < directoryNames.length, "取消信号可以中止未完成的文件扫描")
  assert(result.skippedDirectories.length === 0 && !result.hasPartialFailure, "取消扫描不记录为部分失败")
}

async function run(): Promise<void> {
  await verifyNormalScan()
  await verifySingleDirectoryFailure()
  await verifyMultipleDirectoryFailures()
  await verifyConcurrencyLimit()
  await verifyCancellation()
  console.log("🎉 文件扫描专项验证通过")
}

run().catch((error: unknown) => console.error("文件扫描专项验证失败:", error)).finally(() => Script.exit())
