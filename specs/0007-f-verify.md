# Verify Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `f-verify` skill that verifies organized findings by reproducing exploitable issues in a sandbox when required, confirms info-class issues by evidence when appropriate, and writes canonical `verification.json`.

**Architecture:** `f-verify` is an independently runnable skill with a JSON-canonical output. It consumes `prepare-output.json` and `organized-findings.json`, verifies findings with `status: "confirmed"` from organize, creates test artifacts under `pocs/` when needed, and validates the JSON artifact with Zod.

**Tech Stack:** Markdown skill files, Bun, TypeScript, Zod, shared JSON validation helper, target repo native Rust/Solana/Anchor test tooling, temporary worktrees or branches.

---

## Context

Verify is Step 6. It is the false-positive filter before final report generation.

Organize `status: "confirmed"` means the finding passed organizer judgement gates. Verify determines whether it is actually reproduced, evidence-confirmed, unreproduced, or blocked.

Verify consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
<target-repo>/.sollama/audits/<audit-id>/organized-findings.json
```

Verify writes:

```text
<target-repo>/.sollama/audits/<audit-id>/verification.json
<target-repo>/.sollama/audits/<audit-id>/pocs/
```

`verification.json` is canonical for `g-report`.

## Files

- Create: `skills/f-verify/SKILL.md`
- Create: `skills/f-verify/scripts/validate-verify-output.ts`
- Create: `skills/f-verify/templates/verification.template.json`
- Modify: `package.json`

Do not create markdown validation scripts. Validation is only for `verification.json`.

## Verification Scope

Verify only attempts findings from `organized-findings.json` where: `finding.status == "confirmed"`.

Findings with `status: "demote"` or `status: "rejected"` fall out at organize and are omitted from verification output.

Verification must not mutate the user’s working copy directly. When adding tests, fixtures, or harnesses, use a temporary worktree or branch at the pinned commit. Copy resulting patches, test files, logs, and command outputs back into the audit `pocs/` directory.

## Verification Rules

Use the target repo’s native test framework first. The prepare output records install/build/test commands; use those as starting context, then adapt to the project.

Exploitability findings require reproduction:

- A finding is `verified` only if the skill creates or runs a focused failing test that demonstrates the claimed harm.
- The test must name the command run, the relevant test or script path, the expected failing/passing behavior, and the observed result.
- If the repo cannot support an executable repro after reasonable effort, mark `unreproduced` or `blocked`, not `verified`.

Info-class findings may be evidence-confirmed:

- Incorrect comments, outdated docs, misleading names, bad metadata, or other non-exploit facts can be `evidence-confirmed` without sandbox reproduction.
- Evidence-confirmed findings must cite exact source/docs locations and explain why no test is needed.

Do not broaden scope while verifying. Avoid tests, generated code, deployment scripts, and vendored dependencies unless they were explicitly in audit scope or needed only as harness scaffolding.

## Carry-Forward Rules

`verification.json` is self-contained for `g-report`; report does not read `organized-findings.json`. For each verified/attempted finding, copy the display fields from the matching organized finding (`id == findingId`) into the result: `program`, `instruction`, `class`, `description`, `impact`, and `recommendedFix`.

Carry `severity` from the organized finding as the starting classification, but reclassify it when the reproduced impact differs from the organizer's estimate (e.g. a demoted-severity lead that reproduces as material loss, or an overstated finding that reproduces as bounded harm). Record the reclassification reason in `rationale` or `notes`. Use `null` only for results that cannot be scored.

## Schema Contract

The main schema is `VerificationResult`; the output is a flat list of verification results keyed back to organized finding IDs.

```ts
import { z } from "zod"

const VerificationStatus = z.enum([
  "verified",
  "evidence-confirmed",
  "unreproduced",
  "blocked",
])
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
```

For `status: "blocked"`, still write a schema-valid `verification.json` when possible. Put blocker details in `summary.blockers`.

## Task 1: Create The Verify Skill

**Objective:** Add the self-contained verification workflow and schema documentation.

**Files:**

- Create: `skills/f-verify/SKILL.md`

**Draft `SKILL.md`:**

````markdown
---
name: f-verify
description: (Step 6/7) Verify organized audit findings with tests or non-exploit evidence, then write validated verification.json.
---

# Verify

Use this skill as Step 6 of a Sollama audit.

Verify consumes `prepare-output.json` and `organized-findings.json`, then writes `verification.json` and optional test artifacts under `pocs/`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/organized-findings.json`

If any path is missing, ask the user for it.

## Procedure

1. Read all inputs. Upstream status guard: if `prepare-output.json` `status` is `"blocked"` or `organized-findings.json` `status` is `"blocked"`, stop and report the upstream blockers; do not verify. The operator must resolve the upstream block and re-run that step first.
2. Select only findings with `status: "confirmed"` for verification.
3. Ignore `demote` and `rejected` findings; they fall out at organize and are omitted from `verification.json`.
4. Create or select a temporary worktree or branch at the pinned commit before writing test code.
5. For each selected finding, choose method: `test` or `evidence`.
6. Use `method: "evidence"` only for info-class or non-exploit findings where reproduction is not meaningful.
7. For exploitability findings, add or run a focused test that demonstrates the claimed harm.
8. Record commands, exit statuses, output logs, patches, test files, and artifacts.
9. Copy test artifacts into `<audit-dir>/pocs/<finding-id>/`.
10. Assign verification `status`.
11. Carry forward display fields from the organized finding (`program`, `instruction`, `class`, `description`, `impact`, `recommendedFix`) and set/reclassify `severity` per the Carry-Forward Rules.
12. Write `verification.json`.
13. Run `bun run skills/f-verify/scripts/validate-verify-output.ts <path-to-verification.json>`.
14. Fix schema issues and re-run validation until it passes or the step is blocked.

## Status Rules

Use `verified` only when a focused test reproduces the finding.

Use `evidence-confirmed` only for info-class or non-exploit findings proven directly by source/docs.

Use `unreproduced` when the finding was attempted but the exploit or harm could not be reproduced.

Use `blocked` when required project setup, dependencies, build, test harness, or environment prevents a fair verification attempt.

Use `method: "none"` for blocked results where no fair verification method could run.

## Working Copy Rules

Do not mutate the user’s working copy directly for tests.

Use a temporary worktree or branch at the pinned commit.

Copy artifacts back into `pocs/<finding-id>/`.

Do not leave required verification state hidden in a temporary directory.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/verification.json
<target-repo>/.sollama/audits/<audit-id>/pocs/
```

Use the schema and templates from this skill.

## Handoff

Finish by reporting:

- path to `verification.json`
- verified count
- evidence-confirmed count
- unreproduced count
- blocked count
- test artifact paths
- next step: `g-report` when JSON validation passes
````

## Task 2: Add JSON Template

**Objective:** Provide a schema-shaped starting point for the canonical artifact.

**Files:**

- Create: `skills/f-verify/templates/verification.template.json`

**Template content:**

```json
{
  "schemaVersion": "1.0",
  "step": "verify",
  "status": "blocked",
  "inputs": {
    "prepareOutputPath": "",
    "organizedFindingsJsonPath": ""
  },
  "summary": {
    "findingsTotal": 0,
    "attempted": 0,
    "verified": 0,
    "evidenceConfirmed": 0,
    "unreproduced": 0,
    "blocked": 0,
    "blockers": [],
    "warnings": []
  },
  "results": []
}
```

## Task 3: Add JSON Validator

**Objective:** Validate only the shape of `verification.json`.

**Files:**

- Create: `skills/f-verify/scripts/validate-verify-output.ts`
- Modify: `package.json`

**Implementation notes:**

- Define the Zod schemas in `validate-verify-output.ts`.
- Import `validateJsonFile` from `skills/shared/scripts/validate.ts`.
- Do not add bespoke readiness checks or semantic validation.
- Add a root script:

```json
{
  "scripts": {
    "validate:verify": "bun run skills/f-verify/scripts/validate-verify-output.ts"
  }
}
```

**Draft validator:**

```ts
import { z } from "zod"

import { validateJsonFile } from "../../shared/scripts/validate.ts"

// Define schemas from this spec here.

validateJsonFile(VerifyOutput, process.argv[2], "verification.json")
```

## Task 4: Manual Verification

**Objective:** Verify the verify step can run independently and produce validated downstream input.

**Files:**

- Test JSON output: `<target-repo>/.sollama/audits/<audit-id>/verification.json`
- Test artifact output: `<target-repo>/.sollama/audits/<audit-id>/pocs/`

**Verification steps:**

Run `f-verify` on organized findings and confirm:

- `verification.json` is created at the expected path.
- `bun run skills/f-verify/scripts/validate-verify-output.ts <path>` passes.
- Only organize `confirmed` findings are included in verification output.
- `demote` and `rejected` findings are omitted from verification output.
- Exploit findings are not marked `verified` without a focused failing test.
- Info-class findings may be marked `evidence-confirmed` with exact evidence.
- Test artifacts are copied under `pocs/<finding-id>/`.
- The user’s working copy is not mutated directly.
- Commands and exit statuses are recorded.

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

- Read `verification.json`.
- Confirm it is useful as direct input for `g-report`.
- Confirm every `verified` result has supporting artifacts or commands.

## Risks

- Some real findings are difficult to reproduce without deployment state. Mark these `blocked` or `unreproduced`; do not overclaim.
- Temporary worktrees can be messy. The skill must copy all relevant artifacts back to the audit directory.
- Info-class issues need judgement: they can be evidence-confirmed, but should not be inflated into exploit findings.
- Verification may require adding project-specific tests; keep those artifacts focused and tied to finding IDs.
