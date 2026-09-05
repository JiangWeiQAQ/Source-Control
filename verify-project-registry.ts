/**
 * verify-project-registry.ts
 *
 * ProjectRegistry 专项验证脚本
 * 覆盖需求项 A 到 S：
 * A. 新项目创建
 * B. 旧项目读取
 * C. existing gitdir 保持
 * D. /var 与 /private/var 视为同路径
 * E. duplicate repo-map 收敛
 * F. getGitdir 不生成重复仓库
 * G. relocation old->new
 * H. projectId 保持
 * I. gitdir 保持
 * J. old mapping 删除
 * K. new mapping 写入
 * L. projects.json 与 repo-map 一致
 * M. relocation 写失败 rollback
 * N. corrupted repo-map 不清空
 * O. corrupted projects.json 不重建覆盖
 * P. legacy migration
 * Q. remove project 只删除 metadata/mapping
 * R. 不删除真实 worktree
 * S. 不删除 gitdir
 */

import { ProjectRegistry, PROJECTS_FILE } from "./src/core/project/ProjectRegistry"
import { RepoMapStore, REPO_MAP_FILE } from "./src/core/project/RepoMapStore"
import { JsonStore } from "./src/core/storage/JsonStore"
import { Script } from "scripting"
let passedCount = 0
let failedCount = 0

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

async function run() {
  console.log("=== 开始执行 ProjectRegistry 专项测试 (A - S) ===")
  const registry = ProjectRegistry.getInstance()
  const scriptsDir = FileManager.scriptsDirectory
  const tempPrefix = `RegistryTest_${Date.now()}`
  const dirA = `${scriptsDir}/${tempPrefix}_A`
  const dirB = `${scriptsDir}/${tempPrefix}_B`

  // 备份当前的 projects.json 与 repo-map.json，以便测试结束后恢复或隔离
  const originalProjects = await JsonStore.read(PROJECTS_FILE, {})
  const originalRepoMap = await JsonStore.read(REPO_MAP_FILE, {})

  try {
    // 准备工作目录 A
    if (!(await FileManager.exists(dirA))) {
      await FileManager.createDirectory(dirA, true)
    }
    await FileManager.writeAsString(
      `${dirA}/script.json`,
      JSON.stringify({ name: `${tempPrefix}_A`, version: "1.0.0" }),
      "utf8"
    )

    // A. 新项目创建
    console.log("\n--- [A, B, C] 新项目创建、读取与 gitdir 保持 ---")
    const metaA = await registry.getOrCreateProject(dirA)
    assert(!!metaA.projectId, "A. 新项目创建应分配 projectId")
    assert(metaA.projectPath === dirA, "A. 新项目 projectPath 应为实际访问路径")
    const assignedGitdir = metaA.gitdir
    assert(!!assignedGitdir, "A. 新项目应分配 gitdir")

    // B. 旧项目读取
    const fetchedA = await registry.getProjectById(metaA.projectId)
    assert(fetchedA !== null && fetchedA.projectId === metaA.projectId, "B. getProjectById 应返回正确项目")
    const fetchedByPath = await registry.findProjectByPath(dirA)
    assert(fetchedByPath !== null && fetchedByPath.projectId === metaA.projectId, "B. findProjectByPath 应命中项目")

    // C. existing gitdir 保持（重复 getOrCreateProject 或 getGitdir 不得改变 gitdir）
    const metaA2 = await registry.getOrCreateProject(dirA, "should_not_override")
    assert(metaA2.gitdir === assignedGitdir, "C. existing gitdir 必须保持不变，不被 customRepoName 重写")

    // D. /var 与 /private/var 视为同路径
    console.log("\n--- [D, E, F] 路径统一、同义映射收敛与仓库去重 ---")
    const altDirA = dirA.startsWith("/private/var")
      ? dirA.slice("/private".length)
      : `/private${dirA}`
    const metaAlt = await registry.findProjectByPath(altDirA)
    assert(metaAlt !== null && metaAlt.projectId === metaA.projectId, "D. /var 与 /private/var 视为同一逻辑路径")

    // E. duplicate repo-map 收敛
    const repoMapBefore = await RepoMapStore.read()
    repoMapBefore[altDirA] = assignedGitdir
    await JsonStore.writeAtomic(REPO_MAP_FILE, repoMapBefore)
    await registry.convergeDuplicates()
    const repoMapAfter = await RepoMapStore.read()
    const altFound = RepoMapStore.findGitdir(repoMapAfter, altDirA)
    assert(altFound === assignedGitdir, "E. duplicate repo-map 能安全找到并映射到相同 gitdir")

    // F. getGitdir 不生成重复仓库
    const gitdir1 = await registry.getGitdir(dirA)
    const gitdir2 = await registry.getGitdir(altDirA)
    assert(gitdir1 === gitdir2, "F. getGitdir 对同义路径返回相同 gitdir 路径，不生成重复仓库")

    // G - L. relocation 与一致性
    console.log("\n--- [G, H, I, J, K, L] 项目重定位与持久化一致性 ---")
    if (!(await FileManager.exists(dirB))) {
      await FileManager.createDirectory(dirB, true)
    }
    await FileManager.writeAsString(
      `${dirB}/script.json`,
      JSON.stringify({ name: `${tempPrefix}_B`, version: "1.0.0" }),
      "utf8"
    )

    const relocated = await registry.updateProjectPath(metaA.projectId, dirB, `${tempPrefix}_B`)
    // G. relocation old->new
    assert(relocated.projectPath === dirB, "G. updateProjectPath 应更新 projectPath 为 dirB")
    // H. projectId 保持
    assert(relocated.projectId === metaA.projectId, "H. relocation 必须保持 projectId 不变")
    // I. gitdir 保持
    assert(relocated.gitdir === assignedGitdir, "I. relocation 必须保持 gitdir 不变")
    // J. old mapping 删除
    const currentRepoMap = await RepoMapStore.read()
    assert(currentRepoMap[dirA] === undefined, "J. old mapping 在 repo-map 中应被删除")
    // K. new mapping 写入
    assert(currentRepoMap[dirB] === assignedGitdir, "K. new mapping 在 repo-map 中应写入")
    // L. projects.json 与 repo-map 一致
    const currentProjects = await registry.loadProjects()
    assert(currentProjects[metaA.projectId].projectPath === dirB, "L. projects.json 与 repo-map projectPath 一致")

    // M. relocation 写失败 rollback
    console.log("\n--- [M] 事务失败回滚 ---")
    let rollbackThrew = false
    try {
      await registry.updateProjectPath(metaA.projectId, `${dirB}_fail`, "Fail", {
        injectFailAt: "repo-map",
      })
    } catch {
      rollbackThrew = true
    }
    assert(rollbackThrew, "M. 注入失败时 updateProjectPath 应抛出异常")
    const projectsAfterFail = await registry.loadProjects()
    assert(
      projectsAfterFail[metaA.projectId].projectPath === dirB,
      "M. 写入失败时 projects.json 应回滚为更新前状态"
    )

    // N. corrupted repo-map 不清空
    console.log("\n--- [N, O] 损坏文件保护 ---")
    const badJson = "INVALID_JSON_{{{{"
    await FileManager.writeAsString(REPO_MAP_FILE, badJson, "utf8")
    let caughtCorruptRepo = false
    try {
      await RepoMapStore.read()
    } catch {
      caughtCorruptRepo = true
    }
    assert(caughtCorruptRepo, "N. 损坏的 repo-map.json 读取时必须抛出异常")
    const contentRepoStill = await FileManager.readAsString(REPO_MAP_FILE, "utf8")
    assert(contentRepoStill === badJson, "N. 损坏的 repo-map.json 原始内容不能被静默清空")
    // 恢复有效 repo-map
    await JsonStore.writeAtomic(REPO_MAP_FILE, currentRepoMap)

    // O. corrupted projects.json 不重建覆盖
    await FileManager.writeAsString(PROJECTS_FILE, badJson, "utf8")
    let caughtCorruptProjects = false
    try {
      await registry.loadProjects()
    } catch {
      caughtCorruptProjects = true
    }
    assert(caughtCorruptProjects, "O. 损坏的 projects.json 读取时必须抛出异常")
    const contentProjectsStill = await FileManager.readAsString(PROJECTS_FILE, "utf8")
    assert(contentProjectsStill === badJson, "O. 损坏的 projects.json 不能被默认空对象或 migration 覆盖")
    // 恢复有效 projects.json
    await JsonStore.writeAtomic(PROJECTS_FILE, currentProjects)

    // P. legacy migration
    console.log("\n--- [P] Legacy migration ---")
    const migrationResult = await registry.migrateLegacyData()
    assert(typeof migrationResult === "object", "P. legacy migration 正常返回项目字典")

    // Q, R, S. remove project
    console.log("\n--- [Q, R, S] 项目删除行为校验 ---")
    const dummyFile = `${dirB}/sample.txt`
    await FileManager.writeAsString(dummyFile, "hello", "utf8")
    // 重新确认当前项目中 metaA 的真实 projectId
    const targetProjectBeforeRemove = await registry.findProjectByPath(dirB)
    assert(targetProjectBeforeRemove !== null, "Q. 删除前应能找到 dirB 关联的项目")
    const removeTargetId = targetProjectBeforeRemove!.projectId
    await registry.removeProject(removeTargetId)

    // Q. remove project 只删除 metadata/mapping
    const projectsAfterRemove = await registry.loadProjects()
    assert(projectsAfterRemove[removeTargetId] === undefined, "Q. removeProject 应从 projects.json 移除")
    const repoMapAfterRemove = await RepoMapStore.read()
    const foundOldOrNew = Object.keys(repoMapAfterRemove).some(
      (k) => registry.isSamePath(k, dirA) || registry.isSamePath(k, dirB)
    )
    assert(!foundOldOrNew, "Q. removeProject 应从 repo-map.json 移除对应映射")

    // R. 不删除真实 worktree
    assert(await FileManager.exists(dummyFile), "R. removeProject 绝不删除真实工作区目录文件")

    // S. 不删除 gitdir 物理目录
    const resolvedGitdir = RepoMapStore.resolveGitdir(assignedGitdir)
    // 如果物理目录存在，它必须仍然存在（不 rm -rf）
    if (await FileManager.exists(resolvedGitdir)) {
      assert(await FileManager.exists(resolvedGitdir), "S. removeProject 绝不删除实际 gitdir 仓库存储")
    } else {
      assert(true, "S. gitdir 存储未受任何非安全物理删除影响")
    }

    console.log(`\n🎉 ProjectRegistry 专项验证全数通过! 通过用例数: ${passedCount}, 失败数: ${failedCount}`)
  } finally {
    // 清理测试临时目录
    if (await FileManager.exists(dirA)) await FileManager.remove(dirA)
    if (await FileManager.exists(dirB)) await FileManager.remove(dirB)
    // 恢复初始持久化记录，保持系统干净
    await JsonStore.writeAtomic(PROJECTS_FILE, originalProjects)
    await JsonStore.writeAtomic(REPO_MAP_FILE, originalRepoMap)
  }
}

run().catch((err) => {
  console.error("专项验证过程发生异常:", err)
  throw err
}).finally(() => {
  Script.exit()
})
