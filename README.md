# Source Control 源码管理器

**Source Control** 是一款专为 iOS [Scripting](https://scripting.im) App 打造的专业级 Git 版本控制与源码管理插件。

通过底层集成 `isomorphic-git` 引擎，并创新性地采用 **App Group 本地物理存储隔离** 方案，彻底解决了 iCloud 频繁同步 `.git` 目录碎片文件导致的性能卡顿与冲突问题，为 iOS 移动端开发者提供原生、流畅且安全的 Git 工作流。

---

## 📲 一键安装与导入

在 iOS Safari 浏览器中点击下方按钮或链接即可直接一键唤起 Scripting 自动下载导入：

[![一键安装导入](https://img.shields.io/badge/Scripting-一键导入-5856D6?style=for-the-badge&logo=apple&logoColor=white)](https://jiangweiqaq.github.io/Source-Control/)

> **手动导入说明**：  
> 若浏览器未能自动唤起，可复制下方链接或通过 Releases 下载 Zip 解压到 Scripting 脚本目录：  
> ```text
> iCloud 云盘/Scripting/scripts/Source Control
> ```

---

## 📸 软件实际操作

<p align="center">
  <img src="docs/screenshot-home.jpg" width="45%" alt="项目管理首页" />
  &nbsp;&nbsp;
  <img src="docs/screenshot.jpg" width="45%" alt="变更与版本管理" />
</p>

---

## ✨ 核心特性

- 📱 **原生 iOS 风格界面**：基于 Scripting 原生 UI 组件构建，完美适配明暗模式，交互自然流畅。
- ⚡ **iCloud 隔离架构**：Git 元数据（`.git`）存储于 App Group 沙盒中，工作区保持纯净，杜绝 iCloud 频繁同步海量小文件造成的死锁与卡顿。
- 🔍 **智能状态与差异对比**：
  - 实时检测工作区新增（`A`）、修改（`M`）、删除（`D`）及未跟踪（`?`）状态。
  - 按文件夹分层浏览改动文件。
  - 支持清晰的行级差异对比（Diff）与行号高亮。
  - 支持单文件或批量丢弃改动（Restore）。
- 📦 **暂存区与版本提交**：
  - 支持全选暂存（Stage All）、取消暂存（Unstage All）以及细粒度暂存管理。
  - 极简清晰的提交工作流（选择 → 说明 → 保存 → 同步）。
- 🛡️ **安全快照（Safety Snapshots）**：
  - 在重构或高风险操作前一键创建工作区安全快照。
  - 随时安全恢复快照内容，防止代码意外丢失。
- 📜 **版本历史与回溯**：
  - 完整展示 Git 提交记录（Commit Hash、作者、时间、提交说明）。
  - 支持查看提交详情与变更文件清单。
  - 支持一键安全撤销提交（Revert Commit）。
  - 深度集成 **AI 总结**：一键生成单次提交或多次历史变更的智能总结。
- 🌐 **GitHub 远端同步**：
  - 支持配置 HTTPS 远端仓库（Remote）及多远端管理。
  - 支持 `Fetch`、`Push`、`Pull` 等远端操作与领先/落后（Ahead/Behind）状态检测。
  - 凭据安全托管：GitHub Personal Access Token (PAT) 保存在系统 **Keychain（钥匙串）** 中，严格保障安全。
  - 上传安全审查机制：自动检测大文件与敏感信息，防止敏感 Key 意外泄露到公网。
- 🌍 **多语言支持**：内置完善的简体中文与英文（Auto / zh-Hans / en）国际化切换。

---

## 🚀 快速上手指南

### 1. 管理项目
- 启动插件后，点击 **添加项目** 即可从 Scripting 脚本列表中选择需要进行版本控制的项目。
- 项目首次打开时会自动完成 Git 仓库初始化。

### 2. 提交改动
1. 在 **本地改动** 页面中勾选需要提交的文件（暂存）。
2. 点击 **版本说明** 输入 Commit Message。
3. 点击 **保存本地版本** 即可完成本地提交。

### 3. GitHub 远端同步
1. 点击右上角菜单进入 **GitHub 同步**。
2. 添加远端地址（如 `https://github.com/JiangWeiQAQ/Source-Control.git`）。
3. 配置 GitHub Token（Token 将妥善保存在 iOS Keychain 中）。
4. 点击 **获取远端状态 (Fetch)**，确认领先/落后状态后点击 **上传 (Push)** 或 **拉取 (Pull)**。

---

## ⚙️ 架构说明

```text
Source Control/
├── index.tsx                         # 插件入口与 Navigation 呈现
├── script.json                       # 插件元数据配置
├── docs/                             # 文档、一键导入中转页与演示截图
│   ├── index.html                    # Safari 一键导入中转页
│   ├── screenshot-home.jpg           # 项目首页截图
│   └── screenshot.jpg                # 变更管理界面截图
└── src/
    ├── core/                         # Git 核心驱动层
    │   ├── GitService.ts             # 统一服务门面 (Facade)
    │   ├── GitRepository.ts          # 仓储操作实现 (isomorphic-git 封装)
    │   ├── GitSafety.ts              # 安全快照与安全审查机制
    │   ├── GitDiff.ts                # 差异计算与行级对比
    │   ├── GitStatus.ts              # 状态矩阵解析
    │   └── types.ts                  # 数据模型与类型定义
    ├── ui/                           # 原生 UI 交互层
    │   ├── SourceControlProjectPickerView.tsx  # 项目选择与管理首页
    │   ├── SourceControlChangesView.tsx        # 变更与提交视图
    │   ├── SourceControlDiffView.tsx           # 代码 Diff 视图
    │   ├── SourceControlHistoryView.tsx        # 历史版本列表
    │   ├── SourceControlCommitDetailView.tsx   # 提交详情与 AI 总结
    │   ├── SourceControlRemoteView.tsx         # GitHub 远端与凭据管理
    │   ├── SourceControlSnapshotsView.tsx      # 安全快照管理
    │   └── SourceControlSettingsView.tsx       # 插件设置与语言偏好
    └── vendor/                       # 依赖 Polyfills 与 Bundle
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE)。欢迎提交 Issue 或 Pull Request！
