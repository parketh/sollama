---
name: b-inspect
description: (Step 2/7) Inspect a prepared Rust Solana repository and write inspect-findings.md with scope, docs, components, flows, roles, invariants, dependencies, attack surfaces, and upgradeability.
---

# Inspect

Use this skill as Step 2 of a Sollama audit.

Inspect consumes `prepare-output.json` and writes `inspect-findings.md`.

## Inputs

Required input:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`

If the path is missing, ask the user for it.

Upstream status guard: read `prepare-output.json` first. If `status` is `"blocked"`, stop and report the upstream blockers from `summary.blockers`; do not inspect. The operator must resolve the prepare block and re-run `a-prepare` before this step.

Read `prepare-output.json` before inspecting the repository. Use:

- `inputs.auditId`
- `inputs.repoPath`
- `inputs.commitHash`
- `inputs.auditScope`
- `inputs.auditFocus`
- `detected.frameworks`
- `detected.packageManagers`
- `commands.build`
- `commands.tests`
- `summary.warnings`

## Procedure

1. Resolve the target repo and audit output directory from `prepare-output.json`.
2. Confirm the target repo is still at or can read the pinned commit.
3. Expand audit scope into exact files.
4. Count LOC and nSLOC for in-scope files with `skills/b-inspect/scripts/count-loc.ts`.
5. Read repo-local docs and configs relevant to the in-scope program.
6. Identify externally linked docs. Ask before fetching external URLs. (A future full-auto mode may fetch directly and cache/summarize into the audit artifacts; that mode is out of scope here.)
7. Identify known deployments from repo-local files and fetched docs only. Do not query live RPC or explorers.
8. Map folder structure, components, accounts, instructions, libraries, local shared code, and copied/forked boilerplate.
9. Classify entrypoints and important internal functions with access level, caller, parameters, call chain, state changes, value flow, CPI usage, signer/PDA usage, assumptions, parameter ranges, and arithmetic formulas where relevant.
10. Map critical flows and include Mermaid diagrams where they clarify the system.
11. Identify actors, roles, authorities, signers, privileges, operational powers, and pause/emergency coverage.
12. Identify external dependencies, docs-stated assumptions, trust boundaries, and validation procedures.
13. Derive candidate invariants from delta writes, guard predicates, one-shot transitions, formulas, temporal checks, and docs-stated global guarantees.
14. Identify attack surfaces and upgradeability posture.
15. Write `inspect-findings.md`.

## Execution Rules

Prefer read-only commands:

- `git rev-parse HEAD`
- `git cat-file -e <commit>^{commit}`
- `rg --files`
- `rg "<pattern>"`
- `cargo metadata --format-version 1` when useful
- `cargo tree` when dependency context is needed and dependencies are installed
- `bun run skills/b-inspect/scripts/count-loc.ts <files...>` for LOC/nSLOC

Do not mutate the target repo.

Do not run live RPC or explorer queries.

Do not audit third-party dependency internals unless user scope explicitly includes them.

Use repo docs and code over package names when they conflict.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md
```

Use the section order from `skills/b-inspect/templates/inspect-findings.template.md`.

## Scope Expansion

Default in-scope files:

- deployable Rust Solana program crates
- locally authored shared Rust code used by those program crates

Default out-of-scope files:

- tests
- clients and SDKs
- deployment scripts and migrations
- generated IDLs
- build artifacts
- vendored or third-party dependency internals

If `inputs.auditScope` gives a different scope, follow it and document how it changed the default.

## Invariants Method

Build invariants from raw facts based on the exact process below. Do not directly invent invariants. Every invariant must be traced back to a raw fact.

### Step 1: Raw Ingredients

Extract these facts while reading source:

- Delta writes: per instruction/function, identify persistent account/state fields that change and the symbolic delta applied, such as `Δ(total_supply) = +shares` or `Δ(user.balance) = -amount`.
- Guard predicates: every `require`-style check, `assert`, Anchor constraint, explicit `if ... return Err`, signer/owner/address equality check, and account constraint that references persistent state or account identity.
- One-shot transitions: state checks followed by state changes, such as `require(state == Pending); state = Active`, `if !initialized { initialized = true }`, or `authority == default; authority = new_authority`.
- Formula writes: storage writes of the form `A = B * C / D`, fixed-point conversions, decimal conversions, fee formulas, share/asset ratios, and accumulator updates.
- Temporal predicates: slot/timestamp/epoch/deadline/staleness checks and their associated writes.
- Docs-stated global guarantees: invariants, constraints, and promises from README/spec/docs. Mark these as documentation-derived until code confirms them.

### Step 2: Candidate Generation

Generate candidates from the raw ingredients across the following classifications:

1. Conservation: pair `+x` and `-x` writes in the same operation, or scalar/mapping updates that imply `scalar == sum(mapping)`.
2. Bounds: lift guards on persistent state into global properties only when all write sites are checked.
3. Ratio: record storage writes of the form `A = B * C / D`, including rounding direction and whether values are snapshotted before or after other writes.
4. State machines: record allowed transitions and one-shot latches; drop ordinary toggles unless they enforce a meaningful lifecycle.
5. Temporal: record time/slot/epoch freshness, cooldown, deadline, and ordering constraints.

### Step 3: Verification Gate

Before writing an invariant, verify it against concrete code locations:

- Conservation candidates must cite the delta pair or the missing counterpart.
- Bound candidates must enumerate all write sites of the constrained value.
- Ratio candidates must cite the formula and note precision/rounding/snapshot order.
- State-machine candidates must cite both sides of the transition and mention reverse paths if they exist.
- Temporal candidates must involve persistent state, not just transient parameters.
- Cross-program candidates must cite both caller assumption and callee write/read sites, both in scope.
- Economic candidates must cite the underlying single-program or cross-program invariants.

If the invariant cannot be verified, drop it or put the uncertainty in `## Open Questions`; do not present it as fact.

### Step 4: Output Grouping

Group invariants under:

- Enforced guards: useful per-call preconditions, kept as reference and not treated as falsifiable global invariants.
- Single-program invariants: conservation, bounds, ratios, state machines, and temporal constraints inside one program.
- Cross-program invariants: assumptions or couplings across in-scope programs.
- Economic invariants: higher-order value properties derived from the previous groups.

## Handoff

Finish by reporting:

- path to `inspect-findings.md`
- number of in-scope files
- main programs/components identified
- any external docs fetched or skipped
- important open questions
- next step: `c-static-analysis`
