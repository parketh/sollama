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
2. Select only findings with `status: "confirmed"` for verification. Every confirmed finding must produce exactly one result — including `unreproduced` or `blocked` — so none silently disappears from the report `g-report` builds from `verification.json`.
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

## Verification Scope

Verify only attempts findings from `organized-findings.json` where `finding.status == "confirmed"`.

Findings with `status: "demote"` or `status: "rejected"` fall out at organize and are omitted from verification output.

Verification must be exhaustive over confirmed findings: `results` contains exactly one entry per `confirmed` finding in `organized-findings.json`. When a fair attempt is impossible, still emit a result with `status: "unreproduced"` or `"blocked"` rather than dropping the finding.

Use the target repo's native test framework first. The prepare output records install/build/test commands; use those as starting context, then adapt to the project.

Do not broaden scope while verifying. Avoid tests, generated code, deployment scripts, and vendored dependencies unless they were explicitly in audit scope or needed only as harness scaffolding.

## Status Rules

Exploitability findings require reproduction:

- Use `verified` only when a focused failing test reproduces the claimed harm.
- The test must name the command run, the relevant test or script path, the expected failing/passing behavior, and the observed result.
- If the repo cannot support an executable repro after reasonable effort, mark `unreproduced` or `blocked`, not `verified`.

Info-class findings may be evidence-confirmed:

- Use `evidence-confirmed` only for info-class or non-exploit findings proven directly by source/docs, such as incorrect comments, outdated docs, misleading names, or bad metadata.
- Evidence-confirmed findings must cite exact source/docs locations and explain why no test is needed.

Use `unreproduced` when the finding was attempted but the exploit or harm could not be reproduced.

Use `blocked` when required project setup, dependencies, build, test harness, or environment prevents a fair verification attempt.

Use `method: "none"` for blocked results where no fair verification method could run.

## Carry-Forward Rules

`verification.json` is self-contained for `g-report`; report does not read `organized-findings.json`. For each verified/attempted finding, copy the display fields from the matching organized finding (`id == findingId`) into the result: `program`, `instruction`, `class`, `description`, `impact`, and `recommendedFix`.

Carry `severity` from the organized finding as the starting classification, but reclassify it when the reproduced impact differs from the organizer's estimate (e.g. a demoted-severity lead that reproduces as material loss, or an overstated finding that reproduces as bounded harm). Record the reclassification reason in `rationale` or `notes`. Use `null` only for results that cannot be scored.

## Working Copy Rules

Do not mutate the user's working copy directly for tests.

Use a temporary worktree or branch at the pinned commit.

Copy artifacts back into `pocs/<finding-id>/`.

Do not leave required verification state hidden in a temporary directory.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/verification.json
<target-repo>/.sollama/audits/<audit-id>/pocs/
```

Use the schema and template from this skill. For `status: "blocked"`, still write a schema-valid `verification.json` when possible and put blocker details in `summary.blockers`.

## Handoff

Finish by reporting:

- path to `verification.json`
- verified count
- evidence-confirmed count
- unreproduced count
- blocked count
- test artifact paths
- next step: `g-report` when JSON validation passes
