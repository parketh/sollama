---
name: e-organize
description: (Step 5/7) Deduplicate and judge candidate audit findings into validated organized-findings.json plus organized-findings.md.
---

# Organize

Use this skill as Step 5 of a Sollama audit.

Organize consumes `candidate-findings.md` and prior audit context, then writes `organized-findings.json` and `organized-findings.md`.

## Inputs

Required inputs:

- path to `<target-repo>/.sollama/audits/<audit-id>/prepare-output.json`
- path to `<target-repo>/.sollama/audits/<audit-id>/inspect-findings.md`
- path to `<target-repo>/.sollama/audits/<audit-id>/static-analysis.md`
- path to `<target-repo>/.sollama/audits/<audit-id>/candidate-findings.md`

If any path is missing, ask the user for it.

## Procedure

1. Read all inputs. Upstream status guard: if `prepare-output.json` `status` is `"blocked"` or `candidate-findings.md` metadata `Status` is `blocked`, stop and report the upstream blockers; do not organize. The operator must resolve the upstream block and re-run that step first.
2. Parse candidate `FINDING` blocks from `candidate-findings.md`. Each block carries a `CAND-XXX` id (from the `## Summary` table); record it as the `sourceCandidates[].candidateId` handle for every organized finding it feeds. The `## Summary` and `## Convergence` tables seed the Pass 1 / Pass 2 dedup below; if a block needs more context than its canonical fields, consult the per-agent `fanout/<agent-file-id>.md` (agent-specific optional fields live there, not in `candidate-findings.md`).
3. Preserve malformed candidate blocks as `demote` or `rejected`; do not silently drop them.
4. Group candidates by `(program, instruction, class)` as a comparison aid (Pass 1).
5. Split candidates that have different root causes, fixes, impacts, or attack paths.
6. Merge candidates only when they describe the same root cause and attack path.
7. Re-run dedup at `(program, instruction)` ignoring `class` (Pass 2) to catch synonymous-class duplicates; never merge across different `program`/`instruction`.
8. Run the completeness gate: every unique `(program, instruction)` in the candidates must map to at least one organized finding, else record the drop in `summary.warnings`.
9. For each resulting item, run the four validation gates in order.
10. Assign `status: "confirmed" | "rejected" | "demote"`.
11. Assign severity and confidence when meaningful; use `null` when rejected data should not be scored.
12. Write `organized-findings.json`.
13. Run `bun run skills/e-organize/scripts/validate-organize-output.ts <path-to-organized-findings.json>`.
14. Fix schema issues and re-run validation until it passes or the step is blocked.
15. Write `organized-findings.md` from the validated JSON.

## Organization Rules

Parse every `FINDING` block from `candidate-findings.md`. The `FINDING` field list is defined once in `agents/common.md` (`## Output`); the validator/parser is its one legitimate re-encoder. Preserve malformed or partial blocks as `demote` or `rejected` findings rather than silently dropping them.

`class` is an intentionally free-text kebab tag invented by each agent, not a controlled vocabulary. Grouping on it is a soft aid, so dedupe must not rely on class tags matching. Two passes are required:

Pass 1 — group by `(program, instruction, class)`:

- Key match means "compare carefully."
- Key mismatch usually means "do not merge."
- Merge across key mismatch only when the same root cause clearly appears through multiple entrypoints.
- Split same-key candidates when they describe different root causes, impacts, fixes, or exploit paths.

Pass 2 — re-run at `(program, instruction)` ignoring `class`:

- Agents often label the same underlying bug with different class tags (e.g. `missing-signer` vs `signer-check`). Pass 2 catches synonymous-class duplicates that Pass 1 missed.
- Compare the body (description, root cause, attack path, fix) across class boundaries. Merge only when root cause and attack path match; distinct mechanisms at the same `(program, instruction)` remain separate findings.
- Never merge across different `program` or `instruction`. Pass 2 stays within `(program, instruction)`.

Completeness gate (before writing output): list every unique `(program, instruction)` appearing in any candidate `FINDING` block. Every such `(program, instruction)` must map to at least one organized finding of any status. Zero coverage means a candidate was silently dropped — fix it, or record the drop with rationale in `summary.warnings`.

Final output is a flat `findings` array. Do not create separate top-level arrays for groups, rejected candidates, or verification queues.

`status` meanings:

- `confirmed`: passes the organize validation gates and is ready for `f-verify`. This does not mean sandbox-verified.
- `demote`: high-signal lead, code smell, low-materiality issue, privileged-only path, or incomplete exploit trace worth preserving.
- `rejected`: invalid, out of scope, self-harm-only, blocked by code, structurally impossible, or admin-action-only with no unprivileged amplifier.

## Validation Gates

Every organized finding must record gate results. Evaluate gates in order. Stop at the first failing gate unless the remaining gates are needed to explain a demotion.

### Gate 1: Attack Execution

Trace the claimed path from caller to harm. Read every guard, signer check, account constraint, owner check, PDA derivation, CPI target check, and state invariant on that path.

- If a concrete check blocks the exploit before harm, mark `rejected`.
- If the exploit path is partial but a related weakness remains, mark `demote`.
- If the only objection is speculative operator behavior or deployer intent, continue.

### Gate 2: Reachability

Prove the vulnerable state can exist in the audited deployment model.

- Structurally impossible state: `rejected`.
- Requires privileged actions outside normal operation: `demote`.
- Achievable through normal protocol use, ordinary Solana account behavior, or plausible token behavior: continue.

### Gate 3: Trigger

Prove who can execute the attack.

- Trusted-role-only trigger: `demote`.
- Unprivileged or permissionless trigger: continue.
- Admin-action findings are `rejected` unless the finding names a concrete unprivileged amplifier, such as a race, retroactive sweep, asymmetric formula, or access gap.

### Gate 4: Impact

Prove material harm to an identifiable victim or protocol invariant.

- Self-harm only: `rejected`.
- Dust-level or bounded non-compounding harm: `demote`.
- Material loss, account takeover, permanent lock, protocol insolvency, invariant break, or meaningful denial of service: `confirmed`.

### Confidence

Classify confidence as `low`, `medium`, or `high`.

- `high`: concrete attack path, reachable state, clear trigger, and material impact are all supported by source or prior artifacts.
- `medium`: exploit appears valid, but depends on a specific reachable state, deployment assumption, or bounded impact analysis.
- `low`: useful lead, but attack path, reachability, trigger, or impact remains incomplete.

`confirmed` findings should usually be `medium` or `high`. Use `demote` for low-confidence leads unless multi-agent convergence or a clear partial-path completion justifies carrying them forward.

### Promotion And Demotion

Promote a lead with `status: "demote"` to `confirmed` when:

- the missing trace can be completed from source or prior artifacts
- the same root cause is confirmed elsewhere and echoes into this program/instruction
- two or more agents flagged the same issue and no gate rejects the path

Do not let multi-agent convergence override a code path that blocks the exploit before harm.

Do not mark anything sandbox-verified. `confirmed` here means confirmed by organizer judgement and ready for `f-verify`.

## Output

Write:

```text
<target-repo>/.sollama/audits/<audit-id>/organized-findings.json
<target-repo>/.sollama/audits/<audit-id>/organized-findings.md
```

Use the schema and templates from this skill. For `status: "blocked"`, still write a schema-valid `organized-findings.json` when possible, put blocker details in `summary.blockers`, and leave `findings` empty if organization could not proceed.

## Handoff

Finish by reporting:

- path to `organized-findings.json`
- path to `organized-findings.md`
- confirmed count
- demote count
- rejected count
- blocked items, if any
- next step: `f-verify` when JSON validation passes
