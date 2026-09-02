# Source Control 源码管理器

**Source Control** 是一款专为 iOS [Scripting](https://scripting.app) 打造的专业级 Git 版本控制与源码管理插件。

通过底层集成 `isomorphic-git` 引擎，并创新性地采用 **App Group 本地物理存储隔离** 方案，彻底解决了 iCloud 频繁同步 `.git` 目录碎片文件导致的性能卡顿与冲突问题，为 iOS 移动端开发者提供原生、流畅且安全的 Git 工作流。

[![Version](https://img.shields.io/badge/version-1.0.0-indigo.svg)](script.json)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20iPadOS-lightgrey.svg)](https://scripting.app)
[![Language](https://img.shields.io/badge/language-TypeScript-blue.svg)](index.tsx)
[![Release](https://img.shields.io/github/v/release/JiangWeiQAQ/Source-Control?color=orange)](https://github.com/JiangWeiQAQ/Source-Control/releases/latest)

---

## 🚀 安装与导入 (Installation)

### 方式 1：从 GitHub 一键导入 Scripting (One-Click Import)

> **请点击下方的 HTTPS 中转链接**。GitHub 为安全起见会过滤 `scripting://` 自定义协议，因此直接把 `scripting://...` 写进 README 在 GitHub 页面上不会真正跳转。

- 👉 [**点击一键导入 Source Control 到 Scripting（最新版）**](https://htmlpreview.github.io/?https://raw.githubusercontent.com/JiangWeiQAQ/Source-Control/master/docs/index.html)

打开中转页后会自动尝试呼起 Scripting；如果系统没有自动跳转，请点击页面中的按钮。该页面指向 `master` 分支，因此始终获取最新代码。

- [下载最新版 ZIP（手动导入备用）](https://github.com/JiangWeiQAQ/Source-Control/releases/download/v1.0.0/Source-Control.zip)

> **为什么不直接把 `scripting://` 放在 GitHub README 中？**  
> GitHub 会移除此类自定义协议的 `href`，页面上只保留文字，所以点击不会有反应。`scripting://import_scripts?...` 需要在支持自定义协议的环境（如 Safari 浏览器中转页）中调用。

### 方式 2：Git 克隆 (Clone via Git)
在 Scripting App 内置的 **Git 工具** 中输入仓库地址克隆，后续可直接在 App 内 Pull 获取更新：
```bash
https://github.com/JiangWeiQAQ/Source-Control.git
```

---

## 📱 界面预览 (Screenshots)

<p align="center">
  <img src="docs/screenshot-home.jpg" width="45%" alt="项目管理首页" />
  &nbsp;&nbsp;
  <img src="docs/screenshot-changes.jpg" width="45%" alt="变更与版本管理" />
</p>

---

## 🌟 核心特性 (Features)

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
- 🛡 **安全快照（Safety Snapshots）**：
  - 暂存与提交操作时可自动创建工作区快照，防止误丢代码。
  - 一键恢复历史快照至工作区。
- 📜 **提交历史与回溯**：
  - 完整的 Commit 历史时间线与详情查看。
  - 支持 Revert 撤销历史提交并自动生成还原 commit。
  - **AI 智能总结**：智能提炼提交变动要点。
- 🌐 **GitHub 远端同步**：
  - HTTPS 远端仓库管理与认证凭据安全存储（基于 Keychain）。
  - 支持 Fetch、Pull、Push 完整远端同步链路。
  - 上传敏感文件审查（避免凭据等外泄）。
- 🌍 **多语言支持**：内置英文与简体中文自适应界面。

---

## 📂 项目结构

```text
Source Control/
├── script.json          # Scripting 插件元数据配置
├── index.tsx            # 插件入口，呈现项目管理导航界面
├── docs/                # 中转页与文档静态资源
│   └── index.html       # Safari 一键唤起导入中转页
└── src/
    ├── core/            # 核心业务逻辑
    │   ├── GitService.ts       # Git 服务主调度与外观接口
    │   ├── GitRepository.ts    # isomorphic-git 底层封装与仓库操作
    │   ├── GitStatus.ts        # 文件状态检测与差异提取
    │   ├── GitDiff.ts          # 差异对比算法实现
    │   ├── GitSafety.ts        # 安全快照与备份管理
    │   └── types.ts            # 类型定义
    └── ui/              # 原生组件与页面
        ├── SourceControlProjectPickerView.tsx # 项目选择与管理
        ├── SourceControlChangesView.tsx       # 变更与提交主界面
        ├── SourceControlDiffView.tsx          # 差异对比视图
        ├── SourceControlHistoryView.tsx       # 提交历史视图
        ├── SourceControlRemoteView.tsx        # GitHub 远端同步
        ├── SourceControlSnapshotsView.tsx     # 安全快照管理
        └── ...
```

---

## 📄 开源许可

本项目基于 MIT 协议开源。
