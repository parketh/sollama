# AGENTS.md

Sollama is an agentic smart contract auditor for Solana smart contracts. Gather context from the code itself. This file only records preferences and pointers.

## Ways of working

- This repo is built around a set of agent skills. Deterministic steps are extracted into runnable scripts.
- Each phase of the audit is independently runnable.
- Deterministic artifacts over hidden agent memory. Each phase reads prior artifacts and writes its own into `<target-repo>/.sollama/audits/<audit-id>/`.
- JSON artifacts are strict: the owning skill writes them, then validates with its own Bun/Zod script under that skill's `scripts/`. Markdown artifacts are not schema-validated.
- Scripts are Bun + TypeScript. Zod for schemas.
- Spec-driven development: features should be described in a spec in `specs/` before implementation. Post-implementation updates should be reflected in the spec in a `## Post-Implementation Changes` section.

## Guardrails

- No automatic tool or dependency installation — ask, and provide the exact command.
- No live RPC or explorer queries.
- When editing a phase, keep its artifact contract in sync with `specs/`.

## Pointers

- `scripts/`: reusable scripts encoding deterministic runnable steps
- `skills/`: agent skills encoding audit workflow, installable to Claude Code / Codex via plugins
- `specs/`: numbered specs / build journals
- `README.md`: user-facing documentation
- `ATTRIBUTION.md`: attribution for third-party code used or forked in this repo