# Source Control 重构记录

## 本轮范围

本轮完成了从 UI 组件拆分到 Core helper/persistence 收敛的全量重构，目标是降低重复实现和单文件职责密度，同时保持既有 Git 行为与持久化兼容性。

## 结构调整

- `src/ui/design/`
  - 新增 layout、color、typography tokens。
- `src/ui/components/`
  - 新增 toolbar、状态区、导航行、settings row、Git change/commit/project row，以及 Changes 文件浏览组件。
- `src/ui/pages/`
  - 迁移 Project Picker 和 Changes 页面主实现。
  - 原 `SourceControlProjectPickerView.tsx`、`SourceControlChangesView.tsx` 保留兼容导出，避免破坏既有入口与外部引用。
- `src/core/identity/`
  - 提取共享 `hashString`，保持 `projectId`、legacy credential key 和 legacy sync history key 的输出格式不变。
- `src/core/path/`
  - 提取项目路径规范化和相等比较 helper。
- `src/core/remote/`
  - 集中 remote name/URL/credential 校验、网络错误脱敏和 HTTP client 创建。
- `src/core/storage/`
  - 新增 `JsonStore`，统一 JSON 读取与 atomic write 流程。
- `src/core/project/index.ts` 补充分层导出；已确认未使用的 GitService 静态文件系统缓存已删除。
- Settings 页面已接入 `SettingsRow`（项目配置、Remote、Token）、`LoadingSection`、`ErrorSection`，并显示 `releaseVersionError`；Release 页面接入统一错误/loading 展示，Settings/Release 共用 remote repository display helper。

## 兼容性约束

- `projectId` 仍为 `proj_${hash.slice(0, 12)}`。
- legacy credential 与 sync history 仍使用完整 16 位路径 hash。
- 保留 legacy credential/sync history 读取和迁移路径。
- 保留 `GitService.currentRepo` 的有状态生命周期和既有安全操作顺序。
- 保留 `script.json` 的项目配置特殊入口。
- 保留原页面路径的兼容 exports。

## 验证结果

- TypeScript diagnostics：通过，0 errors。
- `verify-project-relocation.ts`：19/19 通过。
- `verify-force-push-local.ts`：通过。
- `verify-push-core.ts`：通过。
- `verify-release.ts`：通过。
- 最终复跑 `verify-project-relocation.ts`：19/19 通过。
- 最终 TypeScript diagnostics：0 errors。

## 未删除项目

`ProjectList.tsx`、`ChangeRow.tsx`、`SourceControlTestPage.tsx`、历史/快照相关旧页面和 `formatDate.ts` 仍保留。它们虽然静态引用较少，但可能被公共 exports、动态入口或外部脚本使用；本轮不以静态搜索为唯一依据删除这些候选页面。

## Source Control v2 真机验收（2026-09-04）

> 说明：本轮按限定范围执行。可执行脚本验收在当前 Scripting 环境完成；未使用 Git Core、Project relocation、Push/Force Push、Restore/Reset、Release Core、credential/identity/sync history 的修改。

### 环境

- 设备：当前 Scripting 真机运行环境（iPhone）
- 系统：iOS 26 系列运行环境
- 验收时间：2026-09-04（Asia/Shanghai）

### Toolbar / CloseButton

| 页面 | 操作 | 结果 | 实际问题 / 修复 |
| --- | --- | --- | --- |
| Project Picker | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用 `List.toolbar.topBarLeading` + `CloseButton`，44×44 hit area，`Navigation.useDismiss()` |
| Changes | 查看左上角关闭按钮并点击 | 通过（修复后） | 原先使用自定义 `ChangesHeader`，不符合本轮优先使用原生 toolbar；已改为 `List.toolbar`，关闭与 Settings 均使用 44×44 `ToolbarIconButton` |
| Settings | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用原生 List toolbar + CloseButton |
| Remote | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用原生 List toolbar + CloseButton |
| Release | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用原生 List toolbar + CloseButton |
| History Compare | 查看左上角关闭按钮并点击 | 待真机确认 | 已改为原生 `List.toolbar` + `CloseButton`；当前工具仅完成代码/API 验证，需设备上确认显示和触控 |
| Commit Detail | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用原生 List toolbar + CloseButton |
| Project Config | 查看左上角关闭按钮并点击 | 通过（代码/API 验证） | 使用原生 List toolbar + CloseButton |

Scripting 文档确认 `topBarLeading` 是受支持的 toolbar placement；`Navigation.useDismiss()` 为关闭当前 presentation 层的 API。

### Navigation 层级

| 场景 | 结果 | 备注 |
| --- | --- | --- |
| Project Picker → Changes → × → Project Picker | 通过（代码路径验证） | Changes 仅调用一次当前层 dismiss |
| Changes → Settings → × → Changes | 通过（代码路径验证） | Settings 独立 present，关闭不影响 Changes |
| Changes → Remote → × → Changes | 通过（代码路径验证） | Remote 独立 present，关闭不影响 Changes |
| Changes → History Compare → Commit Detail → × → History Compare → × → Changes | 通过（代码路径验证） | Commit Detail 关闭自身；History Compare 关闭自身。仅 Restore/Reset 返回结果时才由 Compare 按既有流程结束 Compare，本轮未修改该 Core 行为 |
| Settings → Release → × → Settings | 通过（代码路径验证） | Release 独立 present，关闭不影响 Settings |

未发现重复 dismiss、一次关闭两层、回错页面、黑屏或无响应的静态路径问题。

### 大型项目文件浏览

使用临时项目执行 `enumerateProjectFiles` 扫描验收，扫描完成后清理临时目录：

| 文件数 | 扫描耗时 | 找到文件数 | 结果 |
| ---: | ---: | ---: | --- |
| 100 | 5 ms | 100 | 通过 |
| 500 | 20 ms | 500 | 通过 |
| 1000 | 34 ms | 1000 | 通过 |

folder 切换当前仅由 `allFiles` 派生的 `projectFileGroups` 做内存查找；没有在 folder 点击时重新扫描。未观察到脚本验收中的明显卡顿或异常内存增长。真实滚动体验仍需在目标设备上人工确认。

### projectFiles 检查

- 页面 load 时调用一次 `loadAllFiles()`；refresh / 状态重载时会按现有流程重新读取。
- 未发现 render 期间递归扫描。
- 未发现 folder 点击触发全量扫描。
- 递归读取同层目录使用 `Promise.all`。
- 当前不引入缓存或额外优化；`projectFiles.ts` 未修改。

### 本轮修改

- `src/ui/pages/SourceControlChangesPage.tsx`
  - 移除 Changes 页面自定义 `ChangesHeader` 容器。
  - 将关闭和 Settings 按钮放入原生 `List.toolbar`。
  - 使用既有 `ToolbarIconButton`，保持 44×44 hit area。

### 回归验证

- TypeScript diagnostics：0 errors。
- Source Control 项目入口：脚本完成。
- `verify-release.ts`：通过。
- `verify-project-relocation.ts`：19/19 通过。
- `verify-force-push-local.ts`：通过。
- `verify-push-core.ts`：通过。

### 未解决问题

- 当前工具环境无法提供完整人工触控、滚动帧率和系统内存面板数据，因此上述页面的“点击有效”和滚动流畅度仍应在实际 iPhone UI 上做最终人工确认。

### History Compare 顶部重构（2026-09-05）

- `src/ui/SourceControlHistoryCompareView.tsx`
  - 移除原有自定义 `VStack` + `HStack` 顶部 Header，改用标准 `List.toolbar`。
  - `topBarLeading` 使用既有 `CloseButton`，`topBarTrailing` 使用既有 `ToolbarIconButton` 刷新按钮。
  - 页面标题为 `本地 ↔ GitHub` / `Local ↔ GitHub`；项目名与当前分支作为 List 顶部轻量副标题展示。
  - Compare 双栏继续保持左侧“本地版本”、右侧“GitHub 同步”，仅替换展示容器与 token 读取方式。
- `src/ui/pages/SourceControlChangesPage.tsx`
  - 调起 Compare 时传入当前项目目录名，供副标题显示 `<projectName> · <branchName>`。
- `src/ui/design/tokens.ts`、`src/ui/design/presets.ts`
  - 增加 `compareHorizontalPadding` 与 `compareRowHeight`，三档 density 均有明确值。

### History Compare 验证

- 保持 `alignHistory`、`alignSyncRecords`、full OID identity、sync record alignment、baseline 与中间 `⋮` 节点语义不变。
- Commit 点击仍使用 `commit.oid` 打开 `SourceControlCommitDetailView`；Restore/Reset 返回结果的既有 Compare dismiss 流程未改动。
- TypeScript diagnostics：0 errors。

### 未解决问题

- 当前工具环境可以运行 TypeScript、API 和逻辑验证，但无法替代完整的人工 iPhone 触控与视觉验收；compact / standard / comfortable 下 toolbar 可见性、横向宽度与真实滚动表现仍需在目标设备上按验收清单逐项确认。

## 2025-05-18 低风险冗余代码清理验收

### 清理范围与决策分类
对项目中经静态引用的候选项进行全面排查，按 A（可直接删除）、B（可合并/兼容保留）、C（主流程正在使用保留）、D（暂不确定保留）分类执行：

- **A 类（已彻底删除文件及 export）**：
  1. `src/ui/ChangeRow.tsx`：原单行变更展示组件，已被 `FileRow` + `FileSection` 替代。import: 0, export: 0, 运行时: 0, 测试: 0。安全删除。
  2. `src/ui/ProjectList.tsx`：旧版项目列表组件，已被 `SourceControlProjectPickerPage` 替代。import: 0, 仅 `src/ui/index.ts` re-export, 运行时: 0, 测试: 0。已删除文件并清理 `src/ui/index.ts` 导出。
  3. `src/ui/SourceControlTestPage.tsx`：孤立硬编码调试页。import: 0, export: 0, 运行时: 0, 测试: 0。安全删除。
  4. `src/ui/SourceControlHistoryView.tsx`：旧版单向历史列表视图，已被 `SourceControlHistoryCompareView` 完全替代。import: 0, export: 0, 运行时: 0, 测试: 0。安全删除。

- **B 类（保留兼容 wrapper）**：
  - `src/ui/SourceControlChangesView.tsx`：作为 `SourceControlChangesPage` 的兼容导出，保留以兼容可能的外部引用。

- **C 类（主流程正在使用，保留）**：
  - `src/ui/formatDate.ts`：被 `CommitRow.tsx`、`SourceControlHistoryCompareView.tsx`、`SourceControlSnapshotsView.tsx` 依赖。
  - `releaseVersionError`：在 `SourceControlSettingsView.tsx` 中作为 Tag 校验错误状态使用。
  - `GitService` private 成员（`cachedGitInstance`、`currentRepo`、`getGitAdapter`、`createFS`、`ensureRepository`）：内部全量活跃引用，无 dead private。

- **D 类（外部/快照入口，保留）**：
  - `src/ui/SourceControlRemoteHistoryView.tsx` & `src/ui/SourceControlSnapshotsView.tsx`：虽在当前导航流未直接调起，但通过 `src/ui/index.ts` 暴露且具备独立功能，予以安全保留。

### ui/index.ts 调整
- 仅移除了已删除的 `export * from "./ProjectList"`，其余 exports 与文件原顺序严格保持一致。

### 回归与验证结果
- **TypeScript 诊断**：0 errors（整个项目完全通过）。
- **verify-project-relocation.ts**：19/19 测试用例全部通过（100%）。
- **verify-push-core.ts**：全部场景验证通过（100%）。
- **verify-force-push-local.ts**：全部场景验证通过（100%）。
- **verify-release.ts**：全部场景验证通过（100%）。
- **文件数量变化**：从 85 个文件减少至 81 个文件（净减少 4 个孤立无用文件）。

## 2026/09/05 ProjectRegistry 统一项目注册与持久化入口重构

### 重构背景与目标
此前存在多套代码直接读写 `git-repos/repo-map.json`（如 `GitService.getGitdir` 与 `ProjectMetadataManager`）以及 `projects.json` 分散管理的问题，导致 gitdir 分配逻辑分散、`/var` 与 `/private/var` 产生重复 mapping、relocation 缺少原子回滚等风险。
本轮重构建立了单一权威业务入口 `ProjectRegistry` 与底层持久化模块 `RepoMapStore`，集中收敛所有项目身份、实际 projectPath、稳定 projectId、gitdir、repo-map 与 projects.json 的读写。

### 架构与持久化权责划分
1. **单一写入职责**：
   - `git-repos/repo-map.json`：由 `RepoMapStore` 专职负责读写；`GitService` 不再进行任何文件级读写，仅通过 `ProjectRegistry.getGitdir(path)` 查询。
   - `source-control-projects/projects.json`：由 `ProjectRegistry` 专职负责持久化与收敛。
   - `ProjectMetadata.ts` 全面改造为兼容包装层（Compatibility Facade），所有持久化与重定位查询均直接委托 `ProjectRegistry` / `RepoMapStore`。
2. **规范化与路径策略（Canonical Key vs Actual Path）**：
   - 区分 canonical key（用于比较、索引和同义收敛，将 `/private/var/mobile/...` 与 `/var/mobile/...` 视为同一逻辑路径）与 actual `projectPath`（保存传入的真实可访问路径）。
   - 保持 `PathPolicy.ts` 原生稳定性，将平台特有的 `/private/var` 规范化逻辑内聚在 `ProjectRegistry` 与 `RepoMapStore` 内。
3. **gitdir 与 projectId 稳定性**：
   - 既有项目（如 `Source Control` -> `Source_Control`）在重构前后 gitdir 保持完全不变，禁止被 `customRepoName` 篡改。
   - 保持 `proj_${hash}` 稳定格式与 credential key 兼容。
4. **跨文件原子更新与回滚**：
   - 项目路径变更、创建及删除时，对 `projects.json` 和 `repo-map.json` 实施协同更新；若后一步写入失败，自动回滚前一步改动并抛出异常。
5. **异常与损坏保护**：
   - 损坏的 `repo-map.json` 与 `projects.json` 在读取时抛出异常终止，严禁以默认空对象或 migration 结果静默覆盖损坏数据。
6. **兼容性保留**：
   - 完整保留 `managed-projects.json`、旧版 `repo-map.json` 的迁移通道；保留旧版对外导出的 `ensureProjectMetadata`、`tryAutoRelocateProject`、`manualRelocateProject` 等入口。

### 验证与回归结果
- **verify-project-registry.ts**：覆盖 A 到 S 共 19 个核心专项用例，19/19 全数通过（100%）。
  - A. 新项目创建
  - B. 旧项目读取
  - C. existing gitdir 保持
  - D. /var 与 /private/var 视为同路径
  - E. duplicate repo-map 收敛
  - F. getGitdir 不生成重复仓库
  - G. relocation old→new
  - H. projectId 保持
  - I. gitdir 保持
  - J. old mapping 删除
  - K. new mapping 写入
  - L. projects.json 与 repo-map 一致
  - M. relocation 写失败 rollback
  - N. corrupted repo-map 不清空
  - O. corrupted projects.json 不重建覆盖
  - P. legacy migration
  - Q. remove project 只删除 metadata/mapping
  - R. 不删除真实 worktree
  - S. 不删除 gitdir
- **既有回归测试**：
  - `verify-project-relocation.ts`：19/19 全部通过（100%）。
  - `verify-push-core.ts`：全部场景通过（100%）。
  - `verify-force-push-local.ts`：全部场景通过（100%）。
  - `verify-release.ts`：全部场景通过（100%）。
- **TypeScript 诊断**：全项目 0 errors。

## 2026/09/05 GitHub Push 401 Unauthorized 鉴权失败排查与修复

### 问题背景
在 GitHub Push 过程中报错 HTTP 401 Unauthorized。

### 根因分析
1. **Scripting Keychain 运行时行为**：当调用 `Keychain.get(key)` 读取不存在的键时，Scripting 运行时返回 `undefined`（而非类型声明中标记的 `null`）。
2. **凭据读取回退穿透失效**：在 `GitRepository.ts` 的 `getRemoteCredential()` 中，使用 `if (value === null)` 判断是否命中缓存。当项目尚未在新的 `projectId` 维度键存储凭据时，`value` 为 `undefined`，导致该判断为 `false`，从而跳过了对旧版 `legacyCredentialKey`（内含有效 Token）的回退读取；紧接着对 `undefined` 执行 `JSON.parse` 抛出 `SyntaxError`，被 `catch` 捕获后直接返回 `null`。
3. **isomorphic-git onAuth 契约**：由于 `getRemoteCredential()` 返回 `null`，`pushRemote` 在构造 isomorphic-git 参数时将 `onAuth` 设为 `undefined`，推送请求未附带 Authorization 头部，GitHub 拒绝未授权操作并抛出 HTTP 401。

### 修复措施
1. **空值兼容**：在 `GitRepository.ts` 的 `getRemoteCredential()` 与 `hasRemoteCredential()` 中，将空值判断从 `=== null` 改为 `value === null || value === undefined`，确保旧版凭据回退读取路径正常触发。
2. **认证格式统一**：在 `GitRepository.pushRemote()` 与 `fetchRemote()` 中统一使用 `onAuth: () => ({ username: "x-access-token", password: credential.password })`，符合 GitHub PAT 认证要求。
3. **Keychain 读取安全**：增加凭据 JSON schema 校验，禁止空 username/password 进入网络请求；所有认证失败错误统一脱敏，不记录 Token 内容。
4. **安全诊断**：增加 `hasCredential`、`username`、`tokenLength`、`projectId`、`remoteName` 等非敏感诊断字段，严格禁止打印 Token。

### 验证结果
- GitHub 普通 HTTPS：通过。
- `api.github.com`：通过。
- Fetch：通过。
- Push：在有效 Token 与仓库权限正确时通过；无效 Token 正确返回 401。
- `verify-token-status.ts`：Token 状态映射全部通过。
- TypeScript diagnostics：0 errors。

## 2026/09/05 GitHub Push TLS 失败排查与修复

### 诊断结论
- `github.com` 普通 HTTPS：通过。
- `api.github.com`：通过。
- Fetch：同样失败，确认问题在 isomorphic-git HTTP adapter，而非 Push 特有逻辑。
- 请求 host 诊断保持只输出 host，不输出 Authorization 或 Token。

### 修复
- `src/core/remote/HttpClient.ts`：复用 Scripting `fetch` / `Request` 的原生 HTTPS 能力，去除错误的代理/localhost/Cloudflare 地址拼接；保留证书校验和 HTTPS 安全等级。
- Push 与 Fetch 共用同一 HTTP adapter。

### 验证结果
- 普通 GitHub HTTPS 与 API HTTPS 均成功；Fetch/Push 复测通过；TypeScript diagnostics：0 errors。

## 2026/09/05 GitHub 设置页完善

### 修改文件

- `src/ui/SourceControlSettingsView.tsx`
- `src/ui/SourceControlRemoteView.tsx`
- `src/ui/SourceControlReleaseView.tsx`
- `src/ui/localization.ts`

### 实现内容

- Settings / GitHub 区域包含 Repository URL、Token 状态、当前分支、Remote 状态、Fetch、Push、Force Push 和 Clear Token。
- Remote URL 编辑复用 `validateSupportedRemoteUrl()`；当前仅允许 HTTPS，并拒绝控制字符、空 hostname、`http`、`ftp`、`file` 等地址。
- Token 只通过现有 GitService Keychain API 保存和读取，不展示 Token 内容。
- GitHub 状态检查调用 `checkGithubToken()`；按 200/401/403 映射 Verified / Verification Failed / Insufficient Permission，并在成功后刷新 fetch 后的 Remote 分支和 ahead/behind。
- Force Push 保持 Core 不变，UI 层执行双确认并使用 `forcePushLock` 防止重复触发。
- 错误使用 `ErrorSection`，操作期间使用 `LoadingSection`。

### 验证结果

- `verify-remote-validation.ts`：通过。
- `verify-token-status.ts`：通过。
- `verify-remote-token-lifecycle.ts`：通过。
- TypeScript diagnostics：0 errors。

## 2026/09/06 JsonStore 与 GitSyncHistory 数据安全

### 修改文件

- `src/core/storage/JsonStore.ts`
- `src/core/GitSyncHistory.ts`
- `verify-json-store-sync-history.ts`

### 实现内容

- `JsonStore` 新增 `readStrict()`、`readOrFallback()` 与更安全的 `writeAtomic()`。
- `writeAtomic()` 使用 timestamp + random 临时文件名；写入后重新读取并 JSON parse 自校验；替换失败时恢复旧文件；清理过期 `.tmp.*` 文件。
- `GitSyncHistory` 使用 `readStrict()`；增加文件级异步锁；`recordSync()` 在锁内完成 read → modify → write，避免并发写入丢记录。
- 增加记录 schema 校验：整体 JSON 损坏或顶层结构错误抛错；单条无效记录跳过并记录诊断。

### 验证结果

- `verify-json-store-sync-history.ts`：专项场景通过，包括 JSON 损坏、atomic write 失败回滚、临时文件清理、并发 `recordSync()` 不丢记录、单条无效记录跳过、整体结构损坏报错。
- TypeScript diagnostics：0 errors。

## 2026/09/06 Remote URL / Token 生命周期

### 修改文件

- `src/core/remote/RemoteValidation.ts`
- `src/ui/SourceControlSettingsView.tsx`
- `src/ui/SourceControlReleaseView.tsx`
- `src/ui/SourceControlRemoteView.tsx`
- `src/ui/localization.ts`
- `verify-remote-validation.ts`
- `verify-token-status.ts`
- `verify-remote-token-lifecycle.ts`

### 实现内容

- Remote URL 校验拆分为 syntax / supported 两层，当前仅支持 HTTPS；拒绝 `ftp://`、`file://`、`http://`、无 hostname、控制字符和无效 URL。
- Remote identity 使用规范化 host/owner/repository 比较，`.git` 与非 `.git` 形式视为同仓库。
- 修改 Remote URL 时，仅当仓库 identity 变化才询问保留或清除 Token；等价 URL 规范化不提示。
- 删除 Remote 时二次确认是否同时删除对应 Keychain credential；默认不偷偷删除。
- Token 状态区分未配置、已配置未验证、验证成功、验证失败和权限不足；主动检查时调用 GitHub API 并刷新远端状态。

### 验证结果

- `verify-remote-validation.ts`：通过。
- `verify-token-status.ts`：通过。
- `verify-remote-token-lifecycle.ts`：通过。
- TypeScript diagnostics：0 errors。

## 2026/09/07 GitSyncHistory 长期存储裁剪

### 修改文件

- `src/core/GitSyncHistory.ts`
- `verify-sync-history-retention.ts`
- `docs/refactor-record.md`

### 实现内容

- 新增 `trimSyncRecords(records)` helper。
- 每个 `project + remote + branch` bucket 在 `recordSync()` 写入前按 `syncedAt` 倒序排序，并截取最近 200 条。
- 如果最近 200 条中没有 `kind: "baseline"`，额外保留该 bucket 中最近一条有效 baseline，因此该特殊情况下最多 201 条。
- legacy sync history 迁移合并写回时同样应用裁剪规则。
- 保留现有文件级 Promise 锁，确保并发 `recordSync()` 的 `read → modify → trim → write` 不丢记录。

### 验证结果

- `verify-sync-history-retention.ts`：专项验证全部通过，覆盖少于 200 条不裁剪、超过 200 条保留最近记录、push / force-push 顺序、baseline 保留、不同 project/remote/branch 隔离以及并发裁剪。
- `verify-json-store-sync-history.ts`：既有 JsonStore / GitSyncHistory 专项验证通过。
- TypeScript diagnostics：0 errors。

### 范围确认

本轮未修改 Push、Force Push、Compare 对齐算法、ProjectRegistry、credential 或 UI。

## 2026/09/07 Remote 删除后状态一致性

### 修改文件

- `src/ui/SourceControlSettingsView.tsx`
- `src/ui/SourceControlRemoteView.tsx`
- `verify-remote-delete-consistency.ts`
- `docs/refactor-record.md`

### 实现内容

- Settings 删除 Remote 成功后统一重新读取 `remotes`、current branch、repository status、Remote branches、credential、`tokenStatus` 与 ahead/behind。
- 删除 Remote + Token 时，删除成功后状态立即归零并显示 `not-configured`；仅删除 Remote 时保留对应 Keychain credential，并显示“已配置，未绑定 Remote”。
- Settings 的状态读取增加 request sequence；删除/清除 Token 会使删除前已发出的旧请求失效。
- Remote 页面增加 request sequence，旧的 reload/fetch 结果不能覆盖最新状态；Push / Pull / Force Push 完成后的状态更新统一经过受保护的 reload。
- 从 Remote 页面进入 Settings 返回后显式重新读取 Remote；删除后清空旧 URL、分支和 ahead/behind。

### 验证结果

- `scripting-ts run verify-remote-delete-consistency.ts`：13 项断言通过，覆盖删除 Remote + Token、仅删除 Remote、取消删除、删除后重新添加 Remote，以及旧请求晚返回。
- `verify-remote-token-lifecycle.ts`：通过。
- `verify-ui-race-fixes.ts`：通过。
- TypeScript diagnostics：0 errors。

### 范围确认

本轮未修改 Git Core、credential key、Push / Pull / Force Push 实现、ProjectRegistry 或 UI Design System。

## 2026/09/07 Settings / Remote Remote 状态加载收敛

### 修改文件

- `src/ui/useRemoteStatus.ts`
- `src/ui/SourceControlSettingsView.tsx`
- `src/ui/SourceControlRemoteView.tsx`
- `src/ui/pages/SourceControlChangesPage.tsx`
- `src/ui/index.ts`
- `verify-remote-status.ts`
- `docs/refactor-record.md`

### 实现内容

- 新增小型 `useRemoteStatus()` 与 `readRemoteStatus()`，统一读取 `remotes`、selected Remote、Remote branches、current branch、credential、credential binding、ahead/behind、loading、error 和 latest-request-wins。
- Settings 保留 `checked` 与主动 GitHub Token 验证结果的页面语义；Remote 页面按需读取 `hasLocalCommit`。共享 hook 不包含 Push、Pull、Force Push、Dialog 或 Navigation。
- 统一 preferred Remote → `origin` → 首个 Remote 的选择规则；删除 Remote 后可按 Remote name 继续读取未绑定的 Keychain credential。
- Settings 与 Remote 的添加、修改、删除、Token、Check、Fetch 和 Settings 返回刷新均改用共享 refresh；Remote 页面将过期刷新结果视为 `null`，不会继续驱动操作。
- Remote 页面接收 `projectPath`，用于项目切换时使旧异步请求失效。

### 验证结果

- `verify-remote-status.ts`：通过，覆盖两页面投影一致、origin fallback、preferred fallback、无 Remote、仅删除 Remote 的未绑定 credential，以及旧请求晚返回。
- `verify-remote-delete-consistency.ts`：通过。
- `verify-remote-token-lifecycle.ts`：通过。
- `verify-ui-race-fixes.ts`：通过。
- 全项目 TypeScript diagnostics：0 errors。

### 范围确认

本轮未修改 Git Core、credential key、RemoteValidation、ProjectRegistry、Push / Pull / Force Push Core 或 UI Design System。

