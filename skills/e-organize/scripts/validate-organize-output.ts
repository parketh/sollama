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
    // Core content fields are relaxed to allow empty strings so a malformed or
    // partial candidate can be preserved losslessly as demote/rejected via
    // rawBlock + parseWarning. Confirmed findings must fill them (see refine).
    title: z.string(),
    program: z.string(),
    instruction: z.string(),
    class: z.string(),
    severity: Severity.nullable(),
    confidence: Confidence.nullable(),
    sourceCandidates: z.array(CandidateRef).min(1),
    agents: z.array(z.string().min(1)).min(1),
    description: z.string(),
    rootCause: z.string(),
    attackPath: z.string(),
    impact: z.string(),
    validation: z.array(GateResult),
    statusRationale: z.string().min(1),
    recommendedFix: z.string().optional(),
    remainingUncertainty: z.string().optional(),
    // Set on demote/rejected findings preserved from a malformed candidate block.
    parseWarning: z.string().optional(),
    rawBlock: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.status !== "confirmed") return
    // Confirmed findings must be fully specified and scored; the relaxed fields
    // above only exist to preserve malformed demote/rejected candidates.
    if (f.severity === null || f.confidence === null)
      ctx.addIssue({ code: "custom", path: ["severity"], message: "Confirmed findings require non-null severity and confidence" })
    for (const field of ["title", "program", "instruction", "class", "description", "rootCause", "attackPath", "impact"] as const) {
      if (f[field] === "")
        ctx.addIssue({ code: "custom", path: [field], message: `Confirmed findings require non-empty ${field}` })
    }
    if (f.validation.length === 0)
      ctx.addIssue({ code: "custom", path: ["validation"], message: "Confirmed findings require at least one validation gate" })
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
