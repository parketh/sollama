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

One row per candidate. Assign `CAND-XXX` ids (zero-padded, sequential) in stable order: agent relative path, then order within the agent file. Sort this table by program, then instruction, then severity (high → info). Keep `Description` to one short clause (≤ 12 words).

| ID | Sev | Conf | Program | Instruction | Class | Agent | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Convergence

Clusters where two or more candidates target the same surface — a dedupe/comparison aid for `e-organize`. List the member `CAND-XXX` ids; omit singletons. Do not merge here; this only points at overlap.

| Cluster | Candidates | Note |
| --- | --- | --- |

## Candidate Findings

Full blocks, grouped under `### <program> / <instruction>` headings — not by `class` (it is a free-text tag that fragments into one-per-group). Under each heading, list every block for that entrypoint. Prefix each block with its `CAND-XXX` id and a `Source agent:` line, then the canonical `FINDING` block.

Copy the canonical `FINDING` fields defined in `agents/common.md` (`## Output`) and keep each field terse; do not restate the field list here. Agent-specific optional fields are NOT carried into this file — they remain in the per-agent `fanout/<agent-file-id>.md`. Preserve malformed blocks verbatim with a `parse_warning:` line rather than dropping them.

## Notes

Failed agents, excluded agents, zero-finding agents (with a one-line negative result), malformed blocks and parse warnings, and cross-cutting context `e-organize` should weigh (e.g. resolved static-analysis leads, solvency framing).
