export class JsonStore {
  static async readStrict<T>(filePath: string): Promise<T> {
    if (!(await FileManager.exists(filePath))) {
      throw new Error(`JSON file does not exist: ${filePath}`)
    }
    const contents = await FileManager.readAsString(filePath, "utf8")
    return JSON.parse(contents) as T
  }

  static async readOrFallback<T>(filePath: string, fallback: T): Promise<T> {
    if (!(await FileManager.exists(filePath))) return fallback
    const contents = await FileManager.readAsString(filePath, "utf8")
    return JSON.parse(contents) as T
  }

  /** Legacy compatibility API: read failures still return the caller-provided fallback. */
  static async read<T>(filePath: string, fallback: T): Promise<T> {
    try {
      return await this.readOrFallback(filePath, fallback)
    } catch {
      return fallback
    }
  }

  static async write<T>(filePath: string, data: T): Promise<void> {
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/"))
    if (parentDir && !(await FileManager.exists(parentDir))) await FileManager.createDirectory(parentDir, true)
    await FileManager.writeAsString(filePath, JSON.stringify(data, null, 2), "utf8")
  }

  private static randomSuffix(): string {
    return `${Date.now()}.${Math.random().toString(36).slice(2, 12)}`
  }

  private static async cleanupExpiredTemps(filePath: string, parentDir: string): Promise<void> {
    const prefix = `${filePath.substring(filePath.lastIndexOf("/") + 1)}.tmp.`
    const now = Date.now()
    const expirationMs = 24 * 60 * 60 * 1000
    for (const entry of await FileManager.readDirectory(parentDir)) {
      if (!entry.startsWith(prefix)) continue
      const candidate = `${parentDir}/${entry}`
      try {
        const stat = await FileManager.stat(candidate)
        const modificationMs = stat.modificationDate > 1e11 ? stat.modificationDate : stat.modificationDate * 1000
        if (now - modificationMs >= expirationMs) await FileManager.remove(candidate)
      } catch {
        // A stale file may disappear between readDirectory and stat/remove.
      }
    }
  }

  static async writeAtomic<T>(filePath: string, data: T): Promise<void> {
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/"))
    if (parentDir && !(await FileManager.exists(parentDir))) await FileManager.createDirectory(parentDir, true)

    const json = JSON.stringify(data, null, 2)
    const tempPath = `${filePath}.tmp.${this.randomSuffix()}`
    const backupPath = `${filePath}.bak.${this.randomSuffix()}`
    let hasBackup = false

    await this.cleanupExpiredTemps(filePath, parentDir || ".")
    try {
      await FileManager.writeAsString(tempPath, json, "utf8")
      const writtenContents = await FileManager.readAsString(tempPath, "utf8")
      JSON.parse(writtenContents)

      if (await FileManager.exists(filePath)) {
        if (await FileManager.isDirectory(filePath)) throw new Error(`JSON target is a directory: ${filePath}`)
        await FileManager.rename(filePath, backupPath)
        hasBackup = true
      }

      try {
        await FileManager.rename(tempPath, filePath)
      } catch (error) {
        if (await FileManager.exists(filePath)) await FileManager.remove(filePath)
        if (hasBackup) await FileManager.rename(backupPath, filePath)
        hasBackup = false
        throw error
      }

      if (hasBackup && await FileManager.exists(backupPath)) {
        await FileManager.remove(backupPath)
        hasBackup = false
      }
    } finally {
      if (await FileManager.exists(tempPath)) await FileManager.remove(tempPath)
      if (hasBackup && await FileManager.exists(backupPath)) {
        try {
          await FileManager.rename(backupPath, filePath)
        } catch {
          // Preserve the original replacement error; the backup remains for recovery.
        }
      }
    }
  }
}
