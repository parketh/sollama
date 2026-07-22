import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expectedArtifacts, PHASE_IDS, RunStatus } from "./run-status-schema.ts"

const SCRIPT = join(import.meta.dir, "update-run-status.ts")
const AUDIT_ID = "example-a1b2c3d-20260720-120000"

let tmp: string
let auditRoot: string
let prepPath: string
let statusPath: string

function run(args: string[]) {
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" })
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

function writePrepare(status: "ready" | "blocked") {
  const output = {
    schemaVersion: "1.0",
    step: "prepare",
    status,
    inputs: {
      schemaVersion: "1.0",
      auditId: AUDIT_ID,
      repoPath: join(tmp, "repo"),
      commitHash: "a1b2c3d4e5f6",
      auditScope: "",
      auditFocus: "",
    },
    summary: {
      blockers: status === "blocked" ? ["worktree is dirty at pinned commit"] : [],
      warnings: [],
    },
  }
  writeFileSync(prepPath, JSON.stringify(output, null, 2))
}

function loadStatus() {
  return RunStatus.parse(JSON.parse(readFileSync(statusPath, "utf8")))
}

function touchArtifacts(phaseId: string) {
  for (const artifact of expectedArtifacts(phaseId as never, auditRoot)) {
    mkdirSync(dirname(artifact), { recursive: true })
    writeFileSync(artifact, "x")
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "audit-status-"))
  auditRoot = join(tmp, "repo", ".sollama", "audits", AUDIT_ID)
  mkdirSync(auditRoot, { recursive: true })
  prepPath = join(auditRoot, "prepare-output.json")
  statusPath = join(auditRoot, "run-status.json")
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("init", () => {
  test("seeds a running state with prepare ready", () => {
    writePrepare("ready")
    expect(run(["init", prepPath]).code).toBe(0)
    const s = loadStatus()
    expect(s.status).toBe("running")
    expect(s.nextPhase).toBe("b-inspect")
    expect(s.phases[0]?.status).toBe("ready")
    expect(s.phases[0]?.artifactPaths).toEqual([prepPath])
  })

  test("seeds a blocked state when prepare is blocked", () => {
    writePrepare("blocked")
    expect(run(["init", prepPath]).code).toBe(0)
    const s = loadStatus()
    expect(s.status).toBe("blocked")
    expect(s.nextPhase).toBe("a-prepare")
    expect(s.phases[0]?.status).toBe("blocked")
    expect(s.blockers.length).toBeGreaterThan(0)
  })

  test("refuses to overwrite an existing run-status.json", () => {
    writePrepare("ready")
    run(["init", prepPath])
    run(["start", statusPath, "b-inspect"])
    const before = readFileSync(statusPath, "utf8")
    expect(run(["init", prepPath]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })
})

describe("start", () => {
  beforeEach(() => {
    writePrepare("ready")
    run(["init", prepPath])
  })

  test("moves nextPhase to running and records an attempt", () => {
    expect(run(["start", statusPath, "b-inspect"]).code).toBe(0)
    const s = loadStatus()
    expect(s.phases[1]?.status).toBe("running")
    expect(s.phases[1]?.attempts).toBe(1)
    expect(s.phases[1]?.startedAt).toBeDefined()
    expect(s.status).toBe("running")
  })

  test("is idempotent for crash recovery, re-incrementing attempts", () => {
    run(["start", statusPath, "b-inspect"])
    expect(run(["start", statusPath, "b-inspect"]).code).toBe(0)
    const s = loadStatus()
    expect(s.phases[1]?.status).toBe("running")
    expect(s.phases[1]?.attempts).toBe(2)
    // State stays valid after the retry.
    expect(RunStatus.safeParse(s).success).toBe(true)
  })

  test("rejects starting a phase that is not nextPhase", () => {
    const before = readFileSync(statusPath, "utf8")
    expect(run(["start", statusPath, "c-static-analysis"]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })

  test("rejects starting an already-ready phase", () => {
    expect(run(["start", statusPath, "a-prepare"]).code).not.toBe(0)
  })
})

describe("ready", () => {
  beforeEach(() => {
    writePrepare("ready")
    run(["init", prepPath])
    run(["start", statusPath, "b-inspect"])
  })

  test("rejects readiness when a required artifact is missing", () => {
    const before = readFileSync(statusPath, "utf8")
    expect(run(["ready", statusPath, "b-inspect"]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })

  test("records artifacts and advances nextPhase once outputs exist", () => {
    touchArtifacts("b-inspect")
    expect(run(["ready", statusPath, "b-inspect"]).code).toBe(0)
    const s = loadStatus()
    expect(s.phases[1]?.status).toBe("ready")
    expect(s.nextPhase).toBe("c-static-analysis")
    expect(s.phases[1]?.artifactPaths).toEqual(expectedArtifacts("b-inspect" as never, auditRoot))
  })

  test("rejects re-readying a completed phase", () => {
    touchArtifacts("b-inspect")
    run(["ready", statusPath, "b-inspect"])
    expect(run(["ready", statusPath, "b-inspect"]).code).not.toBe(0)
  })

  test("drives the run to complete through every phase", () => {
    for (const id of PHASE_IDS.slice(1)) {
      run(["start", statusPath, id])
      touchArtifacts(id)
      expect(run(["ready", statusPath, id]).code).toBe(0)
    }
    const s = loadStatus()
    expect(s.status).toBe("complete")
    expect(s.nextPhase).toBeNull()
    expect(s.phases.every((p) => p.status === "ready")).toBe(true)
  })
})

describe("block", () => {
  beforeEach(() => {
    writePrepare("ready")
    run(["init", prepPath])
    touchArtifacts("b-inspect")
    run(["start", statusPath, "b-inspect"])
    run(["ready", statusPath, "b-inspect"])
  })

  test("blocks the run and preserves resume action", () => {
    run(["start", statusPath, "c-static-analysis"])
    expect(
      run(["block", statusPath, "c-static-analysis", "cargo-audit missing", "install cargo-audit"])
        .code,
    ).toBe(0)
    const s = loadStatus()
    expect(s.status).toBe("blocked")
    expect(s.nextPhase).toBe("c-static-analysis")
    expect(s.phases[2]?.status).toBe("blocked")
    expect(s.phases[2]?.blockers[0]?.resumeAction).toBe("install cargo-audit")
    expect(s.blockers.length).toBeGreaterThan(0)
  })

  test("a blocked phase can be resumed with start", () => {
    run(["start", statusPath, "c-static-analysis"])
    run(["block", statusPath, "c-static-analysis", "cargo-audit missing", "install cargo-audit"])
    expect(run(["start", statusPath, "c-static-analysis"]).code).toBe(0)
    const s = loadStatus()
    expect(s.status).toBe("running")
    expect(s.phases[2]?.status).toBe("running")
    expect(s.phases[2]?.blockers).toEqual([])
  })
})

describe("sequencing guards", () => {
  beforeEach(() => {
    writePrepare("ready")
    run(["init", prepPath])
    touchArtifacts("b-inspect")
  })

  test("rejects readying a pending phase that was never started", () => {
    const before = readFileSync(statusPath, "utf8")
    expect(run(["ready", statusPath, "b-inspect"]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })

  test("rejects blocking a pending phase that was never started", () => {
    const before = readFileSync(statusPath, "utf8")
    expect(run(["block", statusPath, "b-inspect", "tool missing", "install it"]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })
})

describe("corruption safety", () => {
  test("an invalid run-status.json is left unchanged on a failed transition", () => {
    writeFileSync(statusPath, "{ not valid json ")
    const before = readFileSync(statusPath, "utf8")
    expect(run(["start", statusPath, "b-inspect"]).code).not.toBe(0)
    expect(readFileSync(statusPath, "utf8")).toBe(before)
  })
})
