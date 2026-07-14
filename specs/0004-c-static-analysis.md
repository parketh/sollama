# Static Analysis Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `c-static-analysis` skill that runs required Solana static-analysis tools, records their command outputs, and triages their findings into a strict-section markdown report.

**Architecture:** `c-static-analysis` is an independently runnable markdown skill. It consumes `prepare-output.json`, checks for configured required tools, asks before any tool installation, runs each required scanner, and writes `static-analysis.md`.

**Tech Stack:** Markdown skill files, Sec3 X-Ray, Sol-azy, shell commands, target repo build artifacts from prepare.

---

## Context

Static analysis is Step 3. It should surface obvious or tool-detectable issues before agent fanout, then triage those results so fanout agents get signal rather than raw noise.

Static analysis consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
```

Static analysis writes:

```text
<target-repo>/.sollama/audits/<audit-id>/static-analysis.md
```

Static analysis is markdown-only. Do not create a JSON schema or validation script for this step.

## Files

- Create: `skills/c-static-analysis/SKILL.md`
- Create: `skills/c-static-analysis/templates/static-analysis.template.md`

Do not create scripts for this spec.

## Tool Policy

Default required tools:

- [Sec3 X-Ray](https://github.com/sec3-product/x-ray)
- [Sol-azy](https://github.com/FuzzingLabs/sol-azy)

The required tool list can be overridden by explicit user/project context. If not overridden, both defaults are required.

Required tools must be installed and runnable before the step can complete. Missing or unrunnable required tools block the step. The skill must not install tools automatically. It should ask the user for permission and provide the exact install command or setup instruction.

If a required tool is missing and the user declines installation, write `static-analysis.md` with `Status: blocked` and stop.

If a required tool is installed but its scan fails, record the command, failure output, and likely cause. Treat the step as blocked unless the user explicitly removes that tool from the required set and reruns.

## Tool References

Do not pin scanner install or run commands in the skill. These tools move quickly, and stale commands are worse than no commands.

At runtime, the skill should consult the current upstream repository/docs for each required tool, derive the relevant detection/install/run commands, ask the user before any install/setup action, then record the exact commands it actually ran in `static-analysis.md`.

Reference sources:

- [Sec3 X-Ray](https://github.com/sec3-product/x-ray)
- [Sol-azy](https://github.com/FuzzingLabs/sol-azy)

Use Sol-azy only for local source/static analysis in v1. Do not use fetcher/RPC features. Sollama does not perform live RPC queries.

Sol-azy does not need to support a native output-file option. When the selected Sol-azy command
prints results to stdout, capture it with shell redirection:

```bash
<sol-azy command> > <output-file>
```

## Output Contract

`static-analysis.md` must contain these top-level sections, in this order:

1. `# Static Analysis`
2. `## Metadata`
3. `## Required Tools`
4. `## Tool Status`
5. `## Commands Run`
6. `## X-Ray Results`
7. `## Sol-azy Results`
8. `## Triage Summary`

If the step blocks before all tools run, still write the report with `Status: blocked`,
completed tool statuses, and exact continuation options folded into `## Triage Summary`.

## Task 1: Create The Static Analysis Skill

**Objective:** Add the self-contained static analysis workflow.

**Files:**

- Create: `skills/c-static-analysis/SKILL.md`

**Draft `SKILL.md`:**

````markdown
---
name: c-static-analysis
description: (Step 3/7) Run required Solana static-analysis tools, triage tool findings, and write static-analysis.md for downstream agent fanout.
---

# Static Analysis

Use this skill as Step 3 of a Sollama audit.

Static analysis consumes `prepare-output.json`, then writes `static-analysis.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`

If the path is missing, ask the user for it.

Default required tools:

- Sec3 X-Ray
- Sol-azy

The required tool list can be overridden by explicit user/project context. If not overridden, both defaults are required.

## Procedure

1. Read `prepare-output.json`. If its `status` is `"blocked"`, stop and report the upstream blockers from `summary.blockers`; do not run tools. The operator must resolve the prepare block and re-run `a-prepare` first.
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
10. Triage findings into needs review, benign/accepted, informational, or tool failure.
11. Write `static-analysis.md`.

## Tool Rules

Never auto-install tools.

Do not run live RPC or explorer queries.

Do not use Sol-azy fetcher/RPC features.

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
````

## Task 2: Add Static Analysis Template

**Objective:** Give the static-analysis report a stable structure for fanout agents.

**Files:**

- Create: `skills/c-static-analysis/templates/static-analysis.template.md`

**Template content:**

````markdown
# Static Analysis

## Metadata

- Audit ID:
- Target repo:
- Pinned commit:
- Prepared from:
- Generated at:
- Status: ready | blocked

## Required Tools

| Tool | Required? | Source | Notes |
| --- | --- | --- | --- |
| Sec3 X-Ray | yes | default | |
| Sol-azy | yes | default | |

## Tool Status

| Tool | Installed/Runnable? | Version Command | Version/Result | Status |
| --- | --- | --- | --- | --- |

## Commands Run

| Tool | Command | CWD | Exit | Notes |
| --- | --- | --- | ---: | --- |

## X-Ray Results

Summarize Sec3 X-Ray output, generated `.xray` reports if present, and any warnings/failures.

| Class | Count | Code References | Triage | Rationale |
| --- | ---: | --- | --- | --- |

## Sol-azy Results

Summarize Sol-azy SAST output, including rule metadata, file matches, spans where available,
and the redirected output file path when stdout was captured with `> <output-file>`.

| Rule/Class | Count | Code References | Triage | Rationale |
| --- | ---: | --- | --- | --- |

## Triage Summary

Summarize only the highest-signal static-analysis output. Prefer a concise narrative plus a
small bullet list over full raw findings tables.

- highest-signal findings
- noisy classes
- classes overlapping with prior tool output
- findings that should guide fanout
- findings that appear benign or intentional
- tool limitations and blind spots
- blocked/missing tools and exact continuation options, if status is blocked
````

## Task 3: Document Tool Detection And Installation Prompts

**Objective:** Make missing-tool behavior deterministic without auto-installing.

**Files:**

- Modify: `skills/c-static-analysis/SKILL.md`

**Implementation notes:**

For each required tool:

1. Consult the current upstream repository/docs.
2. Determine the current version/help command, install/setup command, and scan command.
3. Run the version/help command.
4. If available, record version/status.
5. If missing, present the install/setup command and ask user permission.
6. If the user approves, run the exact command.
7. Re-check the tool.
8. If still missing or user declines, write blocked `static-analysis.md`.

Use the Ask tool before installing or setting up any required tool. The question must show the
exact command the agent proposes to run, but the skill does not need to prescribe fixed wording.

## Task 4: Manual Verification

**Objective:** Verify static analysis produces useful downstream context and blocks correctly.

**Files:**

- Test target output: `<target-repo>/.sollama/audits/<audit-id>/static-analysis.md`

**Verification steps:**

Run `c-static-analysis` on a prepared target and confirm:

- `static-analysis.md` is created at the expected path.
- Missing required tools prompt for permission instead of auto-installing.
- If a required tool remains missing, report status is blocked.
- Completed tool runs record commands and exit statuses.
- Tool findings are triaged instead of pasted raw.
- High-signal findings are summarized for `d-agent-fanout`.
- No live RPC/explorer query is used.

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

- Read the generated `static-analysis.md`.
- Confirm it is useful as direct input for `d-agent-fanout`.

## Risks

- Tool commands may drift; implementation should derive commands from current upstream docs at runtime.
- Tool setup paths may vary by platform, installed binary, source checkout, or container runtime.
- Required tools can make the workflow brittle in constrained environments, but that is intentional for v1 unless user/project context overrides the required set.
