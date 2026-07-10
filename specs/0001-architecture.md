# Sollama Architecture Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Define the high-level architecture for Sollama, an agentic AI auditor for Rust Solana programs.

**Architecture:** Sollama v1 is a plugin-distributed, skill-first audit system. Each audit phase is an independently runnable skill that reads prior artifacts, writes deterministic outputs into a run directory, and validates those outputs. Composing the phases into a single end-to-end command is future work and is out of scope for this spec set (`0001`-`0008`).

**Tech Stack:** Markdown skills, Codex/Claude Code plugin manifests, Bun, TypeScript, Zod, Biome, target-native Solana build/test tooling.

---

## Scope

Sollama audits native Rust Solana programs, as well as programs written in common frameworks such as Anchor, Pinocchio and Steel.

By default, audit scope includes deployable program crates and locally authored shared code they depend on. It excludes tests, clients, deployment scripts, generated IDLs, and vendored or third-party dependency internals. Users can override the audit scope to include or exclude files.

Third-party dependencies are modeled as trust boundaries. Sollama records their versions, roles, and security assumptions, but does not audit their internals by default.

Non-Rust Solana programs, unsupported languages, and non-Solana repositories should be detected during prepare and reported as unsupported rather than silently audited.

## System Shape

Sollama v1 is not a CLI orchestrator or long-running service. It is an agent-skill system with small deterministic scripts where strict validation is needed.

The canonical repo structure is:

```text
agents/
  common.md
  mechanics/*.md
  lenses/*.md
  gaps/*.md
skills/
  a-prepare/
  b-inspect/
  c-static-analysis/
  d-agent-fanout/
  e-organize/
  f-verify/
  g-report/
specs/
  0001-architecture.md
  0002-a-prepare.md
  0003-b-inspect.md
  0004-c-static-analysis.md
  0005-d-agent-fanout.md
  0006-e-organize.md
  0007-f-verify.md
  0008-g-report.md
.codex-plugin/
  plugin.json
.claude-plugin/
  plugin.json
package.json
tsconfig.json
biome.json
bun.lock
```

The `skills/` tree is canonical for executable audit workflows. Each skill has a top-level `SKILL.md`, optional `references/` for progressive disclosure, optional `scripts/` for deterministic checks, and optional `templates/` for reusable artifact skeletons.

The `agents/` tree remains top-level and canonical inside the Sollama plugin package for specialist Step 4 prompts. The agent fanout skill resolves these files from its installed plugin context. It does not ask the audit target repo for an `agents/` path, and it does not move or duplicate prompt files.

## Distribution Model

Sollama is distributed as both a Codex plugin and a Claude Code plugin.

The canonical skill content remains under `skills/**`. Plugin metadata should point to that content where supported, and symlinks may be used to avoid duplicate skill copies. Duplicate prompt trees are out of scope because they will drift.

The Codex manifest lives at `.codex-plugin/plugin.json` and should use the richer Codex plugin metadata shape, including plugin name, version, description, author, skill path, and interface metadata.

The Claude Code manifest lives at `.claude-plugin/plugin.json` and should use the current Claude plugin metadata shape. Existing local examples show a minimal `name`, `version`, `description`, and `author` contract; implementation should verify the current Claude plugin schema before finalizing exact fields.

## Audit Run Model

An audit run writes artifacts into the target repository, not into the Sollama repository:

```text
<target-repo>/.sollama/audits/<audit-id>/
```

The audit id should be stable enough to distinguish runs and should include the target repo name, short pinned commit, and timestamp.

Canonical artifact names:

```text
prepare-output.json
inspect-findings.md
static-analysis.md
fanout/<agent-id>.md
candidate-findings.md
organized-findings.json
organized-findings.md
verification.json
pocs/
report/report.md
```

Each step consumes only the target repo, the user-provided audit inputs, and prior validated artifacts. A step may be run independently for testing or review.

Each step blocks only on missing required inputs, missing required tools, missing permissions, failed build, invalid artifacts, or other conditions that make continuing unsound. When a step blocks, it reports the blocker, the exact user action required, and how to resume, with concrete continuation options such as an exact install command or the env var that must be provided.

Every downstream step applies an upstream status guard: it reads the `status` field of the artifact(s) it consumes (JSON `status`, or the `Status` line in markdown metadata) and refuses to begin work when an upstream artifact is `blocked`, reporting the upstream blocker instead of wasting a full run. The one exception is `g-report`, which may still render a report from partial results but must mark it as produced from a blocked upstream rather than presenting it as a complete audit.

## Workflow

### 1. Prepare

Prepare establishes audit readiness.

It accepts required inputs from the invocation prompt when present, otherwise asks interactively:

- target repository path
- pinned commit

Optional inputs are also asked for, but can be skipped by the user:

- audit scope
- client goals, concerns, or key questions

Prepare must confirm the target is a Rust Solana program, detect framework/package/build tooling, preserve audit scope/focus as text inputs, check required env vars, install target dependencies, run the target build, run or summarize tests, and write `prepare-output.json`.

Build failure blocks the audit. Test failures do not block by default, but must be summarized because they affect audit confidence.

JSON output is validated by a Bun/TypeScript/Zod script owned by the prepare skill. The agent must fix invalid JSON and re-run validation until it passes or the step is blocked.

### 2. Inspect

Inspect builds the mental model of the codebase.

It consumes `prepare-output.json` and writes `inspect-findings.md` with strict required sections covering audit scope, docs, deployments, components, functions, flows, user stories, external dependencies, access control, invariants, attack surfaces, and upgradeability.

Inspect produces markdown only. Its skill and template define the required sections. Structural issues should warn unless the artifact is unusable, but no markdown validation script is required.

Deployment detection uses repo-local files and external documentation identified during inspect. It must not perform live RPC or explorer queries.

External docs linked from the repo may be fetched. Interactive step runs should ask before fetching external URLs; a future full-auto mode may fetch directly and cache or summarize the docs into the audit artifacts.

### 3. Static Analysis

Static analysis runs configured external tools and triages their output.

The default required tool list includes Sec3 X-Ray and Sol-azy, but the required list is configurable through project/user context.

Required tools must be installed and runnable. Missing tools block the step. Sollama never installs tools automatically; it asks permission and provides the exact install command.

Static analysis writes `static-analysis.md` only. The artifact should preserve command status for each tool and fold unavailable tools, failed runs, clean runs, and high-signal triage into one concise summary. Since required tools block when unavailable, absence must not be confused with “no findings.”

### 4. Agent Fanout

Agent fanout is the core vulnerability-discovery step.

It consumes `prepare-output.json`, `inspect-findings.md`, and `static-analysis.md`, then launches one subagent per plugin-bundled prompt file under `agents/lenses/**`, `agents/mechanics/**`, and `agents/gaps/**`.

Each subagent receives an explicitly composed prompt: the fanout skill reads `agents/common.md` from the installed plugin context, reads the specialist agent file from the same context, injects the common rules into the prompt, and launches the subagent with the combined instruction plus the prior audit artifacts.

Fanout runs all specialist agents in parallel. Each agent writes its own file under `fanout/`.

The fanout skill then aggregates those outputs into: `candidate-findings.md`.

Aggregated candidate findings use the canonical block format from common rules, with required shared fields and optional agent-specific fields. Severity is limited to: `info | low | medium | high`.

Candidate findings are grouped by `(program, instruction, class)` as a dedupe guard and review aid. The key is NOT an automatic merge rule.

### 5. Organize

Organize deduplicates, judges, and prepares findings for verification.

It consumes `candidate-findings.md` and prior context, groups likely related findings as a comparison aid, applies LLM judgement to decide duplicates, and almost never merges issues across key mismatch unless the same root cause clearly appears through multiple entrypoints.

Its JSON output is a flat list of organized findings. Each finding has `status: confirmed | rejected | demote`. `confirmed` means the finding passed organizer judgement gates and is ready for verification; it does not mean sandbox-verified.

It writes both:

```text
organized-findings.json
organized-findings.md
```

The JSON artifact is canonical for downstream verification and report generation. It must be validated with a local Bun/TypeScript/Zod script owned by the organize skill.

The markdown artifact is for human review and should summarize confirmed findings, rejected findings, and findings with `status: demote` using validation-gate rationale.

### 6. Verify

Verify filters false positives by reproducing exploitability.

For exploitable findings, `verified` requires a reproduced focused failing test in a sandbox. Info-class findings, such as incorrect or outdated comments, may be confirmed by direct evidence without a sandbox reproduction.

Verification starts with the target repo’s native test framework. It may add focused repro harnesses or tests when needed.

When adding verification tests, verification uses a temporary worktree or branch at the pinned commit. It should not mutate the user’s working copy directly. Test files, patches, logs, and results are copied back into:

```text
.sollama/audits/<audit-id>/pocs/
```

Verification writes `verification.json` and supporting artifacts only. The JSON is canonical for report generation and must be schema-validated; human-readable markdown output is produced by the report step.

### 7. Report

Report produces the final audit deliverable.

It consumes `prepare-output.json`, `verification.json`, and verification artifacts, then writes:

```text
report/report.md
```

`report.md` is the canonical final report deliverable.

The report body includes verified findings first. Unverified or unreproduced findings remain in a clearly separated section near the end of the main report body, not hidden in an appendix.

## Validation Policy

JSON artifacts are strict. The owning skill documents the schema, writes the JSON, runs its Bun/TypeScript/Zod validator, fixes issues, and repeats until validation passes or the step is blocked.

Markdown artifacts are not schema-validated in v1. Skills should document required sections and use templates where helpful, but deterministic validation scripts are reserved for JSON artifacts.

Each JSON-producing step validates its own output before handing off. Missing or unusable markdown artifacts block a dependent step by judgement, not by schema script.

Each step owns its local schemas and validators under that skill’s `scripts/` directory. There is no shared schema package in v1.

The root Bun project exists only to provide one consistent validation/lint/test surface for skill scripts. Biome is the formatter/linter.

## Human Review Model

Each step skill is run independently. Users invoke them in order and can pause for manual review, debugging, or isolated testing between any two steps.

## Aggregate Audit Skill (Out Of Scope)

This spec set (`0001`-`0008`) does not build an aggregate workflow entrypoint. Each of `a-prepare`, `b-inspect`, `c-static-analysis`, `d-agent-fanout`, `e-organize`, `f-verify`, and `g-report` remains independently runnable and owns its own artifact contract, which is what makes a future aggregate possible.

A future spec may add a top-level `audit` skill that runs the steps in order, validates JSON artifacts between steps, and writes a resumable run-status artifact. Its command surface, status schema, and orchestration are deferred and intentionally left unspecified here.

## Key Design Constraints

- Skill-first, not CLI-first.
- Deterministic artifacts over hidden agent memory.
- Small scripts only where determinism matters.
- No automatic dependency installation.
- No live RPC or explorer queries in v1.
- No eval workflow in specs `0001`-`0008`. This will be added in a later spec.
- No aggregate `/audit` command in specs `0001`-`0008`. Steps run independently; composition is deferred to a later spec.
- No duplicated skill or agent prompt trees.
- No final-report suppression of unverified findings; they remain visible but separated.
- Automated testing in v1 covers only the JSON-producing steps via their Zod validators. Markdown-only steps rely on manual review, and no committed sample target repo exists yet; a golden fixture target with known findings for reproducible end-to-end testing is deferred to a later spec.

## Risks

- Plugin manifest schemas may change; implementation must verify current Codex and Claude Code plugin requirements before finalizing manifests. <!-- UNRESOLVED (feasibility): Codex/Claude plugin manifest schema and static-analysis tool commands are deliberately verified at implementation time, not now. Blocks Feasibility 5/5 until confirmed against live docs. -->
<!-- UNRESOLVED (testability): no committed golden fixture target repo; markdown-only steps have no automated/integration test in v1. Blocks Testability 5/5; deferred by decision. -->
- Skill portability depends on avoiding platform-specific tool names in workflow text where possible.
- Full parallel fanout is simple, but staged fanout may eventually improve gap-agent quality.
- Required static analysis tools may make audits hard to run in constrained environments; project/user configurability is the escape hatch.
- Markdown artifacts rely on templates and agent judgement rather than validators; implementation should avoid brittle markdown checks.
