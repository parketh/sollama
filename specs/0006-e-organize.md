# Organize Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `e-organize` skill that deduplicates fanout candidates, judges each candidate with explicit validation gates, and writes canonical `organized-findings.json` plus human-readable `organized-findings.md`.

**Architecture:** `e-organize` is an independently runnable skill with a JSON-canonical output. It consumes `candidate-findings.md` and prior audit context, turns candidate blocks into a flat list of organized findings, assigns each finding a status of `confirmed`, `rejected`, or `demote`, validates the JSON artifact with Zod, and writes a markdown companion for review.

**Tech Stack:** Markdown skill files, Bun, TypeScript, Zod, shared JSON validation helper.

---

## Context

Organize is Step 5. It is the judgement step between raw agent fanout and sandbox verification.

Organize consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md
<target-repo>/.sollama/audits/<audit-id>/static-analysis.md
<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md
```

Organize writes:

```text
<target-repo>/.sollama/audits/<audit-id>/organized-findings.json
<target-repo>/.sollama/audits/<audit-id>/organized-findings.md
```

`organized-findings.json` is canonical for `f-verify` and `g-report`. `organized-findings.md` is for human review.

## Files

- Create: `skills/e-organize/SKILL.md`
- Create: `skills/e-organize/scripts/validate-organize-output.ts`
- Create: `skills/e-organize/templates/organized-findings.template.json`
- Create: `skills/e-organize/templates/organized-findings.template.md`
- Modify: `package.json`

Do not create markdown validation scripts. Validation is only for `organized-findings.json`.

## Organization Rules

Parse every `FINDING` block from `candidate-findings.md`. The `FINDING` field list is defined once in `agents/common.md` (`## Output`); the parser is its one legitimate re-encoder and must cite `agents/common.md` as the authority in a comment, so a field change there flags a parser update. Preserve malformed or partial blocks as `demote` or `rejected` findings rather than silently dropping them.

`class` is an intentionally free-text kebab tag invented by each agent, not a controlled vocabulary. Grouping on it is a soft aid, so dedupe must not rely on class tags matching. Two passes are required:

Pass 1 — group by `(program, instruction, class)`:

- Key match means "compare carefully."
- Key mismatch usually means "do not merge."
- Merge across key mismatch only when the same root cause clearly appears through multiple entrypoints.
- Split same-key candidates when they describe different root causes, impacts, fixes, or exploit paths.

Pass 2 — re-run at `(program, instruction)` ignoring `class`:

- Agents often label the same underlying bug with different class tags (e.g. `missing-signer` vs `signer-check`). Pass 2 catches synonymous-class duplicates that Pass 1 missed.
- Compare the body (description, root cause, attack path, fix) across class boundaries. Merge only when root cause and attack path match; distinct mechanisms at the same `(program, instruction)` remain separate findings.
- Never merge across different `program` or `instruction`. Pass 2 stays within `(program, instruction)`.

Completeness gate (before writing output): list every unique `(program, instruction)` appearing in any candidate `FINDING` block. Every such `(program, instruction)` must map to at least one organized finding of any status. Zero coverage means a candidate was silently dropped — fix it, or record the drop with rationale in `summary.warnings`.

Final output is a flat `findings` array. Do not create separate top-level arrays for groups, rejected candidates, or verification queues.

`status` meanings:

- `confirmed`: passes the organize validation gates and is ready for `f-verify`. This does not mean sandbox-verified.
- `demote`: high-signal lead, code smell, low-materiality issue, privileged-only path, or incomplete exploit trace worth preserving.
- `rejected`: invalid, out of scope, self-harm-only, blocked by code, structurally impossible, or admin-action-only with no unprivileged amplifier.

## Finding Validation Rules

Every organized finding must record gate results. Evaluate gates in order. Stop at the first failing gate unless the remaining gates are needed to explain a demotion.

### Gate 1: Attack Execution

Trace the claimed path from caller to harm. Read every guard, signer check, account constraint, owner check, PDA derivation, CPI target check, and state invariant on that path.

- If a concrete check blocks the exploit before harm, mark `rejected`.
- If the exploit path is partial but a related weakness remains, mark `demote`.
- If the only objection is speculative operator behavior or deployer intent, continue.

### Gate 2: Reachability

Prove the vulnerable state can exist in the audited deployment model.

- Structurally impossible state: `rejected`.
- Requires privileged actions outside normal operation: `demote`.
- Achievable through normal protocol use, ordinary Solana account behavior, or plausible token behavior: continue.

### Gate 3: Trigger

Prove who can execute the attack.

- Trusted-role-only trigger: `demote`.
- Unprivileged or permissionless trigger: continue.
- Admin-action findings are `rejected` unless the finding names a concrete unprivileged amplifier, such as a race, retroactive sweep, asymmetric formula, or access gap.

### Gate 4: Impact

Prove material harm to an identifiable victim or protocol invariant.

- Self-harm only: `rejected`.
- Dust-level or bounded non-compounding harm: `demote`.
- Material loss, account takeover, permanent lock, protocol insolvency, invariant break, or meaningful denial of service: `confirmed`.

### Confidence

Classify confidence as `low`, `medium`, or `high`.

- `high`: concrete attack path, reachable state, clear trigger, and material impact are all supported by source or prior artifacts.
- `medium`: exploit appears valid, but depends on a specific reachable state, deployment assumption, or bounded impact analysis.
- `low`: useful lead, but attack path, reachability, trigger, or impact remains incomplete.

`confirmed` findings should usually be `medium` or `high`. Use `demote` for low-confidence leads unless multi-agent convergence or a clear partial-path completion justifies carrying them forward.

### Promotion And Demotion

Promote a lead with `status: "demote"` to `confirmed` when:

- the missing trace can be completed from source or prior artifacts
- the same root cause is confirmed elsewhere and echoes into this program/instruction
- two or more agents flagged the same issue and no gate rejects the path

Do not let multi-agent convergence override a code path that blocks the exploit before harm.

## Schema Contract

The main schema is `OrganizedFinding`; the output is a flat list of these findings.

```ts
import { z } from "zod"

const Status = z.enum(["confirmed", "rejected", "demote"])
const Severity = z.enum(["info", "low", "medium", "high"])
const Confidence = z.enum(["low", "medium", "high"])
const GateName = z.enum(["attack-execution", "reachability", "trigger", "impact"])
const GateVerdict = z.enum(["passed", "failed", "demote", "not-applicable"])

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

// candidateId is the stable `CAND-XXX` handle assigned by d-agent-fanout's
// `## Summary` table; it is the primary reference back to a candidate block.
const CandidateRef = z.object({
  candidateId: z.string().regex(/^CAND-\d{3,}$/),
  agentId: z.string().min(1),
  key: FindingKey,
  sourceFile: z.string().min(1).optional(),
  excerpt: z.string().optional(),
})

const GateResult = z.object({
  gate: GateName,
  verdict: GateVerdict,
  rationale: z.string().min(1),
  evidence: z.array(z.string()).default([]),
})

const OrganizedFinding = z
  .object({
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
```

Summary counters must match `findings` (enforced by the validator): `summary.findingsTotal` equals `findings.length`, and `summary.confirmed`/`demote`/`rejected` each equal the count of findings with that `status`.

For `status: "blocked"`, still write a schema-valid `organized-findings.json` when possible. Put blocker details in `summary.blockers` and leave `findings` empty if organization could not proceed.

## Task 1: Create The Organize Skill

**Objective:** Add the self-contained organization workflow and schema documentation.

**Files:**

- Create: `skills/e-organize/SKILL.md`

**Draft `SKILL.md`:**

````markdown
---
name: e-organize
description: (Step 5/7) Deduplicate and judge candidate audit findings into validated organized-findings.json plus organized-findings.md.
---

# Organize

Use this skill as Step 5 of a Sollama audit.

Organize consumes `candidate-findings.md` and prior audit context, then writes `organized-findings.json` and `organized-findings.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md`
- path to `<target-repo>/.sollama/audits/<audit-id>/static-analysis.md`
- path to `<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md`

If any path is missing, ask the user for it.

## Procedure

1. Read all inputs. Upstream status guard: if `prepare-output.json` `status` is `"blocked"` or `candidate-findings.md` metadata `Status` is `blocked`, stop and report the upstream blockers; do not organize. The operator must resolve the upstream block and re-run that step first.
2. Parse candidate `FINDING` blocks from `candidate-findings.md`. Each block carries a `CAND-XXX` id (from the `## Summary` table); record it as the `sourceCandidates[].candidateId` handle for every organized finding it feeds. The `## Summary` and `## Convergence` tables seed Pass 1 / Pass 2; agent-specific optional fields live in `fanout/<agent-file-id>.md`, not in `candidate-findings.md`.
3. Preserve malformed candidate blocks as `demote` or `rejected`; do not silently drop them.
4. Group candidates by `(program, instruction, class)` as a comparison aid (Pass 1).
5. Split candidates that have different root causes, fixes, impacts, or attack paths.
6. Merge candidates only when they describe the same root cause and attack path.
7. Re-run dedup at `(program, instruction)` ignoring `class` (Pass 2) to catch synonymous-class duplicates; never merge across different `program`/`instruction`.
8. Run the completeness gate: every unique `(program, instruction)` in the candidates must map to at least one organized finding, else record the drop in `summary.warnings`.
9. For each resulting item, run the four validation gates in order.
10. Assign `status: "confirmed" | "rejected" | "demote"`.
11. Confirmed findings must carry a non-null severity and confidence. Rejected or demoted leads may leave both `null`, since they are not carried into the report.
12. Write `organized-findings.json`.
13. Run `bun run skills/e-organize/scripts/validate-organize-output.ts <path-to-organized-findings.json>`.
14. Fix schema issues and re-run validation until it passes or the step is blocked.
15. Write `organized-findings.md` from the validated JSON.

## Validation Gates

Evaluate every finding in this order:

1. Attack execution: does any guard, signer check, account constraint, PDA check, CPI target check, or invariant block the path?
2. Reachability: can the vulnerable state exist through normal operation?
3. Trigger: can an unprivileged actor trigger it, or is there a concrete unprivileged amplifier for admin action?
4. Impact: is there material harm to an identifiable victim or protocol invariant?

Use `confirmed` only for findings that pass the gates. Use `demote` for leads worth carrying forward. Use `rejected` when the claim does not execute, is out of scope, or lacks an exploit path.

Do not mark anything sandbox-verified. `confirmed` here means confirmed by organizer judgement and ready for `f-verify`.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/organized-findings.json
<target-repo>/.sollama/audits/<audit-id>/organized-findings.md
```

Use the schema and templates from this skill.

## Handoff

Finish by reporting:

- path to `organized-findings.json`
- path to `organized-findings.md`
- confirmed count
- demote count
- rejected count
- blocked items, if any
- next step: `f-verify` when JSON validation passes
````

## Task 2: Add JSON Template

**Objective:** Provide a schema-shaped starting point for the canonical artifact.

**Files:**

- Create: `skills/e-organize/templates/organized-findings.template.json`

**Template content:**

```json
{
  "schemaVersion": "1.0",
  "step": "organize",
  "status": "blocked",
  "inputs": {
    "prepareOutputPath": "",
    "inspectFindingsPath": "",
    "staticAnalysisPath": "",
    "candidateFindingsPath": ""
  },
  "summary": {
    "candidateBlocks": 0,
    "findingsTotal": 0,
    "confirmed": 0,
    "demote": 0,
    "rejected": 0,
    "blockers": [],
    "warnings": []
  },
  "findings": []
}
```

## Task 3: Add Markdown Template

**Objective:** Give human reviewers a concise companion artifact generated from the canonical JSON.

**Files:**

- Create: `skills/e-organize/templates/organized-findings.template.md`

**Template content:**

````markdown
# Organized Findings

## Metadata

- Audit ID:
- Target repo:
- Pinned commit:
- Candidate source:
- Generated at:
- Status: ready | blocked

## Summary

- Candidate blocks:
- Confirmed:
- Demote:
- Rejected:
- Blockers:
- Warnings:

## Confirmed

### ORG-001: Title

- Program:
- Instruction:
- Class:
- Severity:
- Confidence:
- Source candidates:

Description:

Root cause:

Attack path:

Impact:

Validation:

Recommended fix:

## Demote

### ORG-002: Title

- Reason:
- Remaining uncertainty:
- Source candidates:

## Rejected

### ORG-003: Title

- Reason:
- Blocking gate:
- Source candidates:
````

## Task 4: Add JSON Validator

**Objective:** Validate only the shape of `organized-findings.json`.

**Files:**

- Create: `skills/e-organize/scripts/validate-organize-output.ts`
- Modify: `package.json`

**Implementation notes:**

- Define the Zod schemas in `validate-organize-output.ts`.
- Import `validateJsonFile` from `skills/shared/scripts/validate.ts`.
- Do not add bespoke readiness checks or semantic validation.
- Do not validate markdown output.
- Add a root script:

```json
{
  "scripts": {
    "validate:organize": "bun run skills/e-organize/scripts/validate-organize-output.ts"
  }
}
```

**Draft validator:**

```ts
import { z } from "zod"

import { validateJsonFile } from "../../shared/scripts/validate.ts"

// Define schemas from this spec here.

validateJsonFile(OrganizeOutput, process.argv[2], "organized-findings.json")
```

## Task 5: Manual Verification

**Objective:** Verify organize can run independently and produce validated downstream input.

**Files:**

- Test JSON output: `<target-repo>/.sollama/audits/<audit-id>/organized-findings.json`
- Test markdown output: `<target-repo>/.sollama/audits/<audit-id>/organized-findings.md`

**Verification steps:**

Run `e-organize` on a completed fanout target and confirm:

- `organized-findings.json` is created at the expected path.
- `organized-findings.md` is created at the expected path.
- `bun run skills/e-organize/scripts/validate-organize-output.ts <path>` passes.
- Findings use stable `ORG-###` IDs.
- The JSON uses `class`, not `bug_class`.
- The JSON has one flat `findings` array.
- Each finding has `status: "confirmed" | "rejected" | "demote"`.
- Each finding has validation gate results.
- Same-key candidates are not blindly merged.
- Key-mismatch candidates are almost never merged.
- Rejected findings and findings with `status: "demote"` include rationale.
- No finding is marked sandbox-verified.

## Final Verification

After this spec is implemented:

```bash
bun run format:check
bun run typecheck
```

Expected:

- repository formatting/linting passes
- TypeScript typecheck still passes

Manual output review:

- Read `organized-findings.md`.
- Confirm it is useful as direct input for `f-verify`.
- Confirm every finding has source candidate references and gate rationale.

## Risks

- `confirmed` can be confused with sandbox verification. The skill must define it as organizer-gate confirmed only.
- Candidate markdown may be inconsistent. The organizer should preserve imperfect evidence rather than silently dropping it.
- Over-merging is more dangerous than under-merging. Duplicates can be resolved later, but merged distinct bugs may disappear.
- Solidity-auditor references are useful for judgement discipline, but all rules must be adapted to Rust Solana execution, accounts, signer checks, PDAs, CPIs, and deployment assumptions.

## Post-Implementation Changes

Relocated the shared JSON validator out of `skills/` (commit `445d895`):

- **`skills/shared/scripts/validate.ts` → `scripts/shared/validate.ts`.** The generic Zod/JSON runner is repo tooling, not a skill, so it now lives under a top-level `scripts/` tree instead of a `skills/shared/` pseudo-skill.

Consequential edits to align organize with the restructured `candidate-findings.md` (commit `4afc60e`):

- **`CandidateRef` schema updated.** Added `candidateId` (`CAND-XXX` regex) as the primary reference back to a candidate block, made `sourceFile` optional, and dropped `blockIndex`. The `CAND-XXX` handle assigned by `d-agent-fanout`'s `## Summary` table replaces the old file+index reference.
- **Procedure step 2 expanded.** The parser now records each block's `CAND-XXX` id as `sourceCandidates[].candidateId`; the `## Summary` and `## Convergence` tables seed the Pass 1 / Pass 2 dedup; and blocks needing more context than their canonical fields are resolved from the per-agent `fanout/<agent-file-id>.md`, since agent-specific optional fields no longer live in `candidate-findings.md`.
- **Markdown template.** `Source candidates:` lines now annotate that they take `CAND-XXX` ids from `candidate-findings.md`'s `## Summary`.
