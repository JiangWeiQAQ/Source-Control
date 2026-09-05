import { Script } from "scripting"
import { createFetchHttpClient } from "./src/core/remote/RemoteValidation"

async function traceFetchClient() {
  const http = createFetchHttpClient()
  console.log("Calling http.request for git-receive-pack info/refs...")
  const timer = setTimeout(() => {
    console.log("Timeout reached 15s!")
    Script.exit({ timeout: true })
  }, 15000)

  try {
    const res = await http.request({
      url: "https://github.com/JiangWeiQAQ/Source-Control/info/refs?service=git-receive-pack",
      method: "GET",
      headers: {
        "User-Agent": "git/1.0"
      }
    })
    clearTimeout(timer)
    console.log("Status:", res.statusCode)
    console.log("Headers:", JSON.stringify(res.headers))
    let bodyBytes = 0
    if (res.body) {
      for await (const chunk of res.body) {
        bodyBytes += chunk.length
      }
    }
    console.log("Body bytes received:", bodyBytes)
    Script.exit({ ok: true, status: res.statusCode, bodyBytes })
  } catch (err: any) {
    clearTimeout(timer)
    console.log("Error:", err?.message || String(err))
    console.log("Stack:", err?.stack)
    Script.exit({ ok: false, error: err?.message, stack: err?.stack })
  }
}

traceFetchClient().catch((e) => {
  Script.exit({ crash: String(e) })
})
