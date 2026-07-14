# Inspect Findings

## Metadata

- Status: ready | blocked
- Audit ID: <audit-id>
- Target repo: <route-to-target-repo>
- Pinned commit: <commit-hash>
- Prepared from: <route-to-prepare-output-json>
- Generated at: <date-time>
- Build status from prepare: <build-status>
- Test status from prepare: <test-status>
- Audit focus: <audit-focus>

## Audit Scope

### Scope Source

Describe whether scope is default (i.e. all contracts in scope) or user-provided, and if so, what it contains.

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
