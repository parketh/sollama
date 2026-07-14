---
name: c-static-analysis
description: (Step 3/7) Run required Solana static-analysis tools, triage tool findings, and write static-analysis.md for downstream agent fanout.
---

# Static Analysis

Use this skill as Step 3 of a Sollama audit.

Static analysis consumes `prepare-output.json` and `inspect-findings.md`, then writes `static-analysis.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md`

If a path is missing, ask the user for it.

Default required tools:

- Sec3 X-Ray
- Sol-azy

The required tool list can be overridden by explicit user/project context. If not overridden, both defaults are required.

## Procedure

1. Read `prepare-output.json` and `inspect-findings.md`. If `prepare-output.json` `status` is `"blocked"` or `inspect-findings.md` metadata `Status` is `blocked`, stop and report the upstream blockers; do not run tools. The operator must resolve the upstream block and re-run that step first.
2. Resolve target repo and audit output directory. Confirm the pinned commit is checked out: `git rev-parse HEAD` must equal `inputs.commitHash` and `git status --porcelain` must be empty. If HEAD differs or the working tree is dirty, stop and report a blocker; do not scan a different or modified tree. Do not change the checkout yourself; the operator must set the correct checkout.
3. Determine required tools.
4. Consult current upstream docs/repos for required-tool detection, installation, and run commands.
5. Check whether each required tool is installed and runnable.
6. For missing tools, ask the user for permission before installing or setting up the tool. Provide exact commands.
7. If any required tool remains unavailable, write blocked `static-analysis.md` and stop.
8. Run each required tool from the target repo context.
9. Capture command, exit status, stdout/stderr excerpts, generated report locations, and relevant findings.
   If Sol-azy only prints to stdout for the selected command, redirect stdout to an output file and
   record both the command and output file path.
10. Triage findings into needs review, benign/accepted, informational, or tool failure. Use `inspect-findings.md`'s resolved in-scope file list to scope and prioritise scanner output so this phase covers the same surface as agent fanout; note tool findings outside that scope as informational rather than dropping them.
11. Write `static-analysis.md`.
12. Delete only the intermediate artifacts this run created. Prefer running tools with output in a dedicated temporary directory, or record each exact path the run produces and delete only those (`.ll` files, `.xray` output, and other scanner output from this invocation). Never remove pre-existing or tracked files that merely match those patterns. Keep `static-analysis.md`; record the relevant findings there before deleting.

## Tool Detection And Installation

For each required tool:

1. Consult the current upstream repository/docs.
2. Determine the current version/help command, install/setup command, and scan command.
3. Run the version/help command.
4. If available, record version/status.
5. If missing, present the install/setup command and ask user permission.
6. If the user approves, run the exact command.
7. Re-check the tool.
8. If still missing or user declines, write blocked `static-analysis.md`.

Use the Ask tool before installing or setting up any required tool. The question must show the exact command the agent proposes to run.

Reference sources for current commands:

- Sec3 X-Ray: <https://github.com/sec3-product/x-ray>
- Sol-azy: <https://github.com/FuzzingLabs/sol-azy>

Do not pin scanner install or run commands in this skill. Derive them from current upstream docs at runtime, then record the exact commands actually run in `static-analysis.md`.

## Tool Rules

Never auto-install tools.

Do not run live RPC or explorer queries.

Do not use Sol-azy fetcher/RPC features. Use Sol-azy only for local source/static analysis.

Prefer source/static analysis of the local target repo.

Treat required tool scan failure as blocking unless the user explicitly removes that tool from the required set.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/static-analysis.md
```

Use the section order from `skills/c-static-analysis/templates/static-analysis.template.md`.

## Triage Rules

For each tool-reported item, record:

- tool
- class
- count
- code references
- confidence
- triage: needs-review, benign, accepted-risk, informational, or tool-failure
- rationale
- downstream hint for fanout agents

Do not treat tool output as proof. Static findings are leads until later steps reason about exploitability.

Do not suppress noisy findings silently. If a tool class is noisy, group it and explain why.

## Handoff

Finish by reporting:

- path to `static-analysis.md`
- required tools run
- blocked/missing tools, if any
- highest-signal triage summary
- next step: `d-agent-fanout` when all required tools completed
