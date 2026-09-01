import { Navigation, Script } from "scripting"
import SourceControlProjectPickerView from "./src/ui/SourceControlProjectPickerView"

async function run(): Promise<void> {
  try {
    await Navigation.present(<SourceControlProjectPickerView />)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Source Control 启动失败: ${message}`)
  } finally {
    Script.exit()
  }
}

run().catch((error) => {
  console.error("Source Control 未处理的启动错误:", error)
  Script.exit()
})
