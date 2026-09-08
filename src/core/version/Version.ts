/**
 * Version.ts
 * 统一 SemVer 2.0 版本号校验与规范化工具
 */

/**
 * 官方标准 SemVer 2.0 正则表达式
 * 匹配：MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
 * - 核心版本：0|[1-9]\d*，禁止前导零（如 01.0.0 非法）
 * - 预发布标识（prerelease）：以破折号连接的由句点分隔的标识符集合，数值标识符不得有前导零
 * - 构建元数据（build）：以加号连接的由句点分隔的标识符集合，可以包含字母数字和破折号
 */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * 校验版本号是否符合 SemVer 2.0 规范
 * @param value 待检查的值
 * @returns 是否为有效的 SemVer 2.0 字符串
 */
export function isValidVersion(value: unknown): value is string {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return SEMVER_REGEX.test(trimmed)
}

/**
 * 校验并返回修剪后的版本号，如果不合法则返回 null
 * @param value 待解析的值
 * @returns 合法的版本号字符串（经过 trim），否则返回 null
 */
export function validateVersion(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return SEMVER_REGEX.test(trimmed) ? trimmed : null
}
