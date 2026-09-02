import { Script } from "scripting"
import { GitRepository } from "./src/core/GitRepository"
import { GitService } from "./src/core/GitService"
import { IsomorphicGitAdapter } from "./src/core/types"

type Internals = { projectPath: string; gitdir: string; git: IsomorphicGitAdapter; fs: unknown }
type RepoContext = { service: GitService; path: string; gitdir: string; repo: Internals; commits: string[] }
const root = `${FileManager.scriptsDirectory}/Source Control Restore Commit Test-${Date.now()}`

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }
async function waitForFilesystem(): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, 1100)) }
async function expectReject(action: () => Promise<unknown>, text: string): Promise<void> { try { await action() } catch (error) { assert(String(error).includes(text), `错误不包含 ${text}: ${String(error)}`); return } throw new Error(`未拒绝: ${text}`) }

async function createRepo(name: string): Promise<RepoContext> {
  const path = `${root}/${name}`; await FileManager.createDirectory(path, true)
  await FileManager.writeAsString(`${path}/modified.txt`, "A\n", "utf8"); await FileManager.writeAsString(`${path}/deleted.txt`, "A\n", "utf8")
  const service = new GitService(); const { gitdir } = await service.initRepository(path, `restore-commit-${Date.now()}-${name}`)
  await service.stageAll(); const a = (await service.commit("A")).oid
  await waitForFilesystem(); await FileManager.writeAsString(`${path}/modified.txt`, "B\n", "utf8"); await FileManager.writeAsString(`${path}/added.txt`, "B\n", "utf8"); await waitForFilesystem(); await service.stageAll(); const b = (await service.commit("B")).oid
  await waitForFilesystem(); await FileManager.writeAsString(`${path}/modified.txt`, "C\n", "utf8"); await FileManager.writeAsString(`${path}/multi.txt`, "C\n", "utf8"); await FileManager.remove(`${path}/deleted.txt`); await waitForFilesystem(); await service.stageAll(); const c = (await service.commit("C")).oid
  return { service, path, gitdir, repo: await service.openRepository(path) as unknown as Internals, commits: [a, b, c] }
}

async function createSingleCommit(name: string, files: Array<{ path: string; content: string }>): Promise<RepoContext> {
  const path = `${root}/${name}`; await FileManager.createDirectory(path, true)
  for (const file of files) { const parent = file.path.includes("/") ? `${path}/${file.path.slice(0, file.path.lastIndexOf("/"))}` : path; await FileManager.createDirectory(parent, true); await FileManager.writeAsString(`${path}/${file.path}`, file.content, "utf8") }
  const service = new GitService(); const { gitdir } = await service.initRepository(path, `restore-commit-${Date.now()}-${name}`); await service.stageAll(); const oid = (await service.commit("base")).oid
  return { service, path, gitdir, repo: await service.openRepository(path) as unknown as Internals, commits: [oid] }
}

async function capture(context: RepoContext) {
  const { repo, path, gitdir, service } = context
  const head = await repo.git.resolveRef({ fs: repo.fs, dir: path, gitdir, ref: "HEAD" }); const branch = await service.getCurrentBranch(); const branchRef = branch ? `refs/heads/${branch}` : null
  const branchOid = branchRef ? await repo.git.resolveRef({ fs: repo.fs, dir: path, gitdir, ref: branchRef }) : null
  const remoteOid = (await service.listRemoteBranches("origin").catch(() => [])).map((item) => `${item.ref}:${item.oid}`).sort()
  return { head, branch, branchOid, remoteOid, index: await FileManager.readAsBytes(`${gitdir}/index`), history: (await service.getHistory(100)).map((item) => item.oid), matrix: JSON.stringify(await repo.git.statusMatrix({ fs: repo.fs, dir: path, gitdir })), modified: await FileManager.readAsBytes(`${path}/modified.txt`) }
}

async function addLocalRemote(context: RepoContext): Promise<void> { await context.service.addRemote("origin", "https://example.test/repository.git"); await context.repo.git.writeRef({ fs: context.repo.fs, dir: context.path, gitdir: context.gitdir, ref: "refs/remotes/origin/master", value: context.commits[2], force: true }) }
async function writeTree(context: RepoContext, tree: Array<{ mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" }>): Promise<string> { return context.repo.git.writeTree({ fs: context.repo.fs, dir: context.path, gitdir: context.gitdir, tree }) }
async function writeCommit(context: RepoContext, tree: string, parents: string[]): Promise<string> { return context.repo.git.writeCommit({ fs: context.repo.fs, dir: context.path, gitdir: context.gitdir, commit: { message: "test merge target", tree, parent: parents, author: { name: "Test", email: "test@example.com", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 } } }) }

async function run(): Promise<void> {
  const main = await createRepo("main"); await addLocalRemote(main); const before = await capture(main); const result = await main.service.restoreCommitToWorkingTree(main.commits[1])
  assert(result.restored && result.oid === main.commits[1] && result.changedFiles === 3, `modified/added/deleted/multi 结果错误: ${JSON.stringify(result)}`)
  assert(await FileManager.readAsString(`${main.path}/modified.txt`, "utf8") === "B\n", "modified 未恢复"); assert(await FileManager.readAsString(`${main.path}/deleted.txt`, "utf8") === "A\n", "target 新增文件未恢复"); assert(!(await FileManager.exists(`${main.path}/multi.txt`)), "target 删除文件未恢复"); assert(await FileManager.exists(`${main.path}/added.txt`), "target 保留文件被误删")
  const after = await capture(main); assert(before.head === after.head && before.branch === after.branch && before.branchOid === after.branchOid, "HEAD 或 branch 改变"); assert(sameBytes(before.index, after.index), "Index 改变"); assert(JSON.stringify(before.remoteOid) === JSON.stringify(after.remoteOid), "remote ref 改变"); assert(JSON.stringify(before.history) === JSON.stringify(after.history), "History 改变"); assert(!(await main.service.getStatus()).isClean, "恢复后应为未暂存变更"); await expectReject(() => main.service.restoreCommitToWorkingTree(main.commits[0]), "Working tree must be clean")

  const rootRepo = await createRepo("root"); const rootResult = await rootRepo.service.restoreCommitToWorkingTree(rootRepo.commits[0]); assert(rootResult.restored && !(await FileManager.exists(`${rootRepo.path}/added.txt`)) && !(await FileManager.exists(`${rootRepo.path}/multi.txt`)), "root Commit 恢复失败")
  const mergeRepo = await createRepo("merge"); const mergeHead = await mergeRepo.repo.git.resolveRef({ fs: mergeRepo.repo.fs, dir: mergeRepo.path, gitdir: mergeRepo.gitdir, ref: "HEAD" }); const mergeHeadCommit = await mergeRepo.repo.git.readCommit({ fs: mergeRepo.repo.fs, dir: mergeRepo.path, gitdir: mergeRepo.gitdir, oid: mergeHead }); const mergeBaseCommit = await mergeRepo.repo.git.readCommit({ fs: mergeRepo.repo.fs, dir: mergeRepo.path, gitdir: mergeRepo.gitdir, oid: mergeRepo.commits[0] }); const mergeOid = await writeCommit(mergeRepo, mergeBaseCommit.commit.tree, [mergeHead, mergeRepo.commits[0]]); const mergeResult = await mergeRepo.service.restoreCommitToWorkingTree(mergeOid); assert(mergeResult.restored && mergeResult.changedFiles > 0 && await FileManager.readAsString(`${mergeRepo.path}/modified.txt`, "utf8") === "A\n", `merge Commit Tree 读取失败: ${JSON.stringify(mergeResult)}`)
  const noOp = await createRepo("noop"); const noOpResult = await noOp.service.restoreCommitToWorkingTree(noOp.commits[2]); assert(!noOpResult.restored && noOpResult.changedFiles === 0, "target == HEAD 未 no-op")

  const dirty = await createRepo("dirty"); await FileManager.writeAsString(`${dirty.path}/modified.txt`, "dirty\n", "utf8"); await expectReject(() => dirty.service.restoreCommitToWorkingTree(dirty.commits[0]), "Working tree must be clean")
  const staged = await createRepo("staged"); await FileManager.writeAsString(`${staged.path}/modified.txt`, "staged\n", "utf8"); await staged.service.stageAll(); await expectReject(() => staged.service.restoreCommitToWorkingTree(staged.commits[0]), "Working tree must be clean")
  const untracked = await createRepo("untracked"); await FileManager.writeAsString(`${untracked.path}/new.txt`, "new\n", "utf8"); await expectReject(() => untracked.service.restoreCommitToWorkingTree(untracked.commits[0]), "Working tree must be clean")
  await expectReject(() => noOp.service.restoreCommitToWorkingTree("bad"), "Commit OID 格式不合法"); await expectReject(() => noOp.service.restoreCommitToWorkingTree("0".repeat(40)), "指定的文件或引用不存在")

  const unsafe = await createRepo("unsafe"); const unsafeHead = await unsafe.repo.git.resolveRef({ fs: unsafe.repo.fs, dir: unsafe.path, gitdir: unsafe.gitdir, ref: "HEAD" }); const unsafeHeadCommit = await unsafe.repo.git.readCommit({ fs: unsafe.repo.fs, dir: unsafe.path, gitdir: unsafe.gitdir, oid: unsafeHead }); const unsafeOid = await writeCommit(unsafe, unsafeHeadCommit.commit.tree, [unsafeHead]); const unsafeAdapter = Object.create(unsafe.repo.git) as IsomorphicGitAdapter; const originalReadTree = unsafe.repo.git.readTree.bind(unsafe.repo.git); Object.defineProperty(unsafeAdapter, "readTree", { value: (options: { fs: unknown; dir: string; gitdir: string; oid: string; filepath?: string }) => options.oid === unsafeHeadCommit.commit.tree ? Promise.resolve({ tree: [{ mode: "100644", path: "../unsafe.txt", oid: "0".repeat(40), type: "blob" as const }] }) : originalReadTree(options), configurable: true }); const unsafeRepository = new GitRepository(unsafe.path, unsafe.gitdir, unsafeAdapter, unsafe.repo.fs); await expectReject(() => unsafeRepository.restoreCommitToWorkingTree(unsafeOid), "路径包含不安全的向上遍历字符")

  const fileToDirectory = await createSingleCommit("file-to-directory", [{ path: "foo", content: "file\n" }]); const nestedBlob = await fileToDirectory.repo.git.writeBlob({ fs: fileToDirectory.repo.fs, dir: fileToDirectory.path, gitdir: fileToDirectory.gitdir, blob: new Uint8Array([110, 101, 115, 116, 101, 100, 10]) }); const nestedTree = await writeTree(fileToDirectory, [{ mode: "100644", path: "bar", oid: nestedBlob, type: "blob" }]); const nestedRoot = await writeTree(fileToDirectory, [{ mode: "040000", path: "foo", oid: nestedTree, type: "tree" }]); const fileToDirectoryOid = await writeCommit(fileToDirectory, nestedRoot, [fileToDirectory.commits[0]]); await expectReject(() => fileToDirectory.service.restoreCommitToWorkingTree(fileToDirectoryOid), "父路径是文件")
  const directoryToFile = await createSingleCommit("directory-to-file", [{ path: "foo/bar", content: "nested\n" }]); const fileBlob = await directoryToFile.repo.git.writeBlob({ fs: directoryToFile.repo.fs, dir: directoryToFile.path, gitdir: directoryToFile.gitdir, blob: new Uint8Array([102, 105, 108, 101, 10]) }); const fileRoot = await writeTree(directoryToFile, [{ mode: "100644", path: "foo", oid: fileBlob, type: "blob" }]); const directoryToFileOid = await writeCommit(directoryToFile, fileRoot, [directoryToFile.commits[0]]); await expectReject(() => directoryToFile.service.restoreCommitToWorkingTree(directoryToFileOid), "目标文件与当前目录冲突")

  const rollback = await createRepo("rollback"); const rollbackBefore = await capture(rollback); const originalDescriptor = Object.getOwnPropertyDescriptor(FileManager, "writeAsBytes"); const originalWrite = FileManager.writeAsBytes.bind(FileManager); let writeCount = 0; let injected = false; Object.defineProperty(FileManager, "writeAsBytes", { value: async (filepath: string, bytes: Uint8Array) => { writeCount++; if (!injected && writeCount === 2) { injected = true; throw new Error("injected write failure") } return originalWrite(filepath, bytes) }, configurable: true }); try { await expectReject(() => rollback.service.restoreCommitToWorkingTree(rollback.commits[1]), "injected write failure") } finally { if (originalDescriptor) Object.defineProperty(FileManager, "writeAsBytes", originalDescriptor) }
  const rollbackAfter = await capture(rollback); assert(rollbackAfter.head === rollbackBefore.head && rollbackAfter.branch === rollbackBefore.branch && rollbackAfter.branchOid === rollbackBefore.branchOid, "rollback 后 HEAD/branch 改变"); assert(sameBytes(rollbackAfter.index, rollbackBefore.index) && JSON.stringify(rollbackAfter.history) === JSON.stringify(rollbackBefore.history) && JSON.stringify(rollbackAfter.matrix) === JSON.stringify(rollbackBefore.matrix) && sameBytes(rollbackAfter.modified, rollbackBefore.modified), "rollback 未恢复仓库状态"); assert((await rollback.service.getStatus()).isClean, "rollback 后工作区不干净")

  Script.exit({ ok: true, scenarios: ["modified", "added", "deleted", "multiple", "root", "merge", "dirty", "staged", "untracked", "invalid-oid", "unsafe-path", "file-directory-conflict", "directory-file-conflict", "io-rollback", "no-op", "integrity"] })
}
run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
