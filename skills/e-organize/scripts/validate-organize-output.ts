import { z } from "zod"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

const Status = z.enum(["confirmed", "rejected", "demote"])
const Severity = z.enum(["info", "low", "medium", "high"])
const Confidence = z.enum(["low", "medium", "high"])
const GateName = z.enum(["attack-execution", "reachability", "trigger", "impact"])
const GateVerdict = z.enum(["passed", "failed", "demote", "not-applicable"])

// FINDING field list authority: agents/common.md (## Output). `key` re-encodes the
// program/instruction/class identifiers; a field change there flags a parser update.
const FindingKey = z.strictObject({
  program: z.string().min(1),
  instruction: z.string().min(1),
  class: z.string().min(1),
})

const OrganizeInputs = z.strictObject({
  prepareOutputPath: z.string().min(1),
  inspectFindingsPath: z.string().min(1),
  staticAnalysisPath: z.string().min(1),
  candidateFindingsPath: z.string().min(1),
})

// candidateId is the stable `CAND-XXX` handle assigned by d-agent-fanout's
// `## Summary` table; it is the primary reference back to a candidate block.
const CandidateRef = z.strictObject({
  candidateId: z.string().regex(/^CAND-\d{3,}$/),
  agentId: z.string().min(1),
  key: FindingKey,
  sourceFile: z.string().min(1).optional(),
  excerpt: z.string().optional(),
})

const GateResult = z.strictObject({
  gate: GateName,
  verdict: GateVerdict,
  rationale: z.string().min(1),
  evidence: z.array(z.string()).default([]),
})

const OrganizedFinding = z
  .strictObject({
    id: z.string().regex(/^ORG-\d{3,}$/),
    status: Status,
    title: z.string().min(1),
    program: z.string().min(1),
    instruction: z.string().min(1),
    class: z.string().min(1),
    severity: Severity.nullable(),
    confidence: Confidence.nullable(),
    sourceCandidates: z.array(CandidateRef).min(1),
    agents: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    rootCause: z.string().min(1),
    attackPath: z.string().min(1),
    impact: z.string().min(1),
    validation: z.array(GateResult).min(1),
    statusRationale: z.string().min(1),
    recommendedFix: z.string().optional(),
    remainingUncertainty: z.string().optional(),
  })
  // Confirmed findings must be scored; rejected/demoted leads may leave
  // severity/confidence null since they are not carried into the report.
  .refine((f) => f.status !== "confirmed" || (f.severity !== null && f.confidence !== null), {
    message: "Confirmed findings require non-null severity and confidence",
    path: ["severity"],
  })

const OrganizeOutput = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    step: z.literal("organize"),
    status: z.enum(["ready", "blocked"]),
    inputs: OrganizeInputs,
    summary: z.strictObject({
      candidateBlocks: z.number().int().nonnegative(),
      findingsTotal: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
      demote: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      blockers: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
    findings: z.array(OrganizedFinding),
  })
  // Summary counters must match the findings array so downstream consumers and
  // the report cannot be misled by a stale or hand-edited summary.
  .superRefine((o, ctx) => {
    const count = (s: string) => o.findings.filter((f) => f.status === s).length
    const checks: [string, number, number][] = [
      ["findingsTotal", o.summary.findingsTotal, o.findings.length],
      ["confirmed", o.summary.confirmed, count("confirmed")],
      ["demote", o.summary.demote, count("demote")],
      ["rejected", o.summary.rejected, count("rejected")],
    ]
    for (const [field, got, want] of checks) {
      if (got !== want)
        ctx.addIssue({
          code: "custom",
          path: ["summary", field],
          message: `summary.${field} (${got}) must equal ${want}`,
        })
    }
  })

validateJsonFile(OrganizeOutput, process.argv[2], "organized-findings.json")
