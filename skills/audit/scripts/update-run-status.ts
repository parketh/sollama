import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import {
  expectedArtifacts,
  PHASE_IDS,
  type PhaseId,
  RunStatus,
  type RunStatusType,
} from "./run-status-schema.ts"

const USAGE = `Usage:
  bun run update-run-status.ts init <prepare-output.json>
  bun run update-run-status.ts start <run-status.json> <phase-id>
  bun run update-run-status.ts ready <run-status.json> <phase-id> <artifact-path>...
  bun run update-run-status.ts block <run-status.json> <phase-id> <blocker> <resume-action>`

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function requireArg(value: string | undefined, label: string): string {
  if (!value) fail(`Missing ${label}.\n${USAGE}`)
  return value
}

function now(): string {
  return new Date().toISOString()
}

function isPhaseId(id: string): id is PhaseId {
  return (PHASE_IDS as readonly string[]).includes(id)
}

// Read, validate, and return the current orchestration state. A malformed file is
// a hard stop so no transition ever builds on invalid state.
function loadStatus(path: string): RunStatusType {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`Failed to read ${path}: ${error instanceof Error ? error.message : error}`)
  }
  const result = RunStatus.safeParse(parsed)
  if (!result.success)
    fail(`Invalid run-status.json at ${path}:\n${JSON.stringify(result.error.format(), null, 2)}`)
  return result.data
}

// Validate the next state, then write it atomically: a sibling temp file renamed
// over the target so a crash never leaves a partially written run-status.json.
function writeStatus(path: string, status: Record<string, unknown>): void {
  status.updatedAt = now()
  const result = RunStatus.safeParse(status)
  if (!result.success)
    fail(
      `Refusing to write invalid run-status.json:\n${JSON.stringify(result.error.format(), null, 2)}`,
    )
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(result.data, null, 2)}\n`)
  renameSync(tmp, path)
  console.log(path)
}

// Recompute derived fields after a phase changes: nextPhase is the first non-ready
// phase, and overall status follows from whether that phase is blocked.
function recompute(status: RunStatusType): void {
  const firstIncomplete = status.phases.findIndex((p) => p.status !== "ready")
  if (firstIncomplete === -1) {
    status.nextPhase = null
    status.status = "complete"
    status.blockers = []
    return
  }
  status.nextPhase = PHASE_IDS[firstIncomplete] ?? null
  if (status.phases[firstIncomplete]?.status === "blocked") {
    status.status = "blocked"
  } else {
    status.status = "running"
    status.blockers = []
  }
}

function phaseAtNext(status: RunStatusType, phaseId: string) {
  if (!isPhaseId(phaseId)) fail(`Unknown phase id: ${phaseId}`)
  if (status.nextPhase !== phaseId)
    fail(`Expected nextPhase (${status.nextPhase ?? "null"}), got ${phaseId}`)
  const phase = status.phases.find((p) => p.id === phaseId)
  if (!phase) fail(`Phase ${phaseId} not found in run-status.json`)
  return phase
}

function prepareBlockers(summary: unknown): { message: string; resumeAction: string }[] {
  const raw =
    summary &&
    typeof summary === "object" &&
    Array.isArray((summary as { blockers?: unknown }).blockers)
      ? ((summary as { blockers: unknown[] }).blockers.filter(
          (b): b is string => typeof b === "string" && b.length > 0,
        ) as string[])
      : []
  const messages = raw.length > 0 ? raw : ["a-prepare reported blocked status"]
  return messages.map((message) => ({
    message,
    resumeAction:
      "Resolve the prepare blocker, re-run a-prepare for this target and commit, then restart /audit.",
  }))
}

// `init` seeds run-status.json from prepare output. Prepare owns audit-id
// generation; init only reads it back and never derives a new one.
function init(prepareOutputPath: string): void {
  const abs = resolve(prepareOutputPath)
  let prep: {
    status?: unknown
    inputs?: { auditId?: unknown; repoPath?: unknown; commitHash?: unknown }
    summary?: unknown
  }
  try {
    prep = JSON.parse(readFileSync(abs, "utf8"))
  } catch (error) {
    fail(`Failed to read prepare output ${abs}: ${error instanceof Error ? error.message : error}`)
  }

  const auditId = prep.inputs?.auditId
  const repoPath = prep.inputs?.repoPath
  const commitHash = prep.inputs?.commitHash
  if (typeof auditId !== "string" || typeof repoPath !== "string" || typeof commitHash !== "string")
    fail("prepare-output.json is missing inputs.auditId, inputs.repoPath, or inputs.commitHash")
  if (prep.status !== "ready" && prep.status !== "blocked")
    fail(`prepare-output.json has an unexpected status: ${String(prep.status)}`)

  const auditRoot = dirname(abs)
  const statusPath = join(auditRoot, "run-status.json")
  if (existsSync(statusPath))
    fail(`run-status.json already exists at ${statusPath}; resume instead of re-running init`)
  const ts = now()
  const isReady = prep.status === "ready"
  const blockers = isReady ? [] : prepareBlockers(prep.summary)

  const prepPhase = isReady
    ? {
        id: "a-prepare",
        status: "ready",
        attempts: 1,
        artifactPaths: [abs],
        blockers: [],
        startedAt: ts,
        completedAt: ts,
      }
    : {
        id: "a-prepare",
        status: "blocked",
        attempts: 1,
        artifactPaths: [],
        blockers,
        startedAt: ts,
      }

  const rest = PHASE_IDS.slice(1).map((id) => ({
    id,
    status: "pending",
    attempts: 0,
    artifactPaths: [],
    blockers: [],
  }))

  writeStatus(statusPath, {
    schemaVersion: "1.0",
    auditId,
    repoPath,
    commitHash,
    status: isReady ? "running" : "blocked",
    createdAt: ts,
    updatedAt: ts,
    nextPhase: isReady ? "b-inspect" : "a-prepare",
    phases: [prepPhase, ...rest],
    blockers,
  })
}

// `start` is idempotent for crash recovery: a phase already `running` (a worker
// that died mid-phase) restarts cleanly, re-incrementing attempts so retries are
// visibly bounded. Only `nextPhase` may start, and never a ready phase.
function start(statusPath: string, phaseId: string): void {
  const path = resolve(statusPath)
  const status = loadStatus(path)
  const phase = phaseAtNext(status, phaseId)
  if (phase.status === "ready") fail(`Cannot start already-ready phase ${phaseId}`)

  phase.status = "running"
  phase.attempts += 1
  phase.startedAt = now()
  phase.completedAt = undefined
  phase.blockers = []
  status.status = "running"
  status.blockers = []
  writeStatus(path, status)
}

// `ready` records a phase's declared artifacts, but only after confirming its
// required canonical outputs actually exist on disk.
function ready(statusPath: string, phaseId: string, artifactArgs: string[]): void {
  const path = resolve(statusPath)
  const status = loadStatus(path)
  const phase = phaseAtNext(status, phaseId)
  if (phase.status !== "running")
    fail(`Cannot ready phase ${phaseId} from status "${phase.status}"; call start first`)

  const auditRoot = dirname(path)
  const expected = expectedArtifacts(phaseId as PhaseId, auditRoot)
  for (const artifact of expected)
    if (!existsSync(artifact)) fail(`Missing required artifact for ${phaseId}: ${artifact}`)

  const recorded = [...expected]
  for (const arg of artifactArgs) {
    if (!isAbsolute(arg)) fail(`Artifact path must be absolute: ${arg}`)
    const resolved = resolve(arg)
    if (resolved !== auditRoot && !resolved.startsWith(auditRoot + sep))
      fail(`Artifact must be under the audit root ${auditRoot}: ${arg}`)
    if (!existsSync(resolved)) fail(`Artifact does not exist: ${arg}`)
    if (!recorded.includes(resolved)) recorded.push(resolved)
  }

  phase.status = "ready"
  phase.artifactPaths = recorded
  phase.blockers = []
  phase.completedAt = now()
  recompute(status)
  writeStatus(path, status)
}

// `block` stops the run at a phase, preserving the blocker text and the exact
// action needed to resume.
function block(statusPath: string, phaseId: string, message: string, resumeAction: string): void {
  const path = resolve(statusPath)
  const status = loadStatus(path)
  const phase = phaseAtNext(status, phaseId)
  if (phase.status !== "running")
    fail(`Cannot block phase ${phaseId} from status "${phase.status}"; call start first`)

  const blocker = { message, resumeAction }
  phase.status = "blocked"
  phase.blockers = [blocker]
  status.status = "blocked"
  status.blockers = [blocker]
  writeStatus(path, status)
}

const [command, ...rest] = process.argv.slice(2)
switch (command) {
  case "init":
    init(requireArg(rest[0], "<prepare-output.json>"))
    break
  case "start":
    start(requireArg(rest[0], "<run-status.json>"), requireArg(rest[1], "<phase-id>"))
    break
  case "ready":
    ready(
      requireArg(rest[0], "<run-status.json>"),
      requireArg(rest[1], "<phase-id>"),
      rest.slice(2),
    )
    break
  case "block":
    block(
      requireArg(rest[0], "<run-status.json>"),
      requireArg(rest[1], "<phase-id>"),
      requireArg(rest[2], "<blocker>"),
      requireArg(rest[3], "<resume-action>"),
    )
    break
  default:
    fail(USAGE)
}
