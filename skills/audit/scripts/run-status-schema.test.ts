import { describe, expect, test } from "bun:test"
import { expectedArtifacts, PHASE_IDS, RunStatus } from "./run-status-schema.ts"

const AUDIT_ROOT = "/tmp/example/.sollama/audits/example-a1b2c3d-20260720-120000"

type Over = Record<string, unknown>

type LoosePhase = {
  id: string
  status: string
  attempts: number
  artifactPaths: string[]
  blockers: unknown[]
  startedAt?: string
  completedAt?: string
}

type LooseStatus = {
  schemaVersion: string
  auditId: string
  repoPath: string
  commitHash: string
  status: string
  createdAt: string
  updatedAt: string
  nextPhase: string | null
  phases: LoosePhase[]
  blockers: unknown[]
}

function phase(id: string, over: Over = {}): LoosePhase {
  return { id, status: "pending", attempts: 0, artifactPaths: [], blockers: [], ...over }
}

function readyPhase(id: string, over: Over = {}): LoosePhase {
  return phase(id, {
    status: "ready",
    attempts: 1,
    artifactPaths: expectedArtifacts(id as never, AUDIT_ROOT),
    startedAt: "2026-07-20T12:00:00.000Z",
    completedAt: "2026-07-20T12:10:00.000Z",
    ...over,
  })
}

function baseRunning(): LooseStatus {
  const phases = PHASE_IDS.map((id, i) => (i === 0 ? readyPhase(id) : phase(id)))
  return {
    schemaVersion: "1.0",
    auditId: "example-a1b2c3d-20260720-120000",
    repoPath: "/tmp/example",
    commitHash: "a1b2c3d4e5f6",
    status: "running",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:10:00.000Z",
    nextPhase: "b-inspect",
    phases,
    blockers: [],
  }
}

function baseComplete(): LooseStatus {
  return {
    ...baseRunning(),
    status: "complete",
    nextPhase: null,
    phases: PHASE_IDS.map((id) => readyPhase(id)),
  }
}

function baseBlocked(): LooseStatus {
  const blocker = { message: "cargo build-sbf not installed", resumeAction: "install and resume" }
  const phases = PHASE_IDS.map((id, i) => {
    if (i === 0) return readyPhase(id)
    if (i === 1) return phase(id, { status: "blocked", attempts: 1, blockers: [blocker] })
    return phase(id)
  })
  return {
    ...baseRunning(),
    status: "blocked",
    nextPhase: "b-inspect",
    phases,
    blockers: [blocker],
  }
}

describe("expectedArtifacts", () => {
  test("returns absolute canonical paths under the audit root", () => {
    expect(expectedArtifacts("a-prepare", AUDIT_ROOT)).toEqual([
      `${AUDIT_ROOT}/prepare-output.json`,
    ])
    expect(expectedArtifacts("e-organize", AUDIT_ROOT)).toEqual([
      `${AUDIT_ROOT}/organized-findings.json`,
      `${AUDIT_ROOT}/organized-findings.md`,
    ])
    expect(expectedArtifacts("g-report", AUDIT_ROOT)).toEqual([`${AUDIT_ROOT}/report/report.md`])
  })
})

describe("PHASE_IDS", () => {
  test("is the seven canonical phases in order", () => {
    expect(PHASE_IDS).toEqual([
      "a-prepare",
      "b-inspect",
      "c-static-analysis",
      "d-agent-fanout",
      "e-organize",
      "f-verify",
      "g-report",
    ])
  })
})

describe("RunStatus", () => {
  test("accepts a valid running state", () => {
    expect(RunStatus.safeParse(baseRunning()).success).toBe(true)
  })

  test("accepts a valid complete state", () => {
    expect(RunStatus.safeParse(baseComplete()).success).toBe(true)
  })

  test("accepts a valid blocked state", () => {
    expect(RunStatus.safeParse(baseBlocked()).success).toBe(true)
  })

  test("rejects duplicate phases", () => {
    const s = baseRunning()
    s.phases[1] = phase("a-prepare")
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects phases out of canonical order", () => {
    const s = baseRunning()
    ;[s.phases[1], s.phases[2]] = [phase("c-static-analysis"), phase("b-inspect")]
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects non-contiguous readiness", () => {
    const s = baseRunning()
    s.phases[2] = readyPhase("c-static-analysis")
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects more than one running phase", () => {
    const s = baseRunning()
    s.phases[1] = phase("b-inspect", { status: "running", attempts: 1 })
    s.phases[2] = phase("c-static-analysis", { status: "running", attempts: 1 })
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a blocked overall status with no blockers", () => {
    const s = baseBlocked()
    s.blockers = []
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a complete run that still has a nextPhase", () => {
    const s = baseComplete()
    s.nextPhase = "g-report"
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a nextPhase that is not the first incomplete phase", () => {
    const s = baseRunning()
    s.nextPhase = "c-static-analysis"
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a ready phase with no artifact paths", () => {
    const s = baseRunning()
    s.phases[0] = readyPhase("a-prepare", { artifactPaths: [] })
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a ready phase with no completedAt", () => {
    const s = baseRunning()
    s.phases[0] = readyPhase("a-prepare", { completedAt: undefined })
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a blocked phase with no blockers", () => {
    const s = baseBlocked()
    s.phases[1] = phase("b-inspect", { status: "blocked", attempts: 1, blockers: [] })
    expect(RunStatus.safeParse(s).success).toBe(false)
  })

  test("rejects a relative artifact path", () => {
    const s = baseRunning()
    s.phases[0] = readyPhase("a-prepare", { artifactPaths: ["relative/prepare-output.json"] })
    expect(RunStatus.safeParse(s).success).toBe(false)
  })
})
