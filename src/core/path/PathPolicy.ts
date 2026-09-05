export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

export function sameProjectPath(left: string, right: string): boolean {
  return normalizeProjectPath(left) === normalizeProjectPath(right)
}

export function joinProjectPath(basePath: string, relativePath: string): string {
  const base = normalizeProjectPath(basePath)
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  return relative ? `${base}/${relative}` : base
}

export function sanitizeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!normalized || normalized === ".") return "."
  if (normalized.split("/").some((segment) => segment === "..")) throw new Error("Unsafe relative path")
  return normalized
}
