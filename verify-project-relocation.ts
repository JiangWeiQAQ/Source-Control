import { Script } from "scripting"
import { GitService } from "./src/core/GitService"
import {
  ProjectMetadataManager,
  ensureProjectMetadata,
  tryAutoRelocateProject,
  findRelocationCandidates,
  manualRelocateProject,
} from "./src/core/ProjectMetadata"
import { recordSync, listSyncRecords, migrateSyncHistory } from "./src/core/GitSyncHistory"

const scriptsDir = FileManager.scriptsDirectory
const tempTestPrefix = "RelocateFixture_" + Date.now()
const testDirA = `${scriptsDir}/${tempTestPrefix}_A`
const testDirB = `${scriptsDir}/${tempTestPrefix}_B`
const testDirC = `${scriptsDir}/${tempTestPrefix}_C`

let passedCount = 0
let failedCount = 0
const testProjectIds: string[] = []
const testGitdirs: string[] = []

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failedCount++
    console.error(`❌ [FAIL] ${msg}`)
    throw new Error(msg)
  } else {
    passedCount++
    console.log(`✅ [PASS] ${msg}`)
  }
}

async function cleanup() {
  const fixturePaths = [testDirA, testDirB, testDirC, `${scriptsDir}/${tempTestPrefix}_Other`]
  try {
    await ProjectMetadataManager.cleanupProjectFixture(testProjectIds, fixturePaths, testGitdirs)
  } catch (error) {
    console.error("测试 fixture 元数据清理失败:", error)
  }
}

async function runTests() {
  console.log("=== 开始执行 Source Control 项目重定位与身份持久化验证 ===")
  await cleanup()

  try {
    // 准备测试项目 A
    await FileManager.createDirectory(testDirA, true)
    await FileManager.writeAsString(`${testDirA}/script.json`, JSON.stringify({ name: "RelocateTestProject" }), "utf8")
    await FileManager.writeAsString(`${testDirA}/index.tsx`, "console.log('hello world')\n", "utf8")
    await FileManager.writeAsString(`${testDirA}/README.md`, "# Relocate Test Project\n", "utf8")

    const gitService = new GitService()
    await gitService.initRepository(testDirA)
    const repoA = await gitService.openRepository(testDirA)

    // Stage and commit
    await repoA.stageFile("script.json")
    await repoA.stageFile("README.md")
    const commitResult = await repoA.commit("Initial commit for relocation test", {
      name: "Test User",
      email: "test@example.com",
    })
    const commitOid = commitResult.oid

    // 设置 Remote 和 Credential
    await repoA.addRemote("origin", "https://github.com/example/relocate-test.git")
    await repoA.setRemoteCredential("origin", {
      username: "oauth2",
      password: "secret_token_123456",
    })

    // 记录 Sync History
    const originalProjectId = repoA.projectId
    assert(!!originalProjectId, "B. 初始创建应获得稳定的 projectId")
    testProjectIds.push(originalProjectId)

    await recordSync(originalProjectId, {
      id: "sync_1",
      remoteName: "origin",
      branchName: "main",
      targetOid: commitOid,
      previousRemoteOid: undefined,
      syncedAt: Date.now(),
      commitsUploaded: 1,
      kind: "push",
    })

    const metaA = await ProjectMetadataManager.getOrCreateProject(testDirA)
    const initialGitdir = metaA.gitdir
    testGitdirs.push(initialGitdir)

    // 验证初始 repo-map 中包含 testDirA
    const initialRepoMap = await ProjectMetadataManager.readRepoMap()
    assert(initialRepoMap[testDirA] === initialGitdir, "初始 repo-map 应包含 testDirA -> gitdir 映射")

    console.log("--- 模拟场景：将 testDirA 改名/移动为 testDirB ---")
    await FileManager.rename(testDirA, testDirB)

    // A. 项目改名后自动识别
    const relocatedMeta = await tryAutoRelocateProject({
      projectId: originalProjectId,
      displayName: "RelocateTestProject",
      projectPath: testDirA,
      gitdir: initialGitdir,
      source: "legacy",
      lastKnownHeadOid: commitOid,
    }, scriptsDir)

    assert(relocatedMeta !== null, "A. 项目改名后应能自动识别并重定位")
    assert(relocatedMeta?.projectId === originalProjectId, "B. 重定位后 projectId 保持不变")
    assert(relocatedMeta?.gitdir === initialGitdir, "C. 重定位后 gitdir 保持不变")
    assert(relocatedMeta?.projectPath === testDirB, "重定位后 projectPath 更新为 testDirB")

    // D. History 保持
    const repoB = await gitService.openRepository(testDirB)
    const commits = await repoB.getHistory(5)
    assert(commits.length > 0 && commits[0].oid === commitOid, "D. 重定位后 Git History 完好保持")

    // E. Remote config 保持
    const remotes = await repoB.listRemotes()
    assert(remotes.some((r) => r.name === "origin" && r.url === "https://github.com/example/relocate-test.git"), "E. Remote config 保持")

    // F. Credential key 迁移/保持
    const cred = await repoB.getRemoteCredential("origin")
    assert(cred !== null && cred.password === "secret_token_123456", "F. Credential key 保持可用")

    // G. Sync history 保持
    const syncRecords = await listSyncRecords(originalProjectId, "origin", "main")
    assert(syncRecords.length > 0 && syncRecords[0].targetOid === commitOid, "G. Sync history 保持")

    // H. old path mapping 删除 & I. new path mapping 写入
    const updatedRepoMap = await ProjectMetadataManager.readRepoMap()
    assert(!updatedRepoMap[testDirA], "H. old path mapping 应被删除")
    assert(updatedRepoMap[testDirB] === initialGitdir, "I. new path mapping 应写入且指向同一 gitdir")

    // J. 不产生重复 picker entry
    const allProjects = await ProjectMetadataManager.loadProjects()
    const matchingEntries = Object.values(allProjects).filter((p) => p.gitdir === initialGitdir)
    assert(matchingEntries.length === 1, "J. 不产生重复 picker entry，只有一个项目指向该 gitdir")

    console.log("--- 模拟场景：多候选不自动猜 (K) ---")
    // 复制 testDirB 为 testDirC，使两处内容均匹配 commitOid
    // 首先让元数据中的路径变成一个不存在的路径 testDirGhost
    const testDirGhost = `${scriptsDir}/${tempTestPrefix}_Ghost`
    await FileManager.copyFile(testDirB, testDirC)

    const ambiguousCandidates = await findRelocationCandidates({
      projectId: originalProjectId,
      displayName: "RelocateTestProject",
      projectPath: testDirGhost,
      gitdir: initialGitdir,
      source: "legacy",
      lastKnownHeadOid: commitOid,
    }, scriptsDir)

    const strongMatches = ambiguousCandidates.filter((c) => c.score >= 60)
    assert(strongMatches.length >= 2, "此时应探测到多个强匹配候选")

    const ambiguousRelocate = await tryAutoRelocateProject({
      projectId: originalProjectId,
      displayName: "RelocateTestProject",
      projectPath: testDirGhost,
      gitdir: initialGitdir,
      source: "legacy",
      lastKnownHeadOid: commitOid,
    }, scriptsDir)
    assert(ambiguousRelocate === null, "K. 多候选时不自动猜，返回 null 等待用户手动选择")

    console.log("--- 模拟场景：手动重新关联 (L) ---")
    const manualResult = await manualRelocateProject(originalProjectId, testDirC, "RelocateManualC")
    assert(manualResult.projectPath === testDirC, "L. 手动重新关联成功并更新路径")

    console.log("--- 模拟场景：安全校验拦截 (M, N) ---")
    // M. 自动测试目录不能关联
    let mFailed = false
    try {
      await manualRelocateProject(originalProjectId, `${scriptsDir}/Source Control Snapshot Test-123`, "Test")
    } catch (err: any) {
      mFailed = true
      console.log(`已成功拦截自动测试目录关联: ${err.message}`)
    }
    assert(mFailed, "M. 自动测试目录不能关联")

    // N. 正式其他项目不能误绑定
    // 创建另一个项目 D
    const testDirOther = `${scriptsDir}/${tempTestPrefix}_Other`
    await FileManager.createDirectory(testDirOther, true)
    const otherMeta = await ProjectMetadataManager.getOrCreateProject(testDirOther)
    testProjectIds.push(otherMeta.projectId)

    let nFailed = false
    try {
      await manualRelocateProject(originalProjectId, testDirOther, "Hijack")
    } catch (err: any) {
      nFailed = true
      console.log(`已成功拦截绑定其他已管理项目: ${err.message}`)
    }
    assert(nFailed, "N. 正式其他项目不能误绑定")

    // 清理 testDirOther（统一由 finally cleanup 负责）

    console.log("--- 模拟场景：原子写入与回滚校验 (O, P) ---")
    // 验证 atomicWriteJson 的回滚特性
    const testFilePath = `${FileManager.appGroupDocumentsDirectory}/source-control-projects/test-atomic.json`
    await FileManager.writeAsString(testFilePath, "ORIGINAL_CONTENT", "utf8")

    let writeFailed = false
    try {
      // 传入非法的包含循环引用的对象强制 JSON.stringify 报错
      const cyclic: any = {}
      cyclic.self = cyclic
      await ProjectMetadataManager.atomicWriteJson(testFilePath, cyclic)
    } catch {
      writeFailed = true
    }
    const currentContent = await FileManager.readAsString(testFilePath, "utf8")
    assert(writeFailed && currentContent === "ORIGINAL_CONTENT", "O/P. 写入失败时原文件内容保持不变，确保原子性与安全回滚")
    await FileManager.remove(testFilePath)

    // 清理测试期间写入的测试项目元数据（统一由 finally cleanup 负责）

    console.log(`\n🎉 全部测试通过! 通过用例数: ${passedCount}, 失败数: ${failedCount}`)
  } finally {
    await cleanup()
  }
}

runTests().catch((e) => {
  console.error("验证过程发生未捕获异常:", e)
}).finally(() => {
  Script.exit()
})
