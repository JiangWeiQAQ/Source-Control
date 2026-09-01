export interface UploadSafetyFinding {
  file: string
  severity: "critical" | "sensitive" | "review"
  type: string
  message: string
}

const HIGH_RISK_NAMES = [
  /^\.env(?:\..*)?$/i,
  /^credentials?(?:\..*)?$/i,
  /^secrets?(?:\..*)?$/i,
  /^tokens?(?:\..*)?$/i,
  /^passwords?(?:\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_(?:rsa|ed25519)$/i,
  /^service-account.*\.json$/i,
  /^(?:auth|cookies?)\.json$/i,
]

const CONTENT_RULES: Array<{ pattern: RegExp; severity: UploadSafetyFinding["severity"]; type: string; message: string }> = [
  { pattern: /ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/i, severity: "critical", type: "personal-access-token", message: "可能包含访问令牌" },
  { pattern: /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/i, severity: "critical", type: "private-key", message: "检测到私钥内容" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i, severity: "critical", type: "authorization", message: "检测到 Bearer Authorization" },
  { pattern: /(?:api[_-]?key|secret[_-]?key|apikey)\s*[:=]\s*[^\s,;]+/i, severity: "critical", type: "api-key", message: "检测到疑似 API Key" },
  { pattern: /(?:password|passwd)\s*[:=]\s*[^\s,;]+/i, severity: "critical", type: "password", message: "检测到疑似密码" },
  { pattern: /(?:access_token|refresh_token|token)\s*[:=]\s*[^\s,;]+/i, severity: "critical", type: "token", message: "检测到疑似 Token" },
  { pattern: /AKIA[0-9A-Z]{16}/, severity: "critical", type: "aws-access-key", message: "检测到疑似 AWS Access Key" },
  { pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/, severity: "review", type: "email", message: "可能包含个人邮箱" },
  { pattern: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/, severity: "review", type: "phone", message: "可能包含电话号码" },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, severity: "review", type: "ip-address", message: "可能包含 IP 地址" },
]

function relativePath(root: string, path: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export async function scanUploadFiles(projectPath: string): Promise<UploadSafetyFinding[]> {
  const findings: UploadSafetyFinding[] = []
  const entries = await FileManager.readDirectory(projectPath, true)
  for (const path of entries) {
    if (path === projectPath || path.includes("/.git/") || path.endsWith("/.git") || await FileManager.isDirectory(path)) continue
    const file = relativePath(projectPath, path)
    if (!file || file.startsWith(".") && file !== ".env" || file.split("/").some((part) => part === ".git")) continue
    const basename = file.split("/").pop() || file
    for (const rule of HIGH_RISK_NAMES) {
      if (rule.test(basename)) {
        findings.push({ file, severity: "critical", type: "sensitive-filename", message: "文件名可能包含敏感信息" })
        break
      }
    }
    let text = ""
    try {
      const bytes = await FileManager.readAsBytes(path)
      if (bytes.length > 1024 * 1024) continue
      text = new TextDecoder().decode(bytes)
    } catch {
      continue
    }
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(text)) findings.push({ file, severity: rule.severity, type: rule.type, message: rule.message })
    }
  }
  return findings
}

export function summarizeUploadFindings(findings: UploadSafetyFinding[]): string {
  if (findings.length === 0) return "未发现明显敏感信息"
  return `发现 ${findings.length} 项需要检查`
}
