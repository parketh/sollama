import { isAbsolute, join } from "node:path"
import { z } from "zod"

// Canonical phase order. `/audit` runs exactly these seven phases in this order;
// run-status.json must always carry all seven records once, in this sequence.
export const PHASE_IDS = [
  "a-prepare",
  "b-inspect",
  "c-static-analysis",
  "d-agent-fanout",
  "e-organize",
  "f-verify",
  "g-report",
] as const

export type PhaseId = (typeof PHASE_IDS)[number]

// Canonical readiness artifact(s) per phase, relative to the audit root. A phase
// is only recorded ready once its owning skill has written these.
const CANONICAL_ARTIFACTS: Record<PhaseId, readonly string[]> = {
  "a-prepare": ["prepare-output.json"],
  "b-inspect": ["inspect-findings.md"],
  "c-static-analysis": ["static-analysis.md"],
  "d-agent-fanout": ["candidate-findings.md"],
  "e-organize": ["organized-findings.json", "organized-findings.md"],
  "f-verify": ["verification.json"],
  "g-report": ["report/report.md"],
}

export function expectedArtifacts(phaseId: PhaseId, auditRoot: string): string[] {
  return CANONICAL_ARTIFACTS[phaseId].map((name) => join(auditRoot, name))
}

const AbsolutePath = z.string().min(1).refine(isAbsolute, { message: "must be an absolute path" })

// A blocker records why the run stopped and the exact action to resume it. Stored
// on the offending phase and mirrored at the top level when overall status blocks.
const Blocker = z.strictObject({
  message: z.string().min(1),
  resumeAction: z.string().min(1),
})

const PhaseStatus = z.enum(["pending", "running", "ready", "blocked"])

const PhaseRecord = z
  .strictObject({
    id: z.enum(PHASE_IDS),
    status: PhaseStatus,
    attempts: z.number().int().nonnegative(),
    artifactPaths: z.array(AbsolutePath),
    blockers: z.array(Blocker),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
  })
  .superRefine((p, ctx) => {
    // A ready phase is a genuinely usable handoff: it has produced its artifact(s)
    // and recorded when it finished.
    if (p.status === "ready") {
      if (p.artifactPaths.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["artifactPaths"],
          message: "ready phase requires at least one artifact path",
        })
      if (!p.completedAt)
        ctx.addIssue({
          code: "custom",
          path: ["completedAt"],
          message: "ready phase requires completedAt",
        })
    }
    // A blocked phase must preserve the blocker text and resume action.
    if (p.status === "blocked" && p.blockers.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "blocked phase requires at least one blocker",
      })
  })

export const RunStatus = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    auditId: z.string().min(1),
    repoPath: AbsolutePath,
    commitHash: z.string().min(7),
    status: z.enum(["running", "blocked", "complete"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    nextPhase: z.enum(PHASE_IDS).nullable(),
    phases: z.array(PhaseRecord),
    blockers: z.array(Blocker),
  })
  .superRefine((s, ctx) => {
    // All seven phase records, exactly once, in canonical order.
    const ids = s.phases.map((p) => p.id)
    if (ids.length !== PHASE_IDS.length || ids.some((id, i) => id !== PHASE_IDS[i])) {
      ctx.addIssue({
        code: "custom",
        path: ["phases"],
        message: `phases must be exactly [${PHASE_IDS.join(", ")}] in order`,
      })
      return // remaining invariants assume the canonical shape
    }

    const firstIncomplete = s.phases.findIndex((p) => p.status !== "ready")
    const allReady = firstIncomplete === -1

    // Ready phases form a contiguous prefix: everything after the first incomplete
    // phase is still pending.
    if (!allReady) {
      for (let i = firstIncomplete + 1; i < s.phases.length; i++) {
        const p = s.phases[i]
        if (p && p.status !== "pending")
          ctx.addIssue({
            code: "custom",
            path: ["phases", i, "status"],
            message: "phases after the first incomplete phase must be pending",
          })
      }
    }

    // At most one phase is running or blocked at a time.
    const active = s.phases.filter((p) => p.status === "running" || p.status === "blocked").length
    if (active > 1)
      ctx.addIssue({
        code: "custom",
        path: ["phases"],
        message: "at most one phase may be running or blocked",
      })

    // nextPhase points at the first non-ready phase, or null once all are ready.
    const expectedNext = allReady ? null : (PHASE_IDS[firstIncomplete] ?? null)
    if (s.nextPhase !== expectedNext)
      ctx.addIssue({
        code: "custom",
        path: ["nextPhase"],
        message: `nextPhase must be ${expectedNext === null ? "null" : expectedNext}`,
      })

    const firstIncompletePhase = allReady ? null : s.phases[firstIncomplete]

    if (s.status === "complete") {
      if (!allReady)
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "complete requires all phases ready",
        })
      if (s.nextPhase !== null)
        ctx.addIssue({
          code: "custom",
          path: ["nextPhase"],
          message: "complete requires nextPhase null",
        })
      if (s.blockers.length > 0)
        ctx.addIssue({
          code: "custom",
          path: ["blockers"],
          message: "complete requires no blockers",
        })
    } else if (s.status === "blocked") {
      if (firstIncompletePhase?.status !== "blocked")
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "blocked requires the first incomplete phase to be blocked",
        })
      if (s.blockers.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["blockers"],
          message: "blocked requires at least one blocker",
        })
    } else {
      // running
      if (allReady)
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "running requires an incomplete phase",
        })
      else if (
        firstIncompletePhase &&
        !["pending", "running"].includes(firstIncompletePhase.status)
      )
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "running requires nextPhase to be pending or running",
        })
      if (s.blockers.length > 0)
        ctx.addIssue({
          code: "custom",
          path: ["blockers"],
          message: "running requires no overall blockers",
        })
    }
  })

export type RunStatusType = z.infer<typeof RunStatus>
