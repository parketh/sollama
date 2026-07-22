# Aggregate Audit Skill Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Add a resumable `/audit` skill that runs all seven Sollama phases end to end while preserving every phase's existing standalone contract.

**Architecture:** `/audit` is a coordinator, not an eighth analysis phase. It runs each sibling phase in a fresh worker context, passes only declared artifacts, records progress in a validated `run-status.json`, automatically advances after successful phases, and stops on the first blocker. `a-prepare` remains the sole audit-ID owner, so orchestration state begins after prepare writes `prepare-output.json`.

**Tech Stack:** Markdown skills, harness-native subagents, Bun, TypeScript, Zod, existing Sollama audit artifacts.

---

## Scope

Add a plugin skill invoked as `/sollama:audit` (or `/audit` when the host exposes unqualified names) with two modes inferred from its inputs:

- New run: target repository, pinned commit, optional audit scope, and optional audit focus.
- Resume: explicit run directory or `run-status.json`; alternatively target repository plus audit ID.

The skill must:

1. Run `a-prepare` through `g-report` in order.
2. Use a fresh phase worker for every phase.
3. Auto-advance without review checkpoints.
4. Pause only for missing required input, required permission, or a blocker that makes continuation unsound.
5. Resume from the first incomplete phase.
6. Never rerun a completed phase or support arbitrary rewind in v1.
7. Validate JSON artifacts and orchestration state before continuing.

The skill must not:

- Reimplement phase procedures or duplicate their artifact schemas.
- Infer the latest run when the user did not identify one.
- Continue past a blocked phase.
- Override any phase's install policy. External audit tools stay permission-gated by their owning phase (e.g. `c-static-analysis`); target-project dependencies follow prepare's existing auto-install policy.
- Query live Solana RPC nodes or explorers.
- Hide phase artifacts behind agent session state.

## Decisions

- `run-status.json` is canonical orchestration state and allows resuming runs.
- Each phase runs in a fresh worker context; filesystem artifacts are the only phase-to-phase handoff.
- Successful phases auto-advance; only permissions and blockers pause a run.
- Resume retries the first incomplete phase and then continues.
- Prepare continues to generate the audit ID. A hard failure before `prepare-output.json` exists is not resumable and starts a new run.
- Resume accepts an explicit run path/status path or target repository plus audit ID (as there can be multiple runs per repository). It never guesses the newest run.

## Run Status Contract

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/run-status.json
```

Use this shape:

```json
{
  "schemaVersion": "1.0",
  "auditId": "example-a1b2c3d-20260720-120000",
  "repoPath": "/absolute/path/to/example",
  "commitHash": "a1b2c3d4e5f6",
  "status": "running",
  "createdAt": "2026-07-20T12:00:00.000Z",
  "updatedAt": "2026-07-20T12:10:00.000Z",
  "nextPhase": "b-inspect",
  "phases": [
    {
      "id": "a-prepare",
      "status": "ready",
      "attempts": 1,
      "artifactPaths": [
        "/absolute/path/to/example/.sollama/audits/example-a1b2c3d-20260720-120000/prepare-output.json"
      ],
      "blockers": [],
      "startedAt": "2026-07-20T12:00:00.000Z",
      "completedAt": "2026-07-20T12:10:00.000Z"
    },
    {
      "id": "b-inspect",
      "status": "pending",
      "attempts": 0,
      "artifactPaths": [],
      "blockers": []
    }
  ],
  "blockers": []
}
```

The actual artifact contains exactly these ordered phase IDs:

```text
a-prepare
b-inspect
c-static-analysis
d-agent-fanout
e-organize
f-verify
g-report
```

Phase statuses are `pending | running | ready | blocked`. Overall statuses are `running | blocked | complete`.

Enforce these invariants:

- All seven phase records exist exactly once and in canonical order.
- Ready phases form a contiguous prefix.
- At most one phase is `running` or `blocked`.
- Phases after the first incomplete phase are `pending`.
- `nextPhase` is the first non-ready phase, or `null` when all phases are ready.
- `complete` requires all phases ready, `nextPhase: null`, and no blockers.
- `blocked` requires the first incomplete phase to be blocked and at least one blocker.
- `running` requires `nextPhase` to identify a pending or running phase and no overall blockers.
- `attempts` increments before each worker launch.
- Ready phases have at least one canonical artifact path and `completedAt`.
- A blocked phase preserves blocker text and the exact resume action.

## Phase Output Map

| Phase | Required output for readiness |
| --- | --- |
| `a-prepare` | validated `prepare-output.json` with `status: ready` |
| `b-inspect` | `inspect-findings.md` with `Status: ready` |
| `c-static-analysis` | `static-analysis.md` with `Status: ready` |
| `d-agent-fanout` | `candidate-findings.md` with non-blocked metadata plus `fanout/` outputs |
| `e-organize` | validated `organized-findings.json` with `status: ready` and `organized-findings.md` |
| `f-verify` | validated `verification.json`; finding-level blocked results are allowed when the artifact itself is ready |
| `g-report` | `report/report.md` |

## Task 1: Add Run-Status Schema And Validator

**Objective:** Define and validate canonical orchestration state independently of the agent.

**Files:**

- Create: `skills/audit/scripts/run-status-schema.ts`
- Create: `skills/audit/scripts/validate-run-status.ts`
- Create: `skills/audit/templates/run-status.template.json`
- Create: `skills/audit/scripts/run-status-schema.test.ts`
- Modify: `package.json`

**Steps:**

1. Write failing Bun tests for the invariants above, including duplicate phases, non-contiguous readiness, missing blockers, a completed run with a next phase, and more than one running phase.
2. Run:

   ```bash
   bun test skills/audit/scripts/run-status-schema.test.ts
   ```

   Expected: failure because the schema module does not exist.
3. Implement strict Zod schemas and export `RunStatus`, `RunStatusType`, `PHASE_IDS`, and `expectedArtifacts(phaseId, auditRoot)`.
4. Implement `validate-run-status.ts` through `scripts/shared/validate.ts`.
5. Add package scripts:

   ```json
   "validate:audit": "bun run skills/audit/scripts/validate-run-status.ts",
   "test:audit": "bun test skills/audit/scripts/*.test.ts"
   ```

6. Make `run-status.template.json` a valid running state with prepare ready and inspect pending.
7. Run the focused tests and template validator. Expected: all pass.

## Task 2: Add Atomic State Transitions

**Objective:** Prevent agents from hand-editing orchestration state or leaving partially written JSON.

**Files:**

- Create: `skills/audit/scripts/update-run-status.ts`
- Create: `skills/audit/scripts/update-run-status.test.ts`

**Command contract:**

```text
bun run skills/audit/scripts/update-run-status.ts init <prepare-output.json>
bun run skills/audit/scripts/update-run-status.ts start <run-status.json> <phase-id>
bun run skills/audit/scripts/update-run-status.ts ready <run-status.json> <phase-id> <artifact-path>...
bun run skills/audit/scripts/update-run-status.ts block <run-status.json> <phase-id> <blocker> <resume-action>
```

**Steps:**

1. Write failing tests using a temporary directory and a minimal valid `prepare-output.json`. Cover the crash-recovery case explicitly: `start` on a phase already `running` succeeds, re-increments `attempts`, resets `startedAt`, and leaves all other invariants intact.
2. Implement transitions that read, validate, change, revalidate, write a sibling temporary file, and atomically rename it over `run-status.json`.
3. Reject out-of-order starts, rerunning ready phases, readiness without required artifacts, and phase IDs that differ from `nextPhase`. `start` is idempotent for crash recovery: calling it on a phase already `running` (a worker that died mid-phase) is allowed and re-increments `attempts` and resets `startedAt`, so resume can always retry `nextPhase`. `attempts` therefore climbs on every retry, giving a visible bound against silent infinite loops.
4. `init` derives audit root, ID, repository, and commit from prepare output. It records prepare as ready or blocked and never generates an audit ID.
5. `ready` checks required paths exist before recording them.
6. `block` stores a concise blocker plus exact resume action and changes overall status to blocked.
7. Test interrupted/invalid transitions leave the prior valid state unchanged.
8. Run `bun run test:audit`. Expected: all pass.

## Task 3: Create The Aggregate Audit Skill

**Objective:** Add the user-facing coordinator without duplicating phase logic.

**Files:**

- Create: `skills/audit/SKILL.md`

**Required skill sections:**

- Inputs
- New Run
- Resume Run
- Phase Worker Contract
- Artifact Validation
- Permission And Blocker Handling
- Completion And Handoff

**Build order:** First verify the worker contract on the thinnest slice — launch one worker for `a-prepare` only, confirm it returns an absolute artifact path in the contract shape, validate it, and run `init` to write `run-status.json` with prepare ready. Only then wire the auto-advance loop over the remaining phases. This retires the "can a subagent drive a whole skill and hand back a machine-readable path" risk before the full run in Task 5, at near-zero extra cost.

**Procedure for a new run:**

1. Collect target repository and pinned commit; preserve optional scope/focus as empty strings when skipped.
2. Launch a fresh worker instructed to load and execute `skills/a-prepare/SKILL.md` with only those inputs.
3. Require the worker to return the absolute `prepare-output.json` path. If no usable artifact was written, report that the pre-state prepare run cannot be resumed and stop.
4. Validate prepare output with its owning validator.
5. Initialize `run-status.json` from prepare output.
6. If prepare is blocked, persist the blocker and stop.
7. For every remaining phase, update state to running, launch one fresh worker, validate its declared outputs, and update state to ready.
8. On a missing/invalid/blocked artifact, update state to blocked and stop without launching downstream workers.
9. After report readiness, validate the final run state is complete and return the report and state paths.

**Procedure for resume:**

1. Resolve an explicit status/run path, or derive it from target repository plus audit ID.
2. Validate `run-status.json` before launching a worker.
3. Confirm current `HEAD`, clean worktree, repository path, and commit still match prepare output.
4. Select only `nextPhase`; do not accept an arbitrary rewind. `nextPhase` may be `pending` (never started) or `running` (a prior worker died mid-phase); both are retried via the idempotent `start`.
5. Retry that phase in a fresh worker, then auto-advance normally.

**Permission handling in non-interactive workers:**

A phase (e.g. `c-static-analysis`) may need to install an external audit tool, which its own skill gates behind explicit user permission. A fresh worker cannot answer that prompt. Instruct the worker to treat an unobtainable install permission as a blocker: write the phase's blocked artifact with the exact command and resume action rather than hanging or installing unprompted. The coordinator then blocks the run per the normal blocker path. This does not change any phase's install policy; it only defines how a worker behaves when a permission gate has no interactive answer.

**Worker prompt contract:**

- Name the exact sibling skill path to load.
- Pass only required user inputs and prior artifact paths.
- State that the worker must follow the sibling skill as the source of truth.
- Require output paths, validation result, blockers, and resume action in the handoff.
- Do not pass prior workers' conversation transcripts or hidden reasoning.

**Harness portability:**

Describe fresh workers in terms of the current harness's subagent facility. Do not encode one Codex- or Claude-specific tool name. If the harness cannot launch a fresh worker, block with that capability requirement instead of silently running seven phases in one context.

## Task 4: Update Documentation And Plugin Metadata

**Objective:** Make the aggregate workflow discoverable while preserving standalone phase usage.

**Files:**

- Modify: `README.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `specs/0001-architecture.md`

**Steps:**

1. Lead README usage with `/sollama:audit`, including new-run and explicit-resume examples.
2. Retain the seven-phase table for debugging and independent runs.
3. Update Codex interface copy/default prompts to include the aggregate command.
4. Keep Claude and Codex descriptions aligned when plugin metadata changes.
5. Add a `## Post-Implementation Changes` section to spec 0001 that replaces the aggregate-audit deferral with the implemented contract.
6. Do not renumber the seven analysis phases; `/audit` is an unnumbered coordinator.

## Task 5: Verify End-To-End Orchestration

**Objective:** Prove state transitions, blocking, resume, and completion.

**Automated verification:**

```bash
bun run format:check
bun run typecheck
bun run test:audit
bun run validate:audit skills/audit/templates/run-status.template.json
```

Expected: every command exits zero.

**Manual integration scenarios:**

1. Run `/audit` against a clean, pinned local Solana repo through report generation.
2. Confirm every phase runs in a fresh worker and only declared artifact paths cross boundaries.
3. Block static analysis on a missing required tool. Confirm downstream workers do not start and state identifies `c-static-analysis` plus the install/resume action.
4. Resolve the blocker and resume by explicit run path. Confirm prepare and inspect are not rerun.
5. Corrupt a JSON artifact in a disposable fixture. Confirm orchestration blocks before the downstream phase.
6. Try to resume a completed run. Confirm the skill returns the existing report rather than rerunning phases.
7. Try a repository/commit mismatch. Confirm the run blocks without changing checkout.

These scenarios verify orchestration mechanics — worker isolation, blocking, resume, completion — not detection quality, so any small buildable pinned Solana repo suffices. No graded corpus or ground-truth findings are required.

## Risks And Tradeoffs

- A crash before prepare writes its artifact is intentionally not resumable because prepare retains audit-ID ownership.
- Harness subagent APIs differ. The skill defines a worker contract rather than a provider-specific call.
- `run-status.json` records orchestration only; phase artifacts remain authoritative for audit content.
- Resume without rewind keeps v1 safe and simple. A later spec may define downstream invalidation and artifact archival for deliberate reruns.
- Aggregate execution may be expensive. Cost gates are not added here; users can still invoke phases independently.

## Acceptance Criteria

- `/audit` completes all seven phases from one invocation when no blocker occurs.
- A blocker stops the run, persists exact continuation state, and launches no downstream phase.
- Resume starts at the first incomplete phase and never reruns a ready phase.
- Every phase uses a fresh worker context.
- `run-status.json` validates after every transition.
- Existing standalone skills remain independently runnable.
- No external audit tool is installed without explicit permission (enforced by each phase, not the coordinator); a worker that cannot obtain that permission blocks rather than installing. Target-project dependencies follow prepare's existing auto-install policy.

