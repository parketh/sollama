import { z } from "zod"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

const VerificationStatus = z.enum(["verified", "evidence-confirmed", "unreproduced", "blocked"])
const VerificationMethod = z.enum(["test", "evidence", "none"])
const Severity = z.enum(["info", "low", "medium", "high"])

const VerifyInputs = z.object({
  prepareOutputPath: z.string().min(1),
  organizedFindingsJsonPath: z.string().min(1),
})

const ArtifactRef = z.object({
  path: z.string().min(1),
  description: z.string().min(1),
})

const CommandResult = z.object({
  cwd: z.string().min(1),
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  outputRef: z.string().optional(),
})

const VerificationResult = z.object({
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

const VerifyOutput = z.object({
  schemaVersion: z.literal("1.0"),
  step: z.literal("verify"),
  status: z.enum(["ready", "blocked"]),
  inputs: VerifyInputs,
  summary: z.object({
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

validateJsonFile(VerifyOutput, process.argv[2], "verification.json")
