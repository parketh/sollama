# Report Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `g-report` skill that turns validated audit artifacts into the final human-readable audit report, writing canonical `report/report.md`.

**Architecture:** `g-report` is an independently runnable markdown generation skill. It consumes `prepare-output.json`, `verification.json`, and verification artifacts under `pocs/`, then produces a polished report with verified findings first and unreproduced or blocked findings in a clearly separated section near the end of the main report body.

**Tech Stack:** Markdown skill files, report markdown template, local filesystem artifacts.

---

## Context

Report is Step 7 and the final audit deliverable step. It is responsible for human-readable presentation, not further vulnerability discovery.

Report consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
<target-repo>/.sollama/audits/<audit-id>/verification.json
<target-repo>/.sollama/audits/<audit-id>/pocs/
```

Report writes:

```text
<target-repo>/.sollama/audits/<audit-id>/report/report.md
```

`report.md` is the canonical final report deliverable.

Report does not create JSON output and does not need a Zod validator.

## Files

- Create: `skills/g-report/SKILL.md`
- Create: `skills/g-report/templates/report.template.md`

Do not create `report.json`.

Do not create markdown validation scripts.

## Report Rules

The report must be clear about verification status:

- `verified`: reproduced by focused failing test.
- `evidence-confirmed`: confirmed directly from source/docs because the issue is info-class or non-exploit.
- `unreproduced`: attempted but not reproduced.
- `blocked`: fair verification could not run.

Verified and evidence-confirmed findings appear first.

Unreproduced and blocked findings remain visible in a clearly separated section near the end of the main report body. Do not hide them in an appendix.

Do not include organize findings with `status: "demote"` or `status: "rejected"` unless the user explicitly asks for a debugging section that includes dropped candidates. These fall out before verification.

Use verification `severity` as the final severity classification. `f-verify` carries severity from organize and may reclassify it based on reproduced impact, so `verification.json` is authoritative for the final severity.

Metadata source split: `prepare-output.json` supplies the `## Summary` audit metadata and scope (target, commit, audit scope, audit focus); the `generated-at` timestamp is stamped when the report is written. `verification.json` supplies all findings and verification data — `VerificationResult` carries `program`, `instruction`, `class`, `description`, `impact`, and `recommendedFix` alongside `severity`, so per-finding fields are rendered from it and never from `organized-findings.json`, which report does not read.

## Task 1: Create The Report Skill

**Objective:** Add the self-contained report generation workflow.

**Files:**

- Create: `skills/g-report/SKILL.md`

**Draft `SKILL.md`:**

````markdown
---
name: g-report
description: (Step 7/7) Generate final Sollama audit report markdown from verification.json and audit artifacts.
---

# Report

Use this skill as Step 7 of a Sollama audit.

Report consumes `prepare-output.json`, `verification.json`, and optional verification artifacts under `pocs/`, then writes `report/report.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/verification.json`

Optional inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/pocs/`

If any required path is missing, ask the user for it.

## Procedure

1. Read `prepare-output.json`. Upstream status guard: if `prepare-output.json` `status` is `"blocked"` or `verification.json` `status` is `"blocked"`, report the upstream blockers prominently; generate the report only from whatever results exist and mark it as produced from a blocked upstream. Do not present a blocked run as a complete audit.
2. Read `verification.json`.
3. Read available artifact references under `pocs/`.
4. Build report content from verification results.
5. Put `verified` and `evidence-confirmed` findings first.
6. Put `unreproduced` and `blocked` findings in a clearly separated section near the end of the main body.
7. Link each finding to supporting artifacts when available.
8. Write `report/report.md`.
9. Review the generated markdown for obvious structure or content failures.

## Output Rules

`report.md` is canonical.

Do not invent findings, verification results, severities, or artifact references.

Do not promote unreproduced or blocked findings into verified sections.

Do not include demote/rejected organize findings unless the user explicitly requests a debugging version of the report.

## Handoff

Finish by reporting:

- path to `report/report.md`
- verified count
- evidence-confirmed count
- unreproduced count
- blocked count
````

## Task 2: Add Report Template

**Objective:** Provide a stable report body structure.

**Files:**

- Create: `skills/g-report/templates/report.template.md`

**Template content:**

````markdown
# Sollama Audit Report

## Summary

- Target:
- Commit:
- Audit scope:
- Audit focus:
- Generated at:

## Results Overview

| Status | Count |
| --- | ---: |
| Verified | |
| Evidence-confirmed | |
| Unreproduced | |
| Blocked | |

## Verified Findings

### [Severity] Title

- ID:
- Program:
- Instruction:
- Class:
- Verification method:
- Artifacts:

Description:

Impact:

Evidence:

Recommendation:

## Evidence-Confirmed Findings

### [Severity] Title

- ID:
- Program:
- Instruction:
- Class:
- Evidence:

Description:

Recommendation:

## Unreproduced And Blocked Findings

These findings were not reproduced or could not be fairly verified. They are preserved for transparency and follow-up.

### [Severity or Unknown] Title

- ID:
- Verification status:
- Reason:
- Attempted commands:
- Artifacts:

## Methodology

Summarize the Sollama workflow and verification standard.

## Scope Notes

Summarize scope, exclusions, unsupported areas, and important assumptions from prepare/organize/verification artifacts.
````

## Task 3: Manual Verification

**Objective:** Verify report generation is complete and readable.

**Files:**

- Test markdown output: `<target-repo>/.sollama/audits/<audit-id>/report/report.md`

**Verification steps:**

Run `g-report` on completed verification output and confirm:

- `report/report.md` is created at the expected path.
- Verified and evidence-confirmed findings appear before unreproduced/blocked findings.
- Unreproduced and blocked findings are in a separate section near the end of the main report body.
- Demote/rejected organize findings are not included by default.
- Artifact links point to files under `pocs/` when available.

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

- Read `report/report.md`.
- Confirm report content matches `verification.json`.

## Risks

- Report must not overclaim. `verified`, `evidence-confirmed`, `unreproduced`, and `blocked` must remain visibly distinct.
- A debugging report that includes demote/rejected organize findings can be added later, but it is not the default final report.
