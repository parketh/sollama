import { z } from "zod"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

const Status = z.enum(["confirmed", "rejected", "demote"])
const Severity = z.enum(["info", "low", "medium", "high"])
const Confidence = z.enum(["low", "medium", "high"])
const GateName = z.enum(["attack-execution", "reachability", "trigger", "impact"])
const GateVerdict = z.enum(["passed", "failed", "demote", "not-applicable"])

// FINDING field list authority: agents/common.md (## Output). `key` re-encodes the
// program/instruction/class identifiers; a field change there flags a parser update.
const FindingKey = z.object({
  program: z.string().min(1),
  instruction: z.string().min(1),
  class: z.string().min(1),
})

const OrganizeInputs = z.object({
  prepareOutputPath: z.string().min(1),
  inspectFindingsPath: z.string().min(1),
  staticAnalysisPath: z.string().min(1),
  candidateFindingsPath: z.string().min(1),
})

const CandidateRef = z.object({
  agentId: z.string().min(1),
  sourceFile: z.string().min(1),
  blockIndex: z.number().int().nonnegative(),
  key: FindingKey,
  excerpt: z.string().optional(),
})

const GateResult = z.object({
  gate: GateName,
  verdict: GateVerdict,
  rationale: z.string().min(1),
  evidence: z.array(z.string()).default([]),
})

const OrganizedFinding = z.object({
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

const OrganizeOutput = z.object({
  schemaVersion: z.literal("1.0"),
  step: z.literal("organize"),
  status: z.enum(["ready", "blocked"]),
  inputs: OrganizeInputs,
  summary: z.object({
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

validateJsonFile(OrganizeOutput, process.argv[2], "organized-findings.json")
