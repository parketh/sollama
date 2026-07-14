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

## Agent Inventory

Discover specialist agents from the installed Sollama plugin context, relative to the plugin root:

```text
agents/lenses/*.md
agents/mechanics/*.md
agents/gaps/*.md
```

Exclude `agents/common.md` from specialist execution; it holds shared rules.

Derive the agent ID from the relative path under `agents/`, dropping the `.md` suffix. When writing files, replace `/` with `__` to form the `agent-file-id`:

```text
agents/lenses/access-control-agent.md -> lenses/access-control-agent -> lenses__access-control-agent
agents/mechanics/pda-agent.md         -> mechanics/pda-agent         -> mechanics__pda-agent
agents/gaps/trust-gap-agent.md        -> gaps/trust-gap-agent        -> gaps__trust-gap-agent
```

Sort agents by relative path before launch so repeated runs are stable.

## Procedure

1. Read `prepare-output.json`, `inspect-findings.md`, and `static-analysis.md`. Upstream status guard: if `prepare-output.json` `status` is `"blocked"`, or `inspect-findings.md` metadata `Status` is `blocked`, or `static-analysis.md` metadata `Status` is `blocked`, stop and report the upstream blockers; do not launch agents. The operator must resolve the upstream block and re-run that step first.
2. Confirm the pinned commit is checked out: `git rev-parse HEAD` must equal `inputs.commitHash` and `git status --porcelain` must be empty. If HEAD differs or the working tree is dirty, stop and report a blocker; do not launch agents against a different or modified tree. Do not change the checkout yourself; the operator must set the correct checkout.
3. Read `agents/common.md` from the installed Sollama plugin context.
4. Discover specialist agents under the installed plugin's `agents/lenses/*.md`, `agents/mechanics/*.md`, and `agents/gaps/*.md`.
5. Sort agents by relative path and derive stable agent IDs.
6. For each specialist agent, compose a prompt by injecting `agents/common.md` into its `## Common rules` section and appending the audit context plus assigned output path.
7. Create the `fanout/` output directory under the audit root, then launch all specialist agents in parallel using the current agent harness's subagent/parallel execution facility.
8. Require each agent to write one output file under `fanout/<agent-file-id>.md`.
9. Retry failed or missing agent runs once if the failure is transient.
10. If any required agent still fails, write `candidate-findings.md` with status `blocked` unless the user explicitly excludes that agent.
11. Aggregate per-agent outputs into `candidate-findings.md`: assign `CAND-XXX` ids, build the `## Summary` and `## Convergence` tables, then the grouped full blocks.
12. Preserve candidate blocks, agent provenance, malformed blocks, and parse warnings without deduping or merging findings.

## Prompt Composition

Each specialist file contains a `## Common rules` section with an import marker:

```markdown
Import [common rules](../common.md) to this section.
```

Do not rely on the model or runtime resolving that relative link. Compose the actual prompt text before launching each subagent:

1. Read `agents/common.md` from the installed Sollama plugin context.
2. Read the specialist agent file from the same context.
3. Replace the import marker in the specialist's `## Common rules` section with the full contents of `agents/common.md`.
4. Append audit inputs: target repo path, pinned commit, audit scope, audit focus, inspect artifact, static-analysis artifact, and assigned output path.
5. Tell the subagent to write only to its assigned per-agent output file.

If the import marker is missing, do not silently launch the agent. Record the issue and block until the agent prompt is fixed or the user explicitly excludes that agent.

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

Each per-agent file should contain:

1. `# <Agent Name>`
2. `## Status`
3. `## Findings`
4. `## Notes`

`## Findings` contains zero or more `FINDING` blocks using the canonical format from `agents/common.md`, with optional fields from the specialist agent's `## Output fields` section.

Use the section order from `skills/d-agent-fanout/templates/candidate-findings.template.md`.

## Aggregation Rules

Do not dedupe, classify, or merge candidate findings. That work belongs to `e-organize`.

Use the section order from `skills/d-agent-fanout/templates/candidate-findings.template.md`. The aggregate is table-first so it stays scannable:

1. **Ids.** Assign every candidate a stable `CAND-XXX` id (zero-padded, sequential). Order deterministically: by agent relative path, then by order within the agent file, so reruns renumber identically.
2. **`## Summary` table.** One row per candidate: `ID | Sev | Conf | Program | Instruction | Class | Agent | Description`. Sort by program, then instruction, then severity (high → info). Keep `Description` to one short clause (≤ 12 words). This is the scannable index over all candidates.
3. **`## Convergence` table.** List clusters where two or more candidates hit the same surface, with their member `CAND-XXX` ids and a one-line note. This surfaces multi-agent overlap for `e-organize`'s dedup passes. Omit singletons. Pointing at overlap is not merging.
4. **`## Candidate Findings` blocks.** Group full blocks under `### <program> / <instruction>` headings — NOT by `class`. `class` is a free-text kebab tag each agent invents; grouping on it fragments into one-block-per-group. Grouping on `(program, instruction)` collides usefully and mirrors `e-organize`'s Pass 2 key. Prefix each block with its `CAND-XXX` id and a `Source agent:` line.

Field discipline keeps blocks readable:

- Copy the canonical `FINDING` fields (`program`, `instruction`, `class`, `description`, `severity`, `confidence`, `path`, `proof`, `fix`) defined once in `agents/common.md` (`## Output`) — the single source of truth. Do not restate the field list.
- Do NOT carry agent-specific optional fields (e.g. `seam`, `assumption`, `violation`, `pair_or_branch`) into `candidate-findings.md`. They stay in the per-agent `fanout/<agent-file-id>.md`, which `e-organize` can consult when a block needs more context. Keep each carried field terse.

Preserve malformed candidate blocks with a `parse_warning:` line rather than dropping them. Later steps can often infer intent from imperfect markdown.

## Handoff

Finish by reporting:

- path to `candidate-findings.md`
- number of agents launched
- number of agents completed
- failed/excluded agents, if any
- number of candidate finding blocks
- next step: `e-organize` when fanout is complete
