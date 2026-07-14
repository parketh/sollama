# Agent Fanout Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `d-agent-fanout` skill that runs Sollama's specialist audit agents in parallel, captures each agent's candidate findings, and aggregates them into `candidate-findings.md`.

**Architecture:** `d-agent-fanout` is an independently runnable markdown skill. It consumes `prepare-output.json`, `inspect-findings.md`, and `static-analysis.md`, reads agent prompt files bundled with the installed Sollama plugin, injects `agents/common.md` into each specialist prompt, runs all selected agents in parallel, and writes per-agent markdown plus a combined candidate findings artifact.

**Tech Stack:** Markdown skill files, plugin-bundled `agents/` prompts, agent harness subagents, shell/file operations.

---

## Context

Agent fanout is Step 4 and is the core vulnerability-discovery step. Previous steps prepare the repo, map the codebase, and run static-analysis tools. Fanout turns that context into independent adversarial passes by specialist agents.

Agent fanout consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md
<target-repo>/.sollama/audits/<audit-id>/static-analysis.md
```

Agent fanout writes:

```text
<target-repo>/.sollama/audits/<audit-id>/fanout/<agent-file-id>.md
<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md
```

Fanout is markdown-only. Do not create a JSON schema or validation script for this step.

## Files

- Create: `skills/d-agent-fanout/SKILL.md`
- Create: `skills/d-agent-fanout/templates/candidate-findings.template.md`

Do not move, copy, or symlink files from `agents/`. The plugin package includes `agents/` at its top level, and the installed skill should resolve those prompts from its plugin context.

## Agent Inventory

Default agent prompt roots, relative to the installed Sollama plugin root:

```text
agents/lenses/*.md
agents/mechanics/*.md
agents/gaps/*.md
```

Shared rules:

```text
agents/common.md
```

Exclude `agents/common.md` from specialist execution.

Agent IDs are derived from the relative path under `agents/`, without the `.md` suffix:

```text
agents/lenses/access-control-agent.md -> lenses/access-control-agent
agents/mechanics/pda-agent.md -> mechanics/pda-agent
agents/gaps/trust-gap-agent.md -> gaps/trust-gap-agent
```

When writing files, replace `/` with `__`:

```text
fanout/lenses__access-control-agent.md
fanout/mechanics__pda-agent.md
fanout/gaps__trust-gap-agent.md
```

This transformed value is the `agent-file-id`.

Sort agents by relative path before launch so repeated runs are stable.

## Prompt Composition

Each specialist file contains a `## Common rules` section with an import marker:

```markdown
Import [common rules](../common.md) to this section.
```

The fanout skill must not rely on the model or runtime resolving that relative link. It must compose the actual prompt text before launching each subagent:

1. Read `agents/common.md` from the installed Sollama plugin context.
2. Read the specialist agent file from the installed Sollama plugin context.
3. Replace the import marker in the specialist's `## Common rules` section with the full contents of `agents/common.md`.
4. Append audit inputs: target repo path, pinned commit, audit scope, audit focus, inspect artifact, static-analysis artifact, and assigned output path.
5. Tell the subagent to write only to its assigned per-agent output file.

If the import marker is missing, do not silently launch the agent. Record the issue and block until the agent prompt is fixed or the user explicitly excludes that agent.

The `FINDING` block format is defined once in `agents/common.md` (`## Output` section) and is the single source of truth. `common.md` instructs each agent to write only to its assigned per-agent output file; the composed prompt must reinforce that path and must not introduce a competing output filename.

To avoid contract drift, the block fields (`program`, `instruction`, `class`, `description`, `severity`, `confidence`, `path`, `proof`, `fix`) are NOT restated anywhere else. The `candidate-findings` template references `common.md` rather than duplicating the block. The `e-organize` parser is the one legitimate consumer that re-encodes the field list — because it must validate the format — and it cites `agents/common.md` as the authority in a comment so any field change there is a signal to update the parser.

Some existing shared examples are EVM/Solidity-flavored. The composed prompt must make the target explicit: the agents are auditing Rust Solana programs, and any non-Solana examples in common rules are reasoning analogies, not audit scope.

## Output Contract

Each per-agent file should contain:

1. `# <Agent Name>`
2. `## Status`
3. `## Findings`
4. `## Notes`

`## Findings` contains zero or more `FINDING` blocks using the canonical format from `agents/common.md`, with optional fields from the specialist agent's `## Output fields` section.

The combined `candidate-findings.md` must contain these top-level sections, in this order:

1. `# Candidate Findings`
2. `## Metadata`
3. `## Agent Runs`
4. `## Summary`
5. `## Convergence`
6. `## Candidate Findings`
7. `## Notes`

The combined artifact is table-first so it stays scannable at any candidate count. It should preserve each candidate's canonical `FINDING` fields with minimal rewriting and add provenance (`CAND-XXX` id, source agent), but it should not dedupe, classify, or merge findings. That work belongs to `e-organize`.

Agent-specific optional fields (e.g. `seam`, `assumption`, `violation`) are NOT carried into `candidate-findings.md`; they remain in the per-agent `fanout/<agent-file-id>.md`. Carrying every optional field into the aggregate was the main source of unreadable, over-long blocks; the per-agent files remain the lossless record.

## Candidate Ids

Assign every candidate a stable `CAND-XXX` id (zero-padded, sequential). Order deterministically: by agent relative path, then by order within the agent file, so reruns renumber identically. Ids anchor the `## Summary` and `## Convergence` tables and give `e-organize` a handle to cite when it merges or splits.

## Grouping Rules

The `## Summary` table lists one row per candidate (`ID | Sev | Conf | Program | Instruction | Class | Agent | Description`), sorted by program, then instruction, then severity. It is the scannable index over all candidates.

Group the full blocks under `### <program> / <instruction>` headings, not by `class`. `class` is a free-text kebab tag each agent invents; grouping on it fragments into one-block-per-group. Grouping on `(program, instruction)` collides usefully and mirrors `e-organize`'s Pass 2 dedup key.

The `## Convergence` table names clusters where two or more candidates target the same surface, listing their member `CAND-XXX` ids — a dedupe/comparison aid for later steps. Fanout must not merge findings; pointing at overlap is not merging. Key/cluster matches still require later LLM judgement in `e-organize`.

If an agent emits malformed or partial finding blocks, preserve them in `candidate-findings.md` with a `parse_warning` note instead of discarding them. Later steps can often infer intent from imperfect markdown.

## Task 1: Create The Agent Fanout Skill

**Objective:** Add the self-contained fanout workflow.

**Files:**

- Create: `skills/d-agent-fanout/SKILL.md`

**Draft `SKILL.md`:**

````markdown
---
name: d-agent-fanout
description: (Step 4/7) Run Sollama specialist audit agents in parallel and aggregate candidate findings.
---

# Agent Fanout

Use this skill as Step 4 of a Sollama audit.

Agent fanout consumes `prepare-output.json`, `inspect-findings.md`, and `static-analysis.md`, then writes per-agent outputs under `fanout/` and a combined `candidate-findings.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md`
- path to `<target-repo>/.sollama/audits/<audit-id>/static-analysis.md`

If any audit artifact path is missing, ask the user for it. Do not ask the user for an `agents/` path; agent prompts are part of the installed Sollama plugin.

## Procedure

1. Read `prepare-output.json`, `inspect-findings.md`, and `static-analysis.md`. Upstream status guard: if `prepare-output.json` `status` is `"blocked"` or `static-analysis.md` metadata `Status` is `blocked`, stop and report the upstream blockers; do not launch agents. The operator must resolve the upstream block and re-run that step first.
2. Confirm the pinned commit is checked out: `git rev-parse HEAD` must equal `inputs.commitHash` and `git status --porcelain` must be empty. If HEAD differs or the working tree is dirty, stop and report a blocker; do not launch agents against a different or modified tree. Do not change the checkout yourself; the operator must set the correct checkout.
3. Read `agents/common.md` from the installed Sollama plugin context.
4. Discover specialist agents under the installed plugin's `agents/lenses/*.md`, `agents/mechanics/*.md`, and `agents/gaps/*.md`.
5. Sort agents by relative path and derive stable agent IDs.
6. For each specialist agent, compose a prompt by injecting `agents/common.md` into its `## Common rules` section and appending the audit context plus assigned output path.
7. Launch all specialist agents in parallel using the current agent harness's subagent/parallel execution facility.
8. Require each agent to write one output file under `fanout/<agent-file-id>.md`.
9. Retry failed or missing agent runs once if the failure is transient.
10. If any required agent still fails, write `candidate-findings.md` with status `blocked` unless the user explicitly excludes that agent.
11. Aggregate per-agent outputs into `candidate-findings.md`: assign `CAND-XXX` ids, build the `## Summary` and `## Convergence` tables, then the grouped full blocks.
12. Preserve candidate blocks, agent provenance, malformed blocks, and parse warnings without deduping or merging findings.

## Prompt Rules

The composed prompt must state:

- audit target is a Rust Solana program
- non-Solana examples in common rules are reasoning analogies only
- agent must use prior artifacts as context, not as proof
- agent must produce concrete candidate findings or explicitly say it found none
- agent must write only to its assigned output file
- findings use `program`, `instruction`, and `class` in the first row
- optional specialist fields from `## Output fields` should be preserved

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/fanout/<agent-file-id>.md
<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md
```

Use the section order from `skills/d-agent-fanout/templates/candidate-findings.template.md`.

## Aggregation Rules

Do not dedupe, classify, or merge candidate findings.

Assign every candidate a stable `CAND-XXX` id (agent relative path, then order within file). Build a `## Summary` table (one row per candidate, sorted by program, instruction, severity) and a `## Convergence` table (clusters of two or more candidates on the same surface, by id).

Group full blocks under `### <program> / <instruction>` headings, not by `class`. Copy the canonical `FINDING` fields only; agent-specific optional fields stay in the per-agent `fanout/<agent-file-id>.md`.

Preserve malformed candidate blocks with `parse_warning` rather than dropping them.

## Handoff

Finish by reporting:

- path to `candidate-findings.md`
- number of agents launched
- number of agents completed
- failed/excluded agents, if any
- number of candidate finding blocks
- next step: `e-organize` when fanout is complete
````

## Task 2: Add Candidate Findings Template

**Objective:** Give the combined fanout artifact a stable shape without over-structuring it.

**Files:**

- Create: `skills/d-agent-fanout/templates/candidate-findings.template.md`

**Template content:**

````markdown
# Candidate Findings

## Metadata

- Audit ID:
- Target repo:
- Pinned commit:
- Prepared from:
- Inspect source:
- Static-analysis source:
- Generated at:
- Status: ready | blocked

## Agent Runs

| Agent ID | Output | Status | Findings | Notes |
| --- | --- | --- | ---: | --- |

## Summary

One row per candidate. Assign `CAND-XXX` ids in stable order (agent relative path, then order within the agent file). Sort by program, then instruction, then severity (high → info). Keep `Description` to one short clause (≤ 12 words).

| ID | Sev | Conf | Program | Instruction | Class | Agent | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Convergence

Clusters where two or more candidates target the same surface — a dedupe/comparison aid for `e-organize`. List member `CAND-XXX` ids; omit singletons.

| Cluster | Candidates | Note |
| --- | --- | --- |

## Candidate Findings

Full blocks grouped under `### <program> / <instruction>` headings (not by `class`, which fragments). Prefix each block with its `CAND-XXX` id and a `Source agent:` line, then the canonical `FINDING` block from `agents/common.md` (`## Output`). Do not restate the field list; do not carry agent-specific optional fields (they stay in `fanout/<agent-file-id>.md`). Preserve malformed blocks with a `parse_warning:` line.

## Notes

Record failed agents, excluded agents, zero-finding agents, malformed blocks, parse warnings, and context that `e-organize` should consider.
````

## Task 3: Manual Verification

**Objective:** Verify fanout can run independently and produce complete downstream context.

**Files:**

- Test target output: `<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md`
- Test per-agent outputs: `<target-repo>/.sollama/audits/<audit-id>/fanout/*.md`

**Verification steps:**

Run `d-agent-fanout` on a prepared target and confirm:

- It discovers every specialist agent under the installed plugin's `agents/lenses`, `agents/mechanics`, and `agents/gaps`.
- It excludes `agents/common.md` from specialist execution.
- It injects the full common rules into each composed prompt.
- It launches specialist agents in parallel when the harness supports parallel subagents.
- Each completed agent writes exactly one per-agent output file.
- `candidate-findings.md` is created at the expected path.
- Candidate blocks preserve agent-specific optional fields.
- The combined artifact does not dedupe or merge findings.
- Malformed findings are preserved with parse warnings.
- Failed required agents block unless explicitly excluded by the user.

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

- Read `candidate-findings.md`.
- Confirm it is useful as direct input for `e-organize`.
- Confirm no candidate was dropped merely because its markdown was imperfect.

## Risks

- Parallel subagent APIs differ across Codex and Claude Code. The skill should describe the execution contract without binding to one implementation.
- Injecting common rules increases prompt size. If context becomes tight, the fanout skill should still inject common rules rather than relying on relative markdown links.
- Some common-rule examples are not Solana-specific. The composed prompt must anchor every agent back to Rust Solana audit scope.
- Candidate blocks are markdown and may be imperfect. This is acceptable because `e-organize` applies judgement over the combined artifact.

## Post-Implementation Changes

Restructured the combined `candidate-findings.md` to be table-first and scannable at any candidate count (commit `88c5eba`):

- **Stable candidate ids.** Every candidate now gets a zero-padded, sequential `CAND-XXX` id, ordered by agent relative path then order within the agent file, so reruns renumber identically. Ids anchor the tables and give `e-organize` a stable handle.
- **New `## Summary` table.** One row per candidate (`ID | Sev | Conf | Program | Instruction | Class | Agent | Description`), sorted by program, instruction, severity — a scannable index over all candidates.
- **New `## Convergence` table.** Clusters two or more candidates hitting the same surface by their `CAND-XXX` ids, surfacing overlap for `e-organize`'s dedup passes. Pointing at overlap is not merging.
- **Grouping key changed.** Full blocks now group under `### <program> / <instruction>` headings instead of `(program, instruction, class)`. `class` is a free-text kebab tag that fragments into one-block-per-group; `(program, instruction)` collides usefully and mirrors `e-organize`'s Pass 2 key.
- **Field discipline.** Only the canonical `FINDING` fields are carried into the aggregate; agent-specific optional fields (`seam`, `assumption`, `violation`, `pair_or_branch`, etc.) stay in the per-agent `fanout/<agent-file-id>.md`, which remains the lossless record. This was the main source of unreadable, over-long blocks.
- **`## Agent Runs` columns simplified** (dropped `Prompt` and per-block columns), and `## Notes` now also records zero-finding agents.
