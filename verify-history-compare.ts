import { Script } from "scripting"
import { GitCommitInfo } from "./src/core/types"
import { alignHistory } from "./src/ui/SourceControlHistoryCompareView"

function commit(oid: string): GitCommitInfo { return { oid, shortOid: oid.slice(0, 7), message: oid, authorName: "Test", authorEmail: "test@example.com", timestamp: 1, parentOids: [] } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function describe(local: string[], remote: string[]): string[] { return alignHistory(local.map(commit), remote.map(commit)).map((row) => `${row.local?.oid || "-"}|${row.remote?.oid || "-"}`) }

async function run(): Promise<void> {
  const localAhead = describe(["D", "C", "B", "A"], ["C", "B", "A"])
  assert(JSON.stringify(localAhead) === JSON.stringify(["D|-", "C|C", "B|B", "A|A"]), "Local ahead 对齐失败")
  const equal = describe(["C", "B", "A"], ["C", "B", "A"])
  assert(JSON.stringify(equal) === JSON.stringify(["C|C", "B|B", "A|A"]), "Equal 对齐失败")
  const remoteAhead = describe(["B", "A"], ["C", "B", "A"])
  assert(JSON.stringify(remoteAhead) === JSON.stringify(["-|C", "B|B", "A|A"]), "Remote ahead 对齐失败")
  const diverged = describe(["L", "B", "A"], ["R", "B", "A"])
  assert(JSON.stringify(diverged) === JSON.stringify(["L|R", "B|B", "A|A"]), "Diverged 对齐失败")
  Script.exit({ ok: true, localAhead, equal, remoteAhead, diverged })
}
run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
