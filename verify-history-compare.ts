import { Script } from "scripting"
import { GitCommitInfo } from "./src/core/types"
import { alignHistory } from "./src/ui/SourceControlHistoryCompareView"

function commit(oid: string): GitCommitInfo {
  return { oid, shortOid: oid.slice(0, 7), message: "same message", authorName: "Test", authorEmail: "test@example.com", timestamp: 1, parentOids: [] }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function describe(local: string[], remote: string[]): string[] { return alignHistory(local.map(commit), remote.map(commit)).map((row) => `${row.local?.oid || "-"}|${row.remote?.oid || "-"}`) }
function expectRows(actual: string[], expected: string[], label: string): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} 对齐失败: ${JSON.stringify(actual)}`) }

async function run(): Promise<void> {
  const equal = describe(["C", "B", "A"], ["C", "B", "A"])
  expectRows(equal, ["C|C", "B|B", "A|A"], "Equal")

  const localAhead1 = describe(["D", "C", "B", "A"], ["B", "A"])
  expectRows(localAhead1, ["D|-", "C|-", "B|B", "A|A"], "Local ahead 1")

  const localAhead3 = describe(["D3", "D2", "D1", "B", "A"], ["B", "A"])
  expectRows(localAhead3, ["D3|-", "D2|-", "D1|-", "B|B", "A|A"], "Local ahead 3")

  const remoteAhead1 = describe(["B", "A"], ["D", "C", "B", "A"])
  expectRows(remoteAhead1, ["-|D", "-|C", "B|B", "A|A"], "Remote ahead 1")

  const remoteAhead3 = describe(["B", "A"], ["D3", "D2", "D1", "B", "A"])
  expectRows(remoteAhead3, ["-|D3", "-|D2", "-|D1", "B|B", "A|A"], "Remote ahead 3")

  const diverged1x1 = describe(["L1", "B", "A"], ["R1", "B", "A"])
  expectRows(diverged1x1, ["L1|R1", "B|B", "A|A"], "Diverged 1 vs 1")

  const diverged2x2 = describe(["L2", "L1", "B", "A"], ["R2", "R1", "B", "A"])
  expectRows(diverged2x2, ["L2|R2", "L1|R1", "B|B", "A|A"], "Diverged 2 vs 2")

  const diverged3x1 = describe(["L3", "L2", "L1", "B", "A"], ["R1", "B", "A"])
  expectRows(diverged3x1, ["L3|R1", "L2|-", "L1|-", "B|B", "A|A"], "Diverged 3 vs 1")

  const diverged1x3 = describe(["L1", "B", "A"], ["R3", "R2", "R1", "B", "A"])
  expectRows(diverged1x3, ["L1|R3", "-|R2", "-|R1", "B|B", "A|A"], "Diverged 1 vs 3")

  const noCommonAncestor = describe(["L2", "L1"], ["R2", "R1"])
  expectRows(noCommonAncestor, ["L2|R2", "L1|R1"], "No common ancestor")

  // 完整 OID 才是身份：即使 shortOid 相同，也不能配成 shared。
  const sameShortDifferentOidLocal = `abcdef0${"1".repeat(33)}`
  const sameShortDifferentOidRemote = `abcdef0${"2".repeat(33)}`
  const fullOidIdentity = describe([sameShortDifferentOidLocal, "A"], [sameShortDifferentOidRemote, "A"])
  expectRows(fullOidIdentity, [`${sameShortDifferentOidLocal}|${sameShortDifferentOidRemote}`, "A|A"], "Full OID identity")

  Script.exit({ ok: true, scenarios: { equal, localAhead1, localAhead3, remoteAhead1, remoteAhead3, diverged1x1, diverged2x2, diverged3x1, diverged1x3, noCommonAncestor, fullOidIdentity } })
}
run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
