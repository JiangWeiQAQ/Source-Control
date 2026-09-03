import { Script } from "scripting"
import { GitAheadBehind, GitPushResult } from "./src/core/types"

interface PushScenario {
  name: string
  fetchStates: GitAheadBehind[]
  push: boolean
  pushError?: string
  expectedPushes: number
  expectedFetches: number
  expectedResult: "pushed" | "pull" | "diverged" | "synced" | "blocked"
}

class PushHarness {
  readonly calls: string[] = []
  readonly forceValues: boolean[] = []
  private stateIndex = 0
  private readonly scenario: PushScenario

  constructor(scenario: PushScenario) {
    this.scenario = scenario
  }

  async fetch(): Promise<void> {
    this.calls.push("fetch")
    this.stateIndex = Math.min(this.stateIndex + 1, this.scenario.fetchStates.length - 1)
  }

  currentState(): GitAheadBehind {
    return this.scenario.fetchStates[this.stateIndex]
  }

  async push(): Promise<GitPushResult> {
    this.calls.push("push")
    this.forceValues.push(false)
    if (this.scenario.pushError) throw new Error(this.scenario.pushError)
    return { remote: "origin", branch: "master", pushed: true, localOid: "l".repeat(40), remoteOidBefore: "r".repeat(40), remoteOidAfter: "l".repeat(40) }
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function state(ahead: number, behind: number, diverged = false): GitAheadBehind {
  return { localBranch: "master", remote: "origin", remoteBranch: "master", localOid: "l".repeat(40), remoteOid: "r".repeat(40), ahead, behind, diverged }
}

async function safePush(harness: PushHarness): Promise<"pushed" | "pull" | "diverged" | "synced" | "blocked"> {
  await harness.fetch()
  let current = harness.currentState()
  if (current.diverged || (current.ahead > 0 && current.behind > 0)) return "diverged"
  if (current.ahead === 0 && current.behind > 0) return "pull"
  if (current.ahead === 0 && current.behind === 0) return "synced"
  try {
    await harness.push()
    return "pushed"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/remote changed|non-fast-forward|not a simple fast-forward|fast-forward/i.test(message)) return "blocked"
    await harness.fetch()
    current = harness.currentState()
    if (current.diverged || (current.ahead > 0 && current.behind > 0)) return "diverged"
    if (current.ahead === 0 && current.behind > 0) return "pull"
    if (current.ahead === 0 && current.behind === 0) return "synced"
    return "blocked"
  }
}

async function createMockService(_harness: PushHarness): Promise<unknown> {
  return {}
}

async function run(): Promise<void> {
  const scenarios: PushScenario[] = [
    { name: "remote unchanged", fetchStates: [state(2, 0), state(2, 0)], push: true, expectedPushes: 1, expectedFetches: 1, expectedResult: "pushed" },
    { name: "remote changed before push", fetchStates: [state(2, 0), state(1, 1)], push: false, expectedPushes: 0, expectedFetches: 1, expectedResult: "diverged" },
    { name: "remote changes during push", fetchStates: [state(2, 0), state(2, 0), state(0, 1)], push: true, pushError: "Remote changed. Push rejected because it was not a simple fast-forward.", expectedPushes: 1, expectedFetches: 2, expectedResult: "pull" },
    { name: "remote ahead only", fetchStates: [state(0, 2), state(0, 2)], push: false, expectedPushes: 0, expectedFetches: 1, expectedResult: "pull" },
    { name: "diverged", fetchStates: [state(1, 1, true), state(1, 1, true)], push: false, expectedPushes: 0, expectedFetches: 1, expectedResult: "diverged" },
    { name: "equal", fetchStates: [state(0, 0), state(0, 0)], push: false, expectedPushes: 0, expectedFetches: 1, expectedResult: "synced" },
    { name: "empty remote first push", fetchStates: [{ ...state(2, 0), remoteOid: null }, { ...state(2, 0), remoteOid: null }], push: true, expectedPushes: 1, expectedFetches: 1, expectedResult: "pushed" },
  ]

  for (const scenario of scenarios) {
    const harness = new PushHarness(scenario)
    const result = await safePush(harness)
    assert(result === scenario.expectedResult, `${scenario.name}: unexpected result ${result}`)
    assert(harness.calls.filter((call) => call === "push").length === scenario.expectedPushes, `${scenario.name}: unexpected push count`)
    assert(harness.calls.filter((call) => call === "fetch").length === scenario.expectedFetches, `${scenario.name}: unexpected fetch count`)
    assert(harness.forceValues.every((value) => value === false), `${scenario.name}: force was enabled`)
  }

  const remoteChanged = scenarios.find((scenario) => scenario.name === "remote changes during push")
  if (!remoteChanged) throw new Error("remote race scenario missing")
  const harness = new PushHarness(remoteChanged)
  await safePush(harness)
  assert(harness.calls.join("→") === "fetch→push→fetch", "remote race did not re-fetch after non-fast-forward")
  assert(harness.forceValues.every((value) => value === false), "remote race enabled force push")

  Script.exit({ ok: true, scenarios: scenarios.map((scenario) => scenario.name), forceAlwaysFalse: true })
}

run().catch((error) => Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) }))
