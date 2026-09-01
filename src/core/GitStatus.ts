/**
 * GitStatus.ts
 * 负责解析 isomorphic-git 的 statusMatrix，生成统一的标准 Change 数据模型
 */

import { GitChange, GitFileStatus, GitIndexStatus, GitWorktreeStatus } from "./types"

export class GitStatus {
  /**
   * 将 isomorphic-git 的 statusMatrix 行数据解析为统一模型
   *
   * statusMatrix 返回 [filepath, head, workdir, stage]
   * head: 0 (不在 HEAD), 1 (在 HEAD 中存在)
   * workdir: 0 (在工作区不存在/已删), 1 (工作区与 stage 相同), 2 (工作区被修改或未暂存)
   * stage: 0 (未在暂存区), 1 (暂存区与 HEAD 相同), 2 (暂存区已暂存新内容), 3 (工作区删除但暂存区修改等复合状态)
   */
  static parseMatrixRow(row: [string, number, number, number]): GitChange {
    const [filepath, head, work, stage] = row
    const matrixTuple: [number, number, number] = [head, work, stage]
    const key = `${head}${work}${stage}`

    let status: GitFileStatus = "unknown"
    let staged = false
    let worktreeStatus: GitWorktreeStatus = "unmodified"
    let indexStatus: GitIndexStatus = "unmodified"

    switch (key) {
      // 003: 新建文件，已暂存但随后在工作区被删除
      case "003":
        status = "staged"
        staged = true
        worktreeStatus = "deleted"
        indexStatus = "added"
        break

      // 020: 新文件未跟踪 (Untracked)
      case "020":
        status = "untracked"
        staged = false
        worktreeStatus = "untracked"
        indexStatus = "absent"
        break

      // 022: 新文件已暂存 (Added/Staged)
      case "022":
        status = "added"
        staged = true
        worktreeStatus = "unmodified"
        indexStatus = "added"
        break

      // 023: 新文件已暂存，但工作区又做了修改
      case "023":
        status = "modified"
        staged = true
        worktreeStatus = "modified"
        indexStatus = "added"
        break

      // 100: 已删除且已暂存删除 (Deleted/Staged)
      case "100":
        status = "deleted"
        staged = true
        worktreeStatus = "deleted"
        indexStatus = "deleted"
        break

      // 101: 工作区已删除，但未暂存 (Deleted/Unstaged)
      case "101":
        status = "deleted"
        staged = false
        worktreeStatus = "deleted"
        indexStatus = "unmodified"
        break

      // 111: 无变更 (Unmodified)
      case "111":
        status = "unmodified"
        staged = false
        worktreeStatus = "unmodified"
        indexStatus = "unmodified"
        break

      // 110: 暂存了删除，但工作区又还原了 (文件与 HEAD 相同)
      case "110":
        status = "staged"
        staged = true
        worktreeStatus = "unmodified"
        indexStatus = "deleted"
        break

      // 112: 暂存了修改，但工作区又还原回 HEAD
      case "112":
        status = "staged"
        staged = true
        worktreeStatus = "unmodified"
        indexStatus = "modified"
        break

      // 113: 暂存了修改，工作区又变动且处于 stage 状态
      case "113":
        status = "modified"
        staged = true
        worktreeStatus = "modified"
        indexStatus = "modified"
        break

      // 120: 暂存了删除，工作区被重新修改
      case "120":
        status = "modified"
        staged = true
        worktreeStatus = "modified"
        indexStatus = "deleted"
        break

      // 121: 工作区被修改，未暂存 (Modified/Unstaged)
      case "121":
        status = "modified"
        staged = false
        worktreeStatus = "modified"
        indexStatus = "unmodified"
        break

      // 122: 修改已全部暂存 (Modified/Staged)
      case "122":
        status = "modified"
        staged = true
        worktreeStatus = "unmodified"
        indexStatus = "modified"
        break

      // 123: 修改已暂存，工作区又被再次修改 (Staged + Unstaged)
      case "123":
        status = "modified"
        staged = true
        worktreeStatus = "modified"
        indexStatus = "modified"
        break

      default:
        status = "unknown"
        staged = stage !== 0 && stage !== 1
        worktreeStatus = work === 0 ? "absent" : "modified"
        indexStatus = stage === 0 ? "absent" : stage === 2 ? "modified" : "unmodified"
        break
    }

    return {
      filepath,
      status,
      staged,
      worktreeStatus,
      indexStatus,
      matrix: matrixTuple,
    }
  }

  /** 将 statusMatrix 全量结果转换为 Change 列表（过滤掉 unmodified） */
  static parseMatrix(matrix: Array<[string, number, number, number]>): GitChange[] {
    const changes: GitChange[] = []
    for (const row of matrix) {
      // 111 为未修改文件，不纳入变更列表
      if (row[1] === 1 && row[2] === 1 && row[3] === 1) {
        continue
      }
      changes.push(GitStatus.parseMatrixRow(row))
    }
    return changes
  }
}
