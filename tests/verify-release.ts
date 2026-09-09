import { Script } from "scripting"
import { GITHUB_RELEASE_TEMP_ROOT, GitHubReleaseService, GitHubReleaseTransport, GitHubReleaseTransportResponse, RELEASE_TEMP_STALE_MS, fileContainsToken, isTextScanFile } from "../src/core/GitHubReleaseService"
import { isValidVersion, validateVersion } from "../src/core/version"
import { GitAheadBehind, GitCommitInfo, GitRemoteCredential, GitRemoteInfo, GitRepositoryStatus } from "../src/core/types"
import { GitService } from "../src/core/GitService"

interface RequestRecord {
  url: string
  method: "GET" | "POST"
  headers: Record<string, string>
  body?: string | ArrayBuffer
}

type TransportMode = "success" | "existing" | "existing-missing-asset" | "upload-failure"

class MockReleaseTransport implements GitHubReleaseTransport {
  readonly requests: RequestRecord[] = []
  private readonly mode: TransportMode
  private readonly assetName: string

  constructor(mode: TransportMode, assetName: string) {
    this.mode = mode
    this.assetName = assetName
  }

  async request(options: RequestRecord): Promise<GitHubReleaseTransportResponse> {
    this.requests.push(options)
    if (options.url.includes("/releases/tags/")) {
      if (this.mode === "existing") {
        return response(200, {
          id: 42,
          html_url: "https://github.com/example/source-control/releases/tag/v1.2.0",
          upload_url: "https://uploads.github.com/repos/example/source-control/releases/42/assets{?name,label}",
          assets: [{ id: 7, name: this.assetName, browser_download_url: "https://github.com/example/source-control/releases/download/v1.2.0/Source-Control-1.2.0.zip", size: 1234 }],
        })
      }
      if (this.mode === "existing-missing-asset") {
        return response(200, {
          id: 42,
          html_url: "https://github.com/example/source-control/releases/tag/v1.2.0",
          upload_url: "https://uploads.github.com/repos/example/source-control/releases/42/assets{?name,label}",
          assets: [],
        })
      }
      return response(404, { message: "Not Found" })
    }
    if (options.url.endsWith("/releases")) {
      return response(201, {
        id: 42,
        html_url: "https://github.com/example/source-control/releases/tag/v1.2.0",
        upload_url: "https://uploads.github.com/repos/example/source-control/releases/42/assets{?name,label}",
        assets: [],
      })
    }
    if (options.url.includes("/assets?name=")) {
      if (this.mode === "upload-failure") return response(500, { message: "upload failed" })
      const size = options.body instanceof ArrayBuffer ? options.body.byteLength : 0
      return response(201, {
        id: 8,
        name: this.assetName,
        browser_download_url: "https://github.com/example/source-control/releases/download/v1.2.0/Source-Control-1.2.0.zip",
        size,
      })
    }
    return response(500, { message: "unexpected request" })
  }
}

function response(status: number, payload: unknown): GitHubReleaseTransportResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => payload }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function cleanStatus(): GitRepositoryStatus {
  return { changes: [], stagedChanges: [], unstagedChanges: [], isClean: true }
}

function history(commitOid: string): GitCommitInfo[] {
  return [{ oid: commitOid, shortOid: commitOid.slice(0, 7), message: "release test", authorName: "Test", authorEmail: "test@example.com", timestamp: 1, parentOids: [] }]
}

function syncState(commitOid: string, ahead = 0, behind = 0): GitAheadBehind {
  return { localBranch: "master", remote: "origin", remoteBranch: "master", localOid: commitOid, remoteOid: commitOid, ahead, behind, diverged: ahead > 0 && behind > 0 }
}

function fakeGitService(options: {
  projectPath: string
  commitOid?: string
  status?: GitRepositoryStatus
  branch?: string | null
  remotes?: GitRemoteInfo[]
  credential?: GitRemoteCredential | null
  sync?: GitAheadBehind
}): GitService {
  const commitOid = options.commitOid || "a".repeat(40)
  const candidate = {
    openRepository: async (_projectPath: string): Promise<void> => {},
    getStatus: async (): Promise<GitRepositoryStatus> => options.status || cleanStatus(),
    getCurrentBranch: async (): Promise<string | null> => options.branch === undefined ? "master" : options.branch,
    getHistory: async (_limit?: number): Promise<GitCommitInfo[]> => history(commitOid),
    listRemotes: async (): Promise<GitRemoteInfo[]> => options.remotes || [{ name: "origin", url: "https://github.com/example/source-control.git" }],
    getRemoteCredential: async (_name: string): Promise<GitRemoteCredential | null> => options.credential === undefined ? { username: "x-access-token", password: ["mock", "release", "token"].join("-") } : options.credential,
    getAheadBehind: async (_remote?: string, _branch?: string): Promise<GitAheadBehind> => options.sync || syncState(commitOid),
  }
  return candidate as unknown as GitService
}

async function makeProject(root: string, includeVersion = true): Promise<string> {
  const projectPath = `${root}/Source Control`
  await FileManager.createDirectory(`${projectPath}/src`, true)
  await FileManager.createDirectory(`${projectPath}/assets`, true)
  await FileManager.createDirectory(`${projectPath}/.git`, true)
  await FileManager.createDirectory(`${projectPath}/source-control-sync-history`, true)
  await FileManager.createDirectory(`${projectPath}/source-control-metadata`, true)
  await FileManager.createDirectory(`${projectPath}/node_modules/pkg`, true)
  await FileManager.writeAsString(`${projectPath}/script.json`, JSON.stringify(includeVersion ? { name: "Source Control", version: "1.2.0" } : { name: "Source Control" }), "utf8")
  await FileManager.writeAsString(`${projectPath}/index.tsx`, "export default null\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/README.md`, "release test\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/src/runtime.tsx`, "export const runtime = true\n", "utf8")
  await FileManager.createDirectory(`${projectPath}/docs`, true)
  await FileManager.writeAsString(`${projectPath}/docs/should-not-ship.md`, "development docs\n", "utf8")
  await FileManager.createDirectory(`${projectPath}/tests`, true)
  await FileManager.writeAsString(`${projectPath}/tests/verify-release-fixture.ts`, "development test\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/assets/icon.txt`, "asset\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/.git/config`, "secret git metadata\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/source-control-sync-history/records.json`, "metadata\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/source-control-metadata/state.json`, "metadata\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/node_modules/pkg/index.js`, "development dependency\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/verify-release.ts`, "should not ship\n", "utf8")
  await FileManager.writeAsString(`${projectPath}/.DS_Store`, "system file\n", "utf8")
  return projectPath
}

async function readArchivePaths(zipBytes: Uint8Array, root: string): Promise<{ paths: string[]; manifest: GitHubReleaseManifestLike; allBytes: Uint8Array }> {
  const zipPath = `${root}/captured.zip`
  const extractPath = `${root}/extracted`
  await FileManager.createDirectory(root, true)
  await FileManager.writeAsBytes(zipPath, zipBytes)
  await FileManager.createDirectory(extractPath, true)
  await FileManager.unzip(zipPath, extractPath)
  const entries = await FileManager.readDirectory(extractPath, true)
  const paths = entries.map((entry) => entry.startsWith(`${extractPath}/`) ? entry.slice(extractPath.length + 1) : entry).sort()
  const manifestPath = `${extractPath}/Source Control/release.json`
  const manifest = JSON.parse(await FileManager.readAsString(manifestPath, "utf8")) as GitHubReleaseManifestLike
  const allBytes = await FileManager.readAsBytes(`${extractPath}/Source Control/index.tsx`)
  return { paths, manifest, allBytes }
}

interface GitHubReleaseManifestLike {
  name: string
  version: string
  commitOid: string
  releasedAt: number
  minimumScriptingVersion: string | null
}

async function assertTempClean(): Promise<void> {
  if (!(await FileManager.exists(GITHUB_RELEASE_TEMP_ROOT))) return
  const entries = await FileManager.readDirectory(GITHUB_RELEASE_TEMP_ROOT)
  assert(entries.length === 0, "release temp directory was not cleaned")
}

async function run(): Promise<void> {
  if (await FileManager.exists(GITHUB_RELEASE_TEMP_ROOT)) {
    await FileManager.remove(GITHUB_RELEASE_TEMP_ROOT)
  }
  const root = `${FileManager.appGroupDocumentsDirectory}/Source Control Release Test-${Date.now()}`
  const commitOid = "a".repeat(40)
  const token = ["mock", "release", "token"].join("-")
  const assetName = "Source-Control-1.2.0.zip"
  try {
    const projectPath = await makeProject(root)
    const transport = new MockReleaseTransport("success", assetName)
    const releaseNotes = "Full release notes\nwith details"
     const service = new GitHubReleaseService(fakeGitService({ projectPath, commitOid }), projectPath, transport)
    const result = await service.publishCurrentProject({ releaseNotes })
    assert(result.version === "1.2.0" && result.tagName === "v1.2.0", "release metadata is incorrect")
    assert(result.assetName === assetName && result.assetSize > 0 && result.commitOid === commitOid, "asset result is incorrect")
    assert(transport.requests.length === 3, "release should use tag lookup, create, and upload")
         const createPayload = JSON.parse(String(transport.requests[1].body || "{}")) as { tag_name?: string; target_commitish?: string; name?: string; body?: string }
     assert(createPayload.tag_name === "v1.2.0" && createPayload.target_commitish === commitOid && createPayload.name === "Source Control 1.2.0", "release create payload is incorrect")
     assert(createPayload.body === releaseNotes, "release notes were not sent as the release body")
    const upload = transport.requests[2]
    assert(upload.headers["Content-Type"] === "application/zip", "asset content type is not application/zip")
    assert(upload.headers.Authorization === `Bearer ${token}`, "release token was not passed as Bearer auth")
    assert(upload.body instanceof ArrayBuffer, "asset body is not binary")
    const archive = await readArchivePaths(new Uint8Array(upload.body), `${root}/archive-check`)
    assert(archive.paths.includes("Source Control/index.tsx"), "index.tsx is missing from ZIP")
    assert(archive.paths.includes("Source Control/script.json") && archive.paths.includes("Source Control/src/runtime.tsx"), "runtime files are missing from ZIP")
    assert(archive.paths.includes("Source Control/assets/icon.txt") && archive.paths.includes("Source Control/README.md"), "release resources are missing from ZIP")
    assert(archive.paths.includes("Source Control/release.json"), "release.json is missing from ZIP")
    assert(!archive.paths.some((path) => path.includes(".git") || path.includes("source-control-sync-history") || path.includes("source-control-metadata") || path.includes("node_modules") || path.includes("verify-release.ts") || path.includes("docs/") || path.includes("tests/") || path.endsWith(".DS_Store")), "excluded files entered ZIP")
    assert(archive.manifest.name === "Source Control" && archive.manifest.version === "1.2.0" && archive.manifest.commitOid === commitOid && archive.manifest.minimumScriptingVersion === null && Number.isFinite(archive.manifest.releasedAt), "release.json is incorrect")
    assert(!new TextDecoder().decode(archive.allBytes).includes(token), "token entered ZIP")
    await assertTempClean()

    const existingTransport = new MockReleaseTransport("existing", assetName)
    const existing = await new GitHubReleaseService(fakeGitService({ projectPath, commitOid }), projectPath, existingTransport).publishCurrentProject()
    assert(existing.existingRelease && !existing.assetUploaded && existing.assetUrl.includes("/releases/download/"), "existing release handling is incorrect")
    assert(existingTransport.requests.length === 1, "existing asset should not be uploaded again")
    const existingMissingAssetTransport = new MockReleaseTransport("existing-missing-asset", assetName)
    const existingMissingAsset = await new GitHubReleaseService(fakeGitService({ projectPath, commitOid }), projectPath, existingMissingAssetTransport).publishCurrentProject()
    assert(existingMissingAsset.existingRelease && existingMissingAsset.assetUploaded && existingMissingAsset.assetName === assetName, "missing asset was not uploaded to an existing Release")
    assert(existingMissingAssetTransport.requests.length === 2, "existing Release with missing asset should upload exactly once")
    await assertTempClean()


    const uploadFailureTransport = new MockReleaseTransport("upload-failure", assetName)
    let uploadFailure = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath, commitOid }), projectPath, uploadFailureTransport).publishCurrentProject()
    } catch (error) {
      uploadFailure = error instanceof Error ? error.message : String(error)
    }
    assert(uploadFailure === "Release created but ZIP upload failed." && !uploadFailure.includes(token), "upload failure message is incorrect or leaked the token")
    await assertTempClean()

    const missingVersionPath = await makeProject(`${root}/missing-version`, false)
    let missingVersion = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: missingVersionPath, commitOid }), missingVersionPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (error) {
      missingVersion = error instanceof Error ? error.message : String(error)
    }
    assert(missingVersion === "Project version is missing.", "missing version was not rejected")

    const dirtyPath = await makeProject(`${root}/dirty`)
    let dirtyError = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: dirtyPath, commitOid, status: { ...cleanStatus(), isClean: false } }), dirtyPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (error) {
      dirtyError = error instanceof Error ? error.message : String(error)
    }
    assert(dirtyError === "Working tree must be clean before publishing a Release.", "dirty worktree was not rejected")

    const aheadPath = await makeProject(`${root}/ahead`)
    let aheadError = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: aheadPath, commitOid, sync: syncState(commitOid, 1, 0) }), aheadPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (error) {
      aheadError = error instanceof Error ? error.message : String(error)
    }
    assert(aheadError === "请先将当前版本同步到 GitHub，再发布 Release。", "local ahead was not rejected")

    const missingTokenPath = await makeProject(`${root}/missing-token`)
    let missingTokenError = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: missingTokenPath, commitOid, credential: null }), missingTokenPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (error) {
      missingTokenError = error instanceof Error ? error.message : String(error)
    }
    assert(missingTokenError === "GitHub access token is not configured.", "missing token was not rejected")

    const nonGithubPath = await makeProject(`${root}/non-github`)
    let nonGithubError = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: nonGithubPath, commitOid, remotes: [{ name: "origin", url: "https://git.example.com/example/source-control.git" }] }), nonGithubPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (error) {
      nonGithubError = error instanceof Error ? error.message : String(error)
    }
    assert(nonGithubError === "Release requires a GitHub HTTPS remote.", "non-GitHub remote was not rejected")

    const zipFailurePath = `${root}/zip-failure-does-not-exist`
    let zipFailure = ""
    const zipFailureTransport = new MockReleaseTransport("success", assetName)
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: zipFailurePath, commitOid }), zipFailurePath, zipFailureTransport).publishCurrentProject()
    } catch (error) {
      zipFailure = error instanceof Error ? error.message : String(error)
    }
    assert(zipFailure.length > 0 && zipFailureTransport.requests.length === 0, "ZIP failure called GitHub")
    await assertTempClean()

    // 针对 Token 扫描优化的最小验证
    const testToken = "ghp_secret_token_123456"

    // 1. 普通 ts / json 文件能发现 Token
    const textFiles = [
      { path: "src/sample.ts", content: "export const t = 'ghp_secret_token_123456'" },
      { path: "config.json", content: '{"token": "ghp_secret_token_123456"}' },
    ]
    for (const tf of textFiles) {
      const bytes = new TextEncoder().encode(tf.content)
      assert(fileContainsToken(tf.path, bytes, testToken), `Failed to detect token in ${tf.path}`)
      const safeBytes = new TextEncoder().encode("export const normal = true")
      assert(!fileContainsToken(tf.path, safeBytes, testToken), `False positive token detected in safe ${tf.path}`)
    }

    // 2. PNG 等二进制文件不会执行 TextDecoder，不报 Token（即使二进制中巧合包含类似模式或文本）
    // 验证 isTextScanFile 判断规则
    assert(!isTextScanFile("assets/icon.png"), "png should not be text scan file")
    assert(!isTextScanFile("images/photo.jpg"), "jpg should not be text scan file")
    assert(!isTextScanFile("music/bgm.mp3"), "mp3 should not be text scan file")
    assert(!isTextScanFile("fonts/font.ttf"), "ttf should not be text scan file")
    assert(!isTextScanFile("binary.bin"), "bin should not be text scan file")

    // 验证文本扩展名均被识别
    const requiredExtensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".html", ".css", ".yml", ".yaml", ".xml", ".env"]
    for (const ext of requiredExtensions) {
      assert(isTextScanFile(`dir/file${ext}`), `extension ${ext} should be recognized as text scan file`)
    }
    assert(isTextScanFile(".env"), ".env should be text scan file")
    assert(isTextScanFile(".env.local"), ".env.local should be text scan file")

    // 验证二进制文件即使内容含有 token 字节，也不做内容解码扫描
    let textDecoderCalls = 0
    const globalObj = globalThis as unknown as Record<string, unknown>
    const originalTextDecoder = globalObj.TextDecoder as new (...args: unknown[]) => { decode: (input?: unknown, options?: unknown) => string }
    class TrackedTextDecoder {
      private inner: { decode: (input?: unknown, options?: unknown) => string }
      constructor(...args: unknown[]) {
        this.inner = new originalTextDecoder(...args)
      }
      decode(input?: unknown, options?: unknown): string {
        textDecoderCalls++
        return this.inner.decode(input, options)
      }
    }
    globalObj.TextDecoder = TrackedTextDecoder

    try {
      textDecoderCalls = 0
      const fakePngBytes = new TextEncoder().encode("fake png containing ghp_secret_token_123456")
      const detectedInPng = fileContainsToken("assets/logo.png", fakePngBytes, testToken)
      assert(!detectedInPng, "binary file should not match token content")
      assert(textDecoderCalls === 0, `TextDecoder was called ${textDecoderCalls} times on binary file`)

      // 3. 大于 1MB 文本文件不会产生 TextDecoder 解码
      textDecoderCalls = 0
      const largeSize = 1024 * 1024 + 100 // 1MB + 100 字节
      const largeBytes = new Uint8Array(largeSize)
      largeBytes.fill(32) // 空格
      // 在末尾放入 token
      const tokenBytes = new TextEncoder().encode(testToken)
      largeBytes.set(tokenBytes, largeSize - 50)

      const detectedInLarge = fileContainsToken("large-file.ts", largeBytes, testToken)
      assert(detectedInLarge, "large text file should detect token via byte scan")
      assert(textDecoderCalls === 0, `TextDecoder was called ${textDecoderCalls} times on >1MB file`)

      // 大文件无 token
      const largeSafeBytes = new Uint8Array(largeSize)
      largeSafeBytes.fill(65) // 'A'
      const detectedInLargeSafe = fileContainsToken("large-file.ts", largeSafeBytes, testToken)
      assert(!detectedInLargeSafe, "large safe text file false positive")
      assert(textDecoderCalls === 0, `TextDecoder was called ${textDecoderCalls} times on large safe file`)

      // 小于 1MB 的文本文件会使用正常的 decode
      textDecoderCalls = 0
      const smallTextBytes = new TextEncoder().encode("const x = 'ghp_secret_token_123456'")
      assert(fileContainsToken("index.ts", smallTextBytes, testToken), "small text file should detect token")
      assert(textDecoderCalls > 0, "TextDecoder should be used for <= 1MB text file")
    } finally {
      globalObj.TextDecoder = originalTextDecoder
    }

    // 4. relativePath 中包含 Token 的检查保留（即使是二进制扩展名）
    assert(fileContainsToken(`folder/${testToken}/image.png`, new Uint8Array([1, 2, 3]), testToken), "relativePath containing token must be rejected even for binary")

    // 5. 验证包含真实二进制文件的项目能正常打包（PNG 文件在项目中，能成功复制且 Release 成功）
    const binaryProjectPath = await makeProject(`${root}/binary-project`)
    // 写入一个 PNG 文件到 assets
    const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    await FileManager.writeAsBytes(`${binaryProjectPath}/assets/image.png`, dummyPng)
    const binaryTransport = new MockReleaseTransport("success", assetName)
    const binaryResult = await new GitHubReleaseService(fakeGitService({ projectPath: binaryProjectPath, commitOid }), binaryProjectPath, binaryTransport).publishCurrentProject()
    assert(binaryResult.assetUploaded, "binary project release should upload asset successfully")
    const uploadBinary = binaryTransport.requests[2]
    const binaryArchive = await readArchivePaths(new Uint8Array(uploadBinary.body as ArrayBuffer), `${root}/archive-binary-check`)
    assert(binaryArchive.paths.includes("Source Control/assets/image.png"), "image.png is included in packaged zip")

    // 验证项目中如果普通 ts 文件含有 token，打包会被拦截
    const tokenProjectPath = await makeProject(`${root}/token-leak-project`)
    await FileManager.writeAsString(`${tokenProjectPath}/src/leak.ts`, `export const secret = "${testToken}"\n`, "utf8")
    let leakError = ""
    try {
      await new GitHubReleaseService(fakeGitService({ projectPath: tokenProjectPath, commitOid: "b".repeat(40), credential: { username: "x-access-token", password: testToken } }), tokenProjectPath, new MockReleaseTransport("success", assetName)).publishCurrentProject()
    } catch (err) {
      leakError = err instanceof Error ? err.message : String(err)
    }
    assert(leakError === "Project files contain the GitHub access token and cannot be packaged.", "leaked token in ts file was not rejected")

    // 验证预检：文件数量超限直接中止 Release
    const excessFilesProject = await makeProject(`${root}/excess-files-project`)
    let excessFilesError = ""
    try {
      // 传入测试 limit: maxFileCount = 3 (makeProject 会生成 index.tsx, script.json, README.md, src/index.ts 共 4 个有效 candidate 文件)
      await new GitHubReleaseService(
        fakeGitService({ projectPath: excessFilesProject, commitOid }),
        excessFilesProject,
        new MockReleaseTransport("success", assetName),
        { maxFileCount: 3 },
      ).publishCurrentProject()
    } catch (err) {
      excessFilesError = err instanceof Error ? err.message : String(err)
    }
    assert(excessFilesError.includes("文件数量过多") && excessFilesError.includes("超过限制"), "excess files limit did not abort release")

    // 验证预检：项目体积超限直接中止 Release
    const excessSizeProject = await makeProject(`${root}/excess-size-project`)
    let excessSizeError = ""
    try {
      // 传入测试 limit: maxTotalSize = 100 字节，实际项目已超过 100 字节
      await new GitHubReleaseService(
        fakeGitService({ projectPath: excessSizeProject, commitOid }),
        excessSizeProject,
        new MockReleaseTransport("success", assetName),
        { maxTotalSize: 100 },
      ).publishCurrentProject()
    } catch (err) {
      excessSizeError = err instanceof Error ? err.message : String(err)
    }
    assert(excessSizeError.includes("项目体积过大") && excessSizeError.includes("超过限制"), "excess total size limit did not abort release")

    // 验证排除文件不计入文件数和大小统计
    const excludedPreflightProject = await makeProject(`${root}/excluded-preflight-project`)
    // 加入大量或大体积的应被排除文件，例如 .git 文件夹、tests 测试目录、verify 测试文件、.env、node_modules
    await FileManager.createDirectory(`${excludedPreflightProject}/.git/objects`, true)
    await FileManager.writeAsString(`${excludedPreflightProject}/.git/objects/huge.pack`, "x".repeat(2000), "utf8")
    await FileManager.createDirectory(`${excludedPreflightProject}/node_modules/pkg`, true)
    await FileManager.writeAsString(`${excludedPreflightProject}/node_modules/pkg/index.js`, "x".repeat(2000), "utf8")
    await FileManager.createDirectory(`${excludedPreflightProject}/source-control-metadata`, true)
    await FileManager.writeAsString(`${excludedPreflightProject}/source-control-metadata/data.json`, "x".repeat(2000), "utf8")
    await FileManager.createDirectory(`${excludedPreflightProject}/tests`, true)
    await FileManager.writeAsString(`${excludedPreflightProject}/tests/verify-something.ts`, "x".repeat(2000), "utf8")
    // 限制 5 个文件、2000 字节。有效文件 5 个（index.tsx, script.json, README.md, src/runtime.tsx, assets/icon.txt，合计约 150 字节）
    // 如果排除了上述文件，则不会触发数量和大小超限报错，能正常成功发布
    const excludedPreflightResult = await new GitHubReleaseService(
      fakeGitService({ projectPath: excludedPreflightProject, commitOid }),
      excludedPreflightProject,
      new MockReleaseTransport("success", assetName),
      { maxFileCount: 5, maxTotalSize: 2000 },
    ).publishCurrentProject()
    assert(excludedPreflightResult.assetUploaded, "excluded files should not count towards preflight limits")

    // 验证 1：互斥锁并发调用测试
    const mutexProject = await makeProject(`${root}/mutex-project`)
    let resumeRelease: (() => void) | null = null
    const pauseBeforeUpload = new Promise<void>((resolve) => {
      resumeRelease = resolve
    })
    const delayedTransport = new MockReleaseTransport("success", assetName)
    const originalRequest = delayedTransport.request.bind(delayedTransport)
    delayedTransport.request = async (options) => {
      if (options.url.includes("/assets?name=")) {
        await pauseBeforeUpload
      }
      return originalRequest(options)
    }

    const mutexService = new GitHubReleaseService(
      fakeGitService({ projectPath: mutexProject, commitOid }),
      mutexProject,
      delayedTransport,
    )
    assert((mutexService.isPublishing as boolean) === false, "initial isPublishing should be false")
    const firstCallPromise = mutexService.publishCurrentProject()
    assert((mutexService.isPublishing as boolean) === true, "isPublishing should be true during release")

    let secondCallRejected = false
    try {
      await mutexService.publishCurrentProject()
    } catch (err) {
      secondCallRejected = true
      const msg = err instanceof Error ? err.message : String(err)
      assert(msg.includes("Release 发布正在进行中"), "should reject concurrent release with correct message")
    }
    assert(secondCallRejected, "second call should be rejected while publishing")

    if (resumeRelease) (resumeRelease as () => void)()
    await firstCallPromise
    assert(mutexService.isPublishing === false, "isPublishing should be reset to false after success")

    // 验证 2：第一次发布失败后互斥锁能够正常释放
    const failTransport = new MockReleaseTransport("upload-failure", assetName)
    const failService = new GitHubReleaseService(fakeGitService({ projectPath: mutexProject, commitOid }), mutexProject, failTransport)
    let failureFailed = false
    try {
      await failService.publishCurrentProject()
    } catch {
      failureFailed = true
    }
    assert(failureFailed, "upload failure should throw")
    assert((failService.isPublishing as boolean) === false, "isPublishing should be reset to false after error")

    // 验证 3：清理遗留旧临时目录（>24小时），保留新临时目录（<24小时），并在发布后清理自身临时目录
    await FileManager.createDirectory(GITHUB_RELEASE_TEMP_ROOT, true)
    const oldTempName = `${Date.now() - 30 * 3600 * 1000}-oldrun1`
    const oldTempPath = `${GITHUB_RELEASE_TEMP_ROOT}/${oldTempName}`
    await FileManager.createDirectory(oldTempPath, true)
    await FileManager.writeAsString(`${oldTempPath}/leftover.txt`, "old temp", "utf8")

    const newTempName = `${Date.now() - 10 * 60 * 1000}-newrun1`
    const newTempPath = `${GITHUB_RELEASE_TEMP_ROOT}/${newTempName}`
    await FileManager.createDirectory(newTempPath, true)
    await FileManager.writeAsString(`${newTempPath}/keep.txt`, "recent temp", "utf8")

    const unrelatedName = `custom-cache-dir`
    const unrelatedPath = `${GITHUB_RELEASE_TEMP_ROOT}/${unrelatedName}`
    await FileManager.createDirectory(unrelatedPath, true)
    await FileManager.writeAsString(`${unrelatedPath}/keep.txt`, "unrelated", "utf8")

    const cleanupTestService = new GitHubReleaseService(
      fakeGitService({ projectPath: mutexProject, commitOid }),
      mutexProject,
      new MockReleaseTransport("success", assetName),
    )
    const cleanupResult = await cleanupTestService.publishCurrentProject()
    assert(cleanupResult.assetUploaded, "release with stale cleanup should succeed")

    const oldExists = await FileManager.exists(oldTempPath)
    const newExists = await FileManager.exists(newTempPath)
    const unrelatedExists = await FileManager.exists(unrelatedPath)
    assert(!oldExists, "stale temp directory (>24h) should be cleaned")
    assert(newExists, "recent temp directory (<24h) should be preserved")
    assert(unrelatedExists, "unrelated directory should not be touched")

    // 清理测试目录
    if (newExists) await FileManager.remove(newTempPath)
    if (unrelatedExists) await FileManager.remove(unrelatedPath)

    // 验证 18：统一版本号规则校验 (SemVer 2.0)
    const validVersions = ["1.0.0", "1.2.3", "1.0.0-beta.1", "2.0.0-rc.1", "1.0.0+build.5"]
    for (const v of validVersions) {
      assert(isValidVersion(v), `should be valid version: ${v}`)
      assert(validateVersion(v) === v, `validateVersion should return normalized version: ${v}`)
    }
    const invalidVersions = ["01.0.0", "1.01.0", "1.0", "v1.0.0", "", "  ", "abc", "1.0.0.0"]
    for (const v of invalidVersions) {
      assert(!isValidVersion(v), `should be invalid version: ${v}`)
      assert(validateVersion(v) === null, `validateVersion should return null: ${v}`)
    }

    Script.exit({ ok: true, scenarios: ["zip-structure", "git-excluded", "metadata-excluded", "verify-filtered", "manifest", "missing-version", "dirty", "local-ahead", "missing-token", "non-github-remote", "existing-release", "upload-failure", "temp-cleanup", "token-safe", "token-scan-optimization", "preflight-limits", "release-mutex-and-cleanup", "semver-validation"] })
  } finally {
    try {
      if (await FileManager.exists(root)) await FileManager.remove(root)
    } catch {
      // 测试清理失败不覆盖主要断言结果。
    }
  }
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
