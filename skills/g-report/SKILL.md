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

## Report Rules

The report must be clear about verification status:

- `verified`: reproduced by focused failing test.
- `evidence-confirmed`: confirmed directly from source/docs because the issue is info-class or non-exploit.
- `unreproduced`: attempted but not reproduced.
- `blocked`: fair verification could not run.

Verified and evidence-confirmed findings appear first. Unreproduced and blocked findings remain visible in a clearly separated section near the end of the main report body. Do not hide them in an appendix.

Use verification `severity` as the final severity classification. `f-verify` carries severity from organize and may reclassify it based on reproduced impact, so `verification.json` is authoritative for the final severity.

`verification.json` is self-contained: `VerificationResult` carries `program`, `instruction`, `class`, `description`, `impact`, and `recommendedFix` alongside `severity`. Render every template field from `verification.json`; do not read `organized-findings.json`.

## Output Rules

`report.md` is canonical.

Do not invent findings, verification results, severities, or artifact references.

Do not promote unreproduced or blocked findings into verified sections.

Do not include organize findings with `status: "demote"` or `status: "rejected"` unless the user explicitly requests a debugging version of the report.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/report/report.md
```

Use the section order from `skills/g-report/templates/report.template.md`.

## Handoff

Finish by reporting:

- path to `report/report.md`
- verified count
- evidence-confirmed count
- unreproduced count
- blocked count
