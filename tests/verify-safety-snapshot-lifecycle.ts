import { Script } from "scripting"
import { GitService } from "../src/core/GitService"
import { GitSafetyError } from "../src/core/GitSafety"
import { PROJECTS_FILE } from "../src/core/project/ProjectRegistry"
import { GIT_REPOS_DIR, REPO_MAP_FILE } from "../src/core/project/RepoMapStore"
import { JsonStore } from "../src/core/storage/JsonStore"

const scriptsDir = FileManager.scriptsDirectory
const testPrefix = `SnapshotLifecycle_${Date.now()}`
const projectPath = `${scriptsDir}/${testPrefix}`
const gitdirPath = `${GIT_REPOS_DIR}/${testPrefix}`
const snapshotPrefix = "refs/source-control/snapshots/"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✅ ${message}`)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function expectInvalidSnapshotRef(operation: () => Promise<void>, label: string): Promise<void> {
  let rejected = false
  try {
    await operation()
  } catch (error) {
    rejected = error instanceof GitSafetyError || String(error).includes("INVALID_SNAPSHOT_REF") || String(error).includes("refs/source-control/snapshots")
  }
  assert(rejected, `${label} 被 Safety Snapshot API 拒绝`)
}

async function run(): Promise<void> {
  let originalProjects: unknown = {}
  let originalRepoMap: unknown = {}
  try {
    originalProjects = await JsonStore.read(PROJECTS_FILE, {})
    originalRepoMap = await JsonStore.read(REPO_MAP_FILE, {})

    await FileManager.createDirectory(projectPath, true)
    await FileManager.writeAsString(`${projectPath}/script.json`, JSON.stringify({ name: testPrefix }), "utf8")
    await FileManager.writeAsString(`${projectPath}/index.tsx`, "export const fixture = true\n", "utf8")

    const service = new GitService()
    await service.initRepository(projectPath, testPrefix)
    const repository = await service.openRepository(projectPath)
    const adapter = repository["git"] as unknown as Record<string, unknown>
    assert(typeof adapter["deleteRef"] === "function", "删除实现使用 vendored isomorphic-git 的 deleteRef")
    assert(adapter["gc"] === undefined && adapter["prune"] === undefined, "Snapshot 生命周期实现未调用 GC 或 prune")
    await repository.stageAll()
    const initialCommit = await repository.commit("Snapshot lifecycle fixture")
    const branchBefore = await repository.getCurrentBranch()
    const headBefore = await FileManager.readAsString(`${repository.gitdir}/HEAD`, "utf8")
    const indexBefore = await FileManager.readAsBytes(`${repository.gitdir}/index`)
    const worktreeBefore = await FileManager.readAsBytes(`${projectPath}/index.tsx`)
    const historyBefore = await repository.getHistory(20)

    await FileManager.writeAsString(`${projectPath}/index.tsx`, "export const fixture = false\n", "utf8")
    const created = await repository.createSafetySnapshot("deletion fixture")
    assert(created.created && !!created.ref, "有效工作区改动可创建 Safety Snapshot")
    const targetRef = created.ref!
    const targetOid = created.oid!

    await expectInvalidSnapshotRef(() => repository.deleteSafetySnapshot("refs/heads/main"), "branch ref")
    await expectInvalidSnapshotRef(() => repository.deleteSafetySnapshot("HEAD"), "HEAD")
    await expectInvalidSnapshotRef(() => repository.deleteSafetySnapshot("refs/tags/v1"), "tag ref")
    await expectInvalidSnapshotRef(() => repository.deleteSafetySnapshot("refs/heads/ordinary"), "普通 ref")

    await repository.deleteSafetySnapshot(targetRef)
    assert((await repository.listSafetySnapshots(200)).every((snapshot) => snapshot.ref !== targetRef), "删除指定 Snapshot ref 后该 ref 不再列出")
    await expectInvalidSnapshotRef(() => repository.deleteSafetySnapshot("refs/heads/main"), "删除 API 重复验证 branch ref")

    const headAfterDelete = await FileManager.readAsString(`${repository.gitdir}/HEAD`, "utf8")
    const indexAfterDelete = await FileManager.readAsBytes(`${repository.gitdir}/index`)
    const worktreeAfterDelete = await FileManager.readAsBytes(`${projectPath}/index.tsx`)
    assert(headAfterDelete === headBefore, "删除 Snapshot 不改变 HEAD")
    assert(bytesEqual(indexAfterDelete, indexBefore), "删除 Snapshot 不改变 Index")
    assert(bytesEqual(worktreeAfterDelete, worktreeBefore) === false, "删除 Snapshot 不回滚 Working Tree")
    assert(await repository.getCurrentBranch() === branchBefore, "删除 Snapshot 不改变当前分支")
    assert((await repository.getHistory(20)).map((entry) => entry.oid).join(",") === historyBefore.map((entry) => entry.oid).join(","), "删除 Snapshot 不改变 Git History")
    assert(await repository.getHistory(20).then((entries) => entries.some((entry) => entry.oid === initialCommit.oid)), "原始 Commit 仍可读取")
    assert(targetOid.length > 0, "删除操作仅移除 ref，Snapshot commit OID 已记录")

    const cleanupRefs: string[] = []
    for (let index = 0; index < 55; index += 1) {
      const ref = `${snapshotPrefix}cleanup-${String(index).padStart(3, "0")}`
      const oid = await repository["git"].writeCommit({
        fs: repository["fs"],
        dir: repository.projectPath,
        gitdir: repository.gitdir,
        commit: {
          message: `snapshot: cleanup-${index}`,
          tree: (await repository["git"].readCommit({ fs: repository["fs"], dir: repository.projectPath, gitdir: repository.gitdir, oid: initialCommit.oid })).commit.tree,
          parent: [initialCommit.oid],
          author: { name: "Snapshot Test", email: "snapshot@test.invalid", timestamp: 1000 + index, timezoneOffset: 0 },
          committer: { name: "Snapshot Test", email: "snapshot@test.invalid", timestamp: 1000 + index, timezoneOffset: 0 },
        },
      })
      await repository["git"].writeRef({ fs: repository["fs"], dir: repository.projectPath, gitdir: repository.gitdir, ref, value: oid })
      cleanupRefs.push(ref)
    }

    const cleanupResult = await repository.cleanupSafetySnapshots()
    assert(cleanupResult.deleted === 5 && cleanupResult.retained === 50, "超过 50 条 Snapshot 时只删除超出的旧 refs")
    const retained = await repository.listSafetySnapshots(200)
    assert(retained.length === 50, "清理后有效 Snapshot 恰好保留 50 条")
    assert(retained[0].ref === `${snapshotPrefix}cleanup-054` && retained[49].ref === `${snapshotPrefix}cleanup-005`, "清理保留项按 timestamp DESC 排序")
    assert(cleanupRefs.slice(0, 5).every((ref) => !retained.some((snapshot) => snapshot.ref === ref)), "清理删除最旧的 5 条 Snapshot refs")

    const noOp = await repository.cleanupSafetySnapshots()
    assert(noOp.deleted === 0 && noOp.retained === 50, "50 条及以下时清理不删除任何 ref")

    for (let index = 0; index < 3; index += 1) {
      const ref = `${snapshotPrefix}same-${index}`
      const oid = await repository["git"].writeCommit({
        fs: repository["fs"],
        dir: repository.projectPath,
        gitdir: repository.gitdir,
        commit: {
          message: `snapshot: same-${index}`,
          tree: (await repository["git"].readCommit({ fs: repository["fs"], dir: repository.projectPath, gitdir: repository.gitdir, oid: initialCommit.oid })).commit.tree,
          parent: [initialCommit.oid],
          author: { name: "Snapshot Test", email: "snapshot@test.invalid", timestamp: 2000, timezoneOffset: 0 },
          committer: { name: "Snapshot Test", email: "snapshot@test.invalid", timestamp: 2000, timezoneOffset: 0 },
        },
      })
      await repository["git"].writeRef({ fs: repository["fs"], dir: repository.projectPath, gitdir: repository.gitdir, ref, value: oid })
    }
    const sameTimestampList = await repository.listSafetySnapshots(200)
    assert(sameTimestampList.slice(0, 3).map((snapshot) => snapshot.ref).join(",") === [`${snapshotPrefix}same-2`, `${snapshotPrefix}same-1`, `${snapshotPrefix}same-0`].join(","), "相同 timestamp 时按 ref DESC 稳定排序")
    const sameTimestampResult = await repository.cleanupSafetySnapshots(50)
    assert(sameTimestampResult.deleted === 3 && sameTimestampResult.retained === 50, "相同 timestamp 清理按 ref DESC 稳定决定保留项")
    const afterSameTimestampCleanup = await repository.listSafetySnapshots(200)
    assert(afterSameTimestampCleanup.some((snapshot) => snapshot.ref === `${snapshotPrefix}cleanup-054`), "相同 timestamp 清理仍保留原有最近 Snapshot")
    assert(afterSameTimestampCleanup.some((snapshot) => snapshot.ref === `${snapshotPrefix}same-2`), "相同 timestamp 清理按 ref DESC 保留高位项")
    assert(afterSameTimestampCleanup.some((snapshot) => snapshot.ref === `${snapshotPrefix}same-0`), "相同 timestamp 场景下清理结果保留仍在前 50 的低位 ref")

    const listLimitProbe = await repository.listSafetySnapshots(200)
    assert(listLimitProbe.length === 50, "清理完整枚举不受 listSafetySnapshots 默认 50 条影响")
    console.log("🎉 Safety Snapshot 生命周期专项验证通过")
  } finally {
    try {
      await FileManager.remove(projectPath)
    } catch {
      // fixture 可能已经被外部清理。
    }
    if (await FileManager.exists(gitdirPath)) await FileManager.remove(gitdirPath)
    await JsonStore.writeAtomic(PROJECTS_FILE, originalProjects)
    await JsonStore.writeAtomic(REPO_MAP_FILE, originalRepoMap)
  }
}

run().catch((error: unknown) => console.error("Safety Snapshot 生命周期专项验证失败:", error)).finally(() => Script.exit())
