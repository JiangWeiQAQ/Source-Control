export class JsonStore {
  static async read<T>(filePath: string, fallback: T): Promise<T> {
    if (!(await FileManager.exists(filePath))) return fallback
    try {
      return JSON.parse(await FileManager.readAsString(filePath, "utf8")) as T
    } catch {
      return fallback
    }
  }

  static async write<T>(filePath: string, data: T): Promise<void> {
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/"))
    if (parentDir && !(await FileManager.exists(parentDir))) await FileManager.createDirectory(parentDir, true)
    await FileManager.writeAsString(filePath, JSON.stringify(data, null, 2), "utf8")
  }

  static async writeAtomic<T>(filePath: string, data: T): Promise<void> {
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/"))
    if (parentDir && !(await FileManager.exists(parentDir))) await FileManager.createDirectory(parentDir, true)
    const tempPath = `${filePath}.tmp.${Date.now()}`
    const json = JSON.stringify(data, null, 2)
    await FileManager.writeAsString(tempPath, json, "utf8")
    if (await FileManager.exists(filePath)) await FileManager.remove(filePath)
    await FileManager.rename(tempPath, filePath)
  }
}
