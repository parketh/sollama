# Inspect Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `b-inspect` skill that turns `prepare-output.json` and the target repo into a structured mental model of the audited Solana program.

**Architecture:** `b-inspect` is an independently runnable markdown skill. It expands the prepare step’s raw audit scope/focus text into concrete in-scope code, reads the target repository and relevant docs, and writes a strict-section markdown artifact for downstream static analysis, fanout, organize, verify, and report steps.

**Tech Stack:** Markdown skill files, target repo shell inspection, Git, Rust/Cargo metadata, Mermaid diagrams where useful.

---

## Context

Inspect is the first deep code-understanding step. Prepare answers “can this repo be audited?” Inspect answers “what exactly is this system and where should later agents look?”

Inspect consumes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
```

Inspect writes:

```text
<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md
```

Inspect is markdown-only. Do not create a JSON schema or validation script for this step. Downstream LLM steps can tolerate minor structure deviations, but the skill should still write the required headings and non-empty sections.

## Files

- Create: `skills/b-inspect/SKILL.md`
- Create: `skills/b-inspect/scripts/count-loc.ts`
- Create: `skills/b-inspect/templates/inspect-findings.template.md`

Only create a script for deterministic LOC/nSLOC counting. Do not create schema validators for this markdown-only step.

## Output Contract

`inspect-findings.md` must contain these top-level sections, in this order:

1. `# Inspect Findings`
2. `## Metadata`
3. `## Audit Scope`
4. `## Documentation`
5. `## Deployments`
6. `## Components`
7. `## Functions And Entrypoints`
8. `## Flows`
9. `## User Stories`
10. `## External Dependencies`
11. `## Access Control`
12. `## Invariants`
13. `## Attack Surfaces`
14. `## Upgradeability`
15. `## Open Questions`

Sections should be concise but substantive. Empty placeholders are not acceptable unless the section genuinely does not apply, in which case the section should say why.

The output should be an auditor handoff package, not a generic repository summary. It must make code accessible by documenting scope, folder structure, build/test context from prepare, third-party boundaries, actors/privileges, primary flows, and the specific invariants downstream agents should attack.

## Scope Rules

Inspect expands `inputs.auditScope` from `prepare-output.json` into exact included files.

Default scope includes:

- deployable Rust Solana program crates
- locally authored shared Rust code used by deployable program crates

Default scope excludes:

- tests
- clients and SDKs
- deployment scripts and migrations
- generated IDLs
- build artifacts
- vendored or third-party dependency internals

User-provided audit scope can override the defaults. When user scope conflicts with the default, follow the user scope and document the decision in `## Audit Scope`.

Third-party dependencies are trust boundaries. Inspect should identify their role and assumptions, but should not audit their internals by default.

## Task 1: Create The Inspect Skill

**Objective:** Add the self-contained inspect workflow.

**Files:**

- Create: `skills/b-inspect/SKILL.md`

**Draft `SKILL.md`:**

````markdown
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
2. Confirm the pinned commit is checked out: `git rev-parse HEAD` must equal `inputs.commitHash` and `git status --porcelain` must be empty. If HEAD differs or the working tree is dirty, stop and report a blocker; do not inspect a different or modified tree. Do not change the checkout yourself; the operator must set the correct checkout.
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
````

## Task 2: Add The Inspect Template

**Objective:** Give inspect a stable output skeleton without adding a validator script.

**Files:**

- Create: `skills/b-inspect/templates/inspect-findings.template.md`

**Template content:**

````markdown
# Inspect Findings

## Metadata

- Audit ID:
- Target repo:
- Pinned commit:
- Prepared from:
- Generated at:
- Build status from prepare:
- Test status from prepare:
- Audit focus:

## Audit Scope

### Scope Source

Describe whether scope came from defaults, user-provided text, or both.

### Included Files

| File | Crate/Program | LOC | nSLOC | Reason |
| --- | --- | ---: | ---: | --- |

## Documentation

| Source | Type | Summary |
| --- | --- | --- |

## Deployments

List program IDs, cluster references, upgrade authorities, or deployment notes found in repo-local files or fetched docs. If none are found, say so.

## Components

### Repository Shape

Explain the folder structure and which folders matter to the audit.

### Program And Module Map

| Component | Type | Files | Purpose | Notes |
| --- | --- | --- | --- | --- |

Types: program, account/state, instruction module, local library, helper, generated artifact, copied/forked code.

### Boilerplate / Forked / Generated Code

Identify copied, forked, generated, or framework boilerplate so downstream agents focus on authored logic.

## Functions And Entrypoints

### Entrypoint Summary

| Entrypoint | Access | Actor | Value Flow | State Modified | CPI/External Calls | Notes |
| --- | --- | --- | --- | --- | --- | --- |

Access categories: permissionless, role-gated, admin-only, initializer, internal-only.

Value flow: in, out, both, none.

### Detailed Function Notes

For each important instruction or internal function, include:

- file reference
- purpose
- access control and signer requirements
- parameters and trust level
- account/state reads
- account/state writes
- call chain
- CPI/external calls
- assumptions
- important guards
- arithmetic formulas
- parameter ranges and precision/rounding notes

## Flows

Document primary workflows and critical paths. Include prerequisite chains where useful, e.g. setup ← initialize ← deposit ← withdraw.

For each flow:

- actor
- entrypoint sequence
- required accounts/state
- value movement
- external calls
- terminal state

Use Mermaid diagrams where useful.

## User Stories

List expected user/admin/operator stories and the intended outcome for each.

| Actor | Story | Expected Outcome | Relevant Entrypoints |
| --- | --- | --- | --- |

## External Dependencies

List third-party programs, crates, or off-chain dependencies as trust boundaries.

| Dependency | Role | Version/ID | Trust Assumption | Validation |
| --- | --- | --- | --- | --- |

Include token programs, oracle programs, governance/multisig, bridges, off-chain services, third-party crates with security relevance, and externally linked docs that define behavior.

## Access Control

### Actors And Privileges

| Actor/Role | How Identified | Capabilities | Instant Or Delayed | Can Move/Freeze/Redirect Value? |
| --- | --- | --- | --- | --- |

### Entrypoint Access Map

| Entrypoint | Required Signer/Authority | Constraint Source | Notes |
| --- | --- | --- | --- |

### Pause / Emergency / Recovery Coverage

Document which critical flows can be paused, frozen, recovered, upgraded, or force-closed, and which cannot.

## Invariants

### Raw Facts

#### Delta Writes

| Location | State Field | Delta | Notes |
| --- | --- | --- | --- |

#### Guard Predicates

| Location | Predicate | Protects |
| --- | --- | --- |

#### One-Shot / State Transitions

| Location | Transition | Notes |
| --- | --- | --- |

#### Formula And Ratio Writes

| Location | Formula | Rounding / Snapshot Notes |
| --- | --- | --- |

#### Temporal Predicates

| Location | Constraint | Notes |
| --- | --- | --- |

### Enforced Guards Reference

List useful per-call guards. These are not automatically global invariants.

### Single-Program Invariants

Group by conservation, bounds, ratios, state machines, and temporal constraints.

| ID | Type | Property | Evidence | On-Chain? | Gaps |
| --- | --- | --- | --- | --- | --- |

### Cross-Program Invariants

| ID | Property | Caller-Side Assumption | Callee/Other-Side Evidence | On-Chain? | Gaps |
| --- | --- | --- | --- | --- | --- |

### Economic Invariants

| ID | Property | Derived From | On-Chain? | Gaps |
| --- | --- | --- | --- | --- |

## Attack Surfaces

List trust boundaries, unchecked or weakly checked values, hard-coded values, CPI surfaces, token/mint assumptions, account substitution surfaces, risky state transitions, centralization/role-compromise surfaces, and invariant gaps.

Where possible, cross-reference relevant invariant IDs.

## Upgradeability

Describe upgrade authority, program upgrade posture, storage/account layout concerns, governance controls, role-transfer delays, and operational-action delays.

## Open Questions

List missing docs, ambiguous scope decisions, unresolved assumptions, and issues that should be carried into static analysis or fanout.
````

## Task 3: Add LOC/nSLOC Counter

**Objective:** Add a deterministic helper for counting total lines and non-comment source lines in scoped Rust files.

**Files:**

- Create: `skills/b-inspect/scripts/count-loc.ts`

**Implementation notes:**

The script should:

- accept one or more file paths as positional arguments
- read each file as UTF-8
- output JSON to stdout
- count `loc` as total physical lines
- count `nsloc` as non-empty lines excluding Rust line comments and block comments
- preserve the input path in output
- exit non-zero if any input file cannot be read

Draft output shape:

```json
{
  "files": [
    {
      "path": "programs/foo/src/lib.rs",
      "loc": 120,
      "nsloc": 84
    }
  ],
  "totals": {
    "loc": 120,
    "nsloc": 84
  }
}
```

Draft command:

```bash
bun run skills/b-inspect/scripts/count-loc.ts programs/foo/src/lib.rs programs/foo/src/state.rs
```

Expected: JSON prints to stdout. Inspect copies the counts into the `### Included Files` table.

The script does not need to perfectly parse Rust. A simple scanner that handles blank lines, `//` line comments, and `/* ... */` block comments is sufficient for audit scoping.

## Task 4: Document Inspect Execution Rules

**Objective:** Make the inspect workflow deterministic enough for a future implementer without overbuilding scripts.

**Files:**

- Modify: `skills/b-inspect/SKILL.md`

**Implementation notes:**

The skill should prefer read-only commands:

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

## Task 5: Manual Verification

**Objective:** Verify the skill produces useful downstream context.

**Files:**

- Test target output: `<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md`

**Verification steps:**

Run `b-inspect` on at least one prepared Anchor or native Solana repo and confirm:

- `inspect-findings.md` is created at the expected path.
- All required top-level sections are present.
- Scope expands `inputs.auditScope` into concrete included files.
- LOC and nSLOC are populated from `count-loc.ts`.
- Tests, clients, generated IDLs, build artifacts, and vendored dependencies are excluded unless explicitly scoped in.
- Locally authored shared Rust code used by in-scope programs is included.
- Documentation-derived claims are extracted and marked as doc-stated.
- Entrypoints include access level, actor, value flow, state changes, and CPI/external calls.
- At least one primary flow is documented.
- Roles/authorities/signers are mapped.
- Invariants include raw facts, enforced guards, single-program candidates, cross-program candidates, and economic candidates.
- Invariants are generated from code facts rather than generic guesses and cite evidence or gaps.
- Open questions preserve real uncertainty instead of hallucinating certainty.

## Final Verification

After this spec is implemented:

```bash
bun run format:check
bun run typecheck
bun run skills/b-inspect/scripts/count-loc.ts skills/b-inspect/templates/inspect-findings.template.md
```

Expected:

- repository formatting/linting passes
- TypeScript typecheck still passes
- LOC/nSLOC script prints valid JSON

Manual output review:

- Read the generated `inspect-findings.md`.
- Confirm it is useful as direct input for `c-static-analysis` and `d-agent-fanout`.

## Risks

- LOC/nSLOC counts may be approximate without a dedicated local counter; approximate counts are acceptable if the method is documented.
- External documentation fetching asks before fetching in step runs; a future full-auto mode may fetch directly.
- Scope expansion is judgment-heavy. The skill must document decisions rather than pretend scope is obvious.
- Inspect can become bloated. Keep prose concise and focus on facts downstream agents need.
