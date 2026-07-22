---
name: audit
description: Run a full Sollama audit end to end. Coordinates all seven phases (a-prepare through g-report) in fresh workers, records resumable progress in run-status.json, auto-advances on success, and stops on the first blocker. Invoked as /sollama:audit for a new run or a resume.
---

# Audit

Use this skill to run an entire Sollama audit from one invocation.

`/audit` is a coordinator, not an eighth analysis phase. It runs each sibling phase (`a-prepare` … `g-report`) in a fresh worker context, passes only declared artifact paths between phases, records progress in a validated `run-status.json`, auto-advances after each successful phase, and stops on the first blocker. It never reimplements a phase's procedure or reproduces its artifact schema — each phase skill is the source of truth for its own work.

`a-prepare` remains the sole owner of audit-id generation, so orchestration state only begins after prepare writes `prepare-output.json`.

## Inputs

Two modes are inferred from what the invocation provides.

New run:

- target repository path (required)
- pinned commit (required)
- audit scope (optional; preserve as an empty string when skipped)
- audit focus — client goals, areas of concern, key questions (optional; empty string when skipped)

Resume:

- explicit path to a run directory or its `run-status.json`, or
- target repository path plus audit ID (there can be multiple runs per repository)

Never guess the newest run. If a resume request does not identify a specific run, ask for the run path or audit ID.

## Orchestration State

The canonical orchestration state lives at:

```text
<target-repo>/.sollama/audits/<audit-id>/run-status.json
```

Treat it as opaque and machine-owned. Only mutate it through the transition CLI — never hand-edit it:

```bash
bun run skills/audit/scripts/update-run-status.ts init  <prepare-output.json>
bun run skills/audit/scripts/update-run-status.ts start <run-status.json> <phase-id>
bun run skills/audit/scripts/update-run-status.ts ready <run-status.json> <phase-id> <artifact-path>...
bun run skills/audit/scripts/update-run-status.ts block <run-status.json> <phase-id> <blocker> <resume-action>
```

Each transition validates, applies its change, revalidates, and atomically renames a temp file over `run-status.json`, so the file is always either the prior valid state or the next valid state. `start` increments `attempts` on every launch (including crash-recovery retries), giving a visible bound against silent loops. Validate the file at any time with:

```bash
bun run skills/audit/scripts/validate-run-status.ts <run-status.json>
```

The seven canonical phase IDs, in order:

```text
a-prepare  b-inspect  c-static-analysis  d-agent-fanout  e-organize  f-verify  g-report
```

## Build Order

Prove the worker contract on the thinnest slice before wiring the full loop:

1. Launch one worker for `a-prepare` only.
2. Confirm it returns an absolute `prepare-output.json` path in the handoff shape.
3. Validate that artifact, then run `init` to write `run-status.json` with prepare ready.

Only then run the auto-advance loop over the remaining phases.

## New Run

1. Collect target repository and pinned commit; keep skipped scope/focus as empty strings.
2. Launch a fresh worker to load and execute `skills/a-prepare/SKILL.md` with only those inputs.
3. Require the worker to return the absolute `prepare-output.json` path. If no usable artifact was written, report that the pre-state prepare run is not resumable and stop — `a-prepare` owns audit-id generation, so there is no run to resume yet.
4. Validate prepare output with its owning validator (see Artifact Validation).
5. Initialize state: `update-run-status.ts init <prepare-output.json>`.
6. If prepare is blocked, `init` already records the blocker and sets overall status `blocked`. Report it and stop.
7. For each remaining phase in order, run the auto-advance step:
   - `start <run-status.json> <phase-id>`
   - launch one fresh worker for that phase's sibling skill (see Phase Worker Contract)
   - validate its declared outputs (see Artifact Validation)
   - on success: `ready <run-status.json> <phase-id> <artifact-path>...`
   - on a missing, invalid, or blocked artifact: `block <run-status.json> <phase-id> "<blocker>" "<resume-action>"` and stop without launching any downstream worker.
8. After `g-report` is ready, confirm the final state validates as `complete`, then return the report and state paths (see Completion And Handoff).

## Resume Run

1. Resolve an explicit `run-status.json`/run-directory path, or derive it from target repository plus audit ID. Never infer the newest run.
2. Validate `run-status.json` before launching any worker.
3. Confirm the checkout still matches prepare output: `git rev-parse HEAD` equals `inputs.commitHash`, the worktree is clean (`git status --porcelain` empty), and the repository path and commit match. On any mismatch, `block` the run and stop without changing the checkout — the operator must restore the correct checkout.
4. Select only `nextPhase`. Do not accept an arbitrary rewind and never rerun a `ready` phase. `nextPhase` may be `pending` (never started) or `running` (a prior worker died mid-phase); both are retried through the idempotent `start`.
5. Run `start <run-status.json> <nextPhase>`, launch a fresh worker for it, then auto-advance through the remaining phases exactly as in a new run.

A completed run (`status: complete`, `nextPhase: null`) has nothing to resume: return the existing report rather than rerunning any phase.

## Phase Worker Contract

Every phase runs in its own fresh worker; filesystem artifacts are the only handoff. Describe the worker in terms of the current harness's subagent facility (e.g. the Agent/subagent tool). Do not hardcode a single provider-specific tool name. If the harness cannot launch a fresh worker, `block` with that capability requirement rather than silently running several phases in one context.

Each worker prompt must:

- name the exact sibling skill path to load (`skills/<phase-id>/SKILL.md`) and state that the sibling skill is the source of truth to follow;
- pass only the required user inputs and the absolute paths of prior artifacts the phase declares as inputs;
- require the handoff to return: the produced output path(s), the validation result, any blockers, and the exact resume action;
- not pass any prior worker's conversation transcript or hidden reasoning.

The phase input artifacts a worker needs are the canonical outputs of earlier phases, all under the audit root:

| Phase | Reads | Produces (readiness output) |
| --- | --- | --- |
| `a-prepare` | user inputs | `prepare-output.json` (`status: ready`) |
| `b-inspect` | `prepare-output.json` | `inspect-findings.md` (`Status: ready`) |
| `c-static-analysis` | `prepare-output.json`, `inspect-findings.md` | `static-analysis.md` (`Status: ready`) |
| `d-agent-fanout` | `prepare-output.json`, `inspect-findings.md`, `static-analysis.md` | `candidate-findings.md` (non-blocked) + `fanout/` |
| `e-organize` | prepare, inspect, static-analysis, `candidate-findings.md` | `organized-findings.json` (`status: ready`) + `organized-findings.md` |
| `f-verify` | `organized-findings.json` (+ prior artifacts) | `verification.json` |
| `g-report` | `verification.json` and audit artifacts | `report/report.md` |

## Artifact Validation

Validate a phase's declared output before recording it ready. JSON artifacts are validated by their owning skill's script; markdown artifacts are checked for their readiness marker.

| Phase | Readiness check |
| --- | --- |
| `a-prepare` | `bun run skills/a-prepare/scripts/validate-prepare-output.ts <prepare-output.json>` and `status: ready` |
| `b-inspect` | `inspect-findings.md` metadata `Status: ready` |
| `c-static-analysis` | `static-analysis.md` metadata `Status: ready` |
| `d-agent-fanout` | `candidate-findings.md` present with non-blocked metadata plus `fanout/` outputs |
| `e-organize` | `bun run skills/e-organize/scripts/validate-organize-output.ts <organized-findings.json>` with `status: ready`, plus `organized-findings.md` |
| `f-verify` | `bun run skills/f-verify/scripts/validate-verify-output.ts <verification.json>`; finding-level `blocked` results are allowed when the artifact itself is ready |
| `g-report` | `report/report.md` present |

If validation fails or the artifact is missing, treat it as a blocker — do not record the phase ready. The `ready` transition independently re-checks that each required canonical artifact exists on disk, so a phase can never be marked ready without its outputs.

## Permission And Blocker Handling

Stop the run only for: missing required input, an unobtainable required permission, or a blocker that makes continuation unsound.

`/audit` never overrides a phase's install policy. External audit tools stay permission-gated by their owning phase (e.g. `c-static-analysis`); target-project dependencies follow `a-prepare`'s existing auto-install policy. A fresh, non-interactive worker cannot answer a permission prompt, so instruct each worker to treat an unobtainable install permission as a blocker: write the phase's blocked artifact with the exact command and resume action rather than hanging or installing unprompted. The coordinator then `block`s the run on the normal blocker path. This does not change any phase's install policy; it only defines how a worker behaves when a permission gate has no interactive answer.

When a phase blocks:

- record it with `block <run-status.json> <phase-id> "<blocker>" "<resume-action>"`, capturing concise blocker text and the exact action needed to resume;
- launch no downstream worker;
- report the blocked phase, the blocker, and the resume command (the explicit-resume `/audit` invocation) to the user.

## Completion And Handoff

On completion, confirm `run-status.json` validates as `complete` (all phases ready, `nextPhase: null`, no blockers), then report:

- path to `report/report.md`
- path to `run-status.json`
- one line per phase: id, status, and attempts
- any warnings surfaced by phases

On a blocked run, report instead:

- the blocked phase and its blocker
- the exact resume action and the `/audit` resume invocation (explicit run path, or repository plus audit ID)
- path to `run-status.json`

Do not claim the audit is complete unless every phase is `ready`, `run-status.json` validates as `complete`, and `report/report.md` exists.
