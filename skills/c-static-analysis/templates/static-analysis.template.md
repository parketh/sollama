# Static Analysis

## Metadata

- Audit ID:
- Target repo:
- Pinned commit:
- Prepared from:
- Generated at:
- Status: ready | blocked

## Required Tools

| Tool | Required? | Source | Notes |
| --- | --- | --- | --- |
| Sec3 X-Ray | yes | default | |
| Sol-azy | yes | default | |

## Tool Status

| Tool | Installed/Runnable? | Version Command | Version/Result | Status |
| --- | --- | --- | --- | --- |

## Commands Run

| Tool | Command | CWD | Exit | Notes |
| --- | --- | --- | ---: | --- |

## X-Ray Results

Summarize Sec3 X-Ray output, generated `.xray` reports if present, and any warnings/failures.

| Class | Count | Code References | Triage | Rationale |
| --- | ---: | --- | --- | --- |

## Sol-azy Results

Summarize Sol-azy SAST output, including rule metadata, file matches, spans where available,
and the redirected output file path when stdout was captured with `> <output-file>`.

| Rule/Class | Count | Code References | Triage | Rationale |
| --- | ---: | --- | --- | --- |

## Triage Summary

Summarize only the highest-signal static-analysis output. Prefer a concise narrative plus a
small bullet list over full raw findings tables.

- highest-signal findings
- noisy classes
- classes overlapping with prior tool output
- findings that should guide fanout
- findings that appear benign or intentional
- tool limitations and blind spots
- blocked/missing tools and exact continuation options, if status is blocked
