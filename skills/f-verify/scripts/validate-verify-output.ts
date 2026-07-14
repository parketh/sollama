import { z } from "zod"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

const VerificationStatus = z.enum(["verified", "evidence-confirmed", "unreproduced", "blocked"])
const VerificationMethod = z.enum(["test", "evidence", "none"])
const Severity = z.enum(["info", "low", "medium", "high"])

const VerifyInputs = z.strictObject({
  prepareOutputPath: z.string().min(1),
  organizedFindingsJsonPath: z.string().min(1),
})

const ArtifactRef = z.strictObject({
  path: z.string().min(1),
  description: z.string().min(1),
})

const CommandResult = z.strictObject({
  cwd: z.string().min(1),
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  outputRef: z.string().optional(),
})

// Each verification status implies which methods are valid: reproduced results
// name their reproduction method, unreproduced was attempted, blocked ran none.
const METHODS_BY_STATUS: Record<string, string[]> = {
  verified: ["test"],
  "evidence-confirmed": ["evidence"],
  unreproduced: ["test", "evidence"],
  blocked: ["none"],
}

const VerificationResult = z
  .strictObject({
    findingId: z.string().regex(/^ORG-\d{3,}$/),
    status: VerificationStatus,
    method: VerificationMethod,
    title: z.string().min(1),
    // Display fields carried forward from the organized finding so
    // verification.json is self-contained for g-report. See "Carry-Forward Rules".
    program: z.string().min(1),
    instruction: z.string().min(1),
    class: z.string().min(1),
    description: z.string().min(1),
    impact: z.string().min(1),
    recommendedFix: z.string().optional(),
    // severity is carried from organize but MAY be reclassified here based on
    // reproduced impact. null only for results that cannot be scored.
    severity: Severity.nullable(),
    rationale: z.string().min(1),
    evidence: z.array(z.string()).default([]),
    commands: z.array(CommandResult).default([]),
    artifacts: z.array(ArtifactRef).default([]),
    notes: z.string().optional(),
  })
  // Reproduced results (verified / evidence-confirmed) must carry a severity;
  // unreproduced or blocked results may leave it null.
  .refine(
    (r) => (r.status !== "verified" && r.status !== "evidence-confirmed") || r.severity !== null,
    {
      message: "verified and evidence-confirmed results require a non-null severity",
      path: ["severity"],
    },
  )
  // status constrains method (see METHODS_BY_STATUS).
  .refine((r) => (METHODS_BY_STATUS[r.status] ?? []).includes(r.method), {
    message: "method is not valid for this status",
    path: ["method"],
  })

const VerifyOutput = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    step: z.literal("verify"),
    status: z.enum(["ready", "blocked"]),
    inputs: VerifyInputs,
    summary: z.strictObject({
      findingsTotal: z.number().int().nonnegative(),
      attempted: z.number().int().nonnegative(),
      verified: z.number().int().nonnegative(),
      evidenceConfirmed: z.number().int().nonnegative(),
      unreproduced: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      blockers: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
    results: z.array(VerificationResult),
  })
  // Each confirmed finding appears once; summary counters match `results` so the
  // report cannot silently drop or miscount a finding.
  .superRefine((o, ctx) => {
    const ids = o.results.map((r) => r.findingId)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    if (dupes.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["results"],
        message: `duplicate findingId(s): ${[...new Set(dupes)].join(", ")}`,
      })

    const count = (s: string) => o.results.filter((r) => r.status === s).length
    const blocked = count("blocked")
    const checks: [string, number, number][] = [
      ["findingsTotal", o.summary.findingsTotal, o.results.length],
      ["verified", o.summary.verified, count("verified")],
      ["evidenceConfirmed", o.summary.evidenceConfirmed, count("evidence-confirmed")],
      ["unreproduced", o.summary.unreproduced, count("unreproduced")],
      ["blocked", o.summary.blocked, blocked],
      ["attempted", o.summary.attempted, o.results.length - blocked],
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

validateJsonFile(VerifyOutput, process.argv[2], "verification.json")
