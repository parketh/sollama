---
name: a-prepare
description: (Step 1/7) Prepare a Rust Solana repository for a Sollama audit by collecting inputs, checking the pinned commit, detecting framework/tooling/env, installing dependencies, running build/tests, and writing validated prepare-output.json.
---

# Prepare

Use this skill as Step 1 of a Sollama audit.

Prepare establishes whether the target repository is audit-ready. It must produce a valid `prepare-output.json` before downstream skills run.

## Inputs

Collect required inputs from the invocation prompt when present. If inputs are missing, ask the user for them. Required inputs must be provided before the skill can run, whereas optional inputs can be skipped by the user:

- target repository path (required)
- pinned commit (required)
- audit scope (optional)
- client goals, areas of concern, and key questions (optional)

Store skipped optional inputs as empty strings.

## Audit ID

Prepare owns audit-id generation. Compute it once, create `<target-repo>/.sollama/audits/<auditId>/`, and record it in `inputs.auditId`. Downstream skills resolve the audit directory from the `prepare-output.json` path they are given and never regenerate the id.

Recipe: `<repo-name>-<commitHash[:7]>-<YYYYMMDD-HHMMSS>`, e.g. `jupiter-swap-a1b2c3d-20260710-161300`. Slugify the repo name to a filesystem-safe token. The timestamp makes repeated runs at the same commit distinct.

## Procedure

1. Resolve the target repository path to an absolute path.
2. Confirm it is a local Git repository. Remote git repos are not supported.
3. Confirm the pinned commit exists locally with `git cat-file -e <commit>^{commit}`, then confirm it is checked out: `git rev-parse HEAD` must equal the pinned commit and `git status --porcelain` must be empty. If HEAD differs or the working tree is dirty, block — write a schema-valid `prepare-output.json` with `status: "blocked"` and the mismatch in `summary.blockers`. Do not check out the commit or discard changes yourself; the operator must set the correct checkout.
4. Compute the `auditId` and create the run directory `<target-repo>/.sollama/audits/<auditId>/`. Record `auditId` in `inputs.auditId`.
5. Record enough context to explain the result, but do not modify the target's tracked working tree. Writing under `.sollama/` creates untracked files in the target repo; add `.sollama/` to the target's `.gitignore` (or `.git/info/exclude` if `.gitignore` is itself tracked and should not be edited) so audit artifacts never pollute the target's git status or get accidentally committed.
6. Detect whether the repository is a Rust Solana program.
7. Detect frameworks and tooling.
8. Preserve audit scope and focus as text inputs.
9. Identify required environment variables from docs, config, build scripts, and test errors.
10. Install project dependencies using the target repo's package managers.
11. Run the build command appropriate for the detected framework.
12. Run available tests or record that tests are absent/skipped.
13. Write `prepare-output.json`.
14. Validate `prepare-output.json`.

## Scope And Focus

Prepare does not expand audit scope into exact files.

Record the user's audit scope as a text prompt in `inputs.auditScope`.

Record audit goals, areas of concern, and key questions as a text prompt in `inputs.auditFocus`.

## Detection Rules

Solana/Rust indicators:

- `Cargo.toml` exists.
- Rust source contains `solana_program`, `solana_sdk`, `anchor_lang`, `pinocchio`, `steel`, or known Solana entrypoint/account macros.
- `Anchor.toml` strongly indicates Anchor.
- `programs/*/Cargo.toml` plus Solana dependencies indicates deployable program crates.

Framework indicators:

- Anchor: `Anchor.toml`, `anchor_lang`, `#[program]`, `#[derive(Accounts)]`.
- Native Solana: `solana_program::entrypoint!`, direct `process_instruction`.
- Pinocchio: `pinocchio` crate usage.
- Steel: `steel` crate usage.
- Unknown Rust Solana: Solana dependencies are present, but no known framework pattern dominates.

Package manager indicators:

- bun/npm/yarn/pnpm only for client/test harness context.
- Cargo is always relevant for Rust program build/test.
- Anchor CLI is relevant when `Anchor.toml` exists.

Dependency install policy:

- Before build/test, install dependencies needed by the target repo.
- Infer the right commands from lockfiles, manifests, toolchain files, and project docs.
- Record each dependency command in `commands.install`.
- Do not overfit this workflow; use the repo's conventions.
- This install policy applies to target project dependencies, not external audit tools.
- External audit tools still require explicit user permission before installation.

Build command preference:

1. If the repo documents a project-specific build command, prefer that command.
2. Else if Anchor project, use `anchor build`.
3. Else if Steel project and `steel` CLI is available, use `steel build`.
4. Else if Pinocchio project with a `bpf-entrypoint` feature, use `cargo build-sbf --features bpf-entrypoint`.
5. Else if native Solana, Pinocchio, unknown Rust Solana, or Steel without a usable Steel CLI, use `cargo build-sbf`.

Do not use plain `cargo build` as the default build-readiness command for on-chain programs. It can compile host Rust code without producing deployable SBF artifacts.

Test command preference:

1. If the repo documents a project-specific test command, prefer that command.
2. Else if Anchor project and tests exist, use `anchor test`.
3. Else if Steel project and `steel` CLI is available, use `steel test`.
4. Else if package scripts exist for the detected client/test harness, use the package-manager test command (`bun test`, `npm test`, `yarn test`, or `pnpm test`) matching the lockfile/package manager.
5. Else if Cargo tests exist in the program/workspace, use `cargo test --workspace` for a workspace or `cargo test` for a single crate.
6. Else record tests as skipped.

Use documented project commands from README or repo docs when they clearly override defaults.

Command source notes:

- Anchor docs use `anchor build`; `anchor test` builds, deploys to localnet, runs tests, and stops the validator.
- Solana native Rust docs use `cargo build-sbf` for deployable program artifacts and `cargo test -- --no-capture` in the basic LiteSVM example.
- Pinocchio docs use `cargo build-sbf --features bpf-entrypoint` when the program gates the entrypoint behind that feature; Pinocchio examples may use plain `cargo build-sbf` when no such feature gate is present.
- Steel docs use `steel build` and `steel test`.

Required env detection:

- Read `.env.example`, docs, build scripts, and failing command output.
- Do not read or print secret values.
- Record env var names in `detected.env.required`.
- Record missing env vars in `detected.env.missing`.
- Use `value` only for non-confidential env vars.
- Use `valueRef` when a confidential value is present in a file. Confidential env vars should be added to `.env` and referenced here.

## Schema

Use `PrepareInput` and `PrepareOutput` from this spec. If prepare blocks after the target repo path is known, still write a schema-valid `prepare-output.json` with `status: "blocked"` and blocker details in `summary.blockers`.

## Output

Write `prepare-output.json` to:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
```

Validate it with:

```bash
bun run skills/a-prepare/scripts/validate-prepare-output.ts <path-to-prepare-output.json>
```

If validation fails, fix the JSON and re-run validation until it passes or the step is blocked.

## Handoff

Finish by reporting:

- path to `prepare-output.json`
- validation command and result
- dependency install command results
- build command and result
- test command/result summary
- blockers or warnings
- next step: `b-inspect` when ready

Do not claim readiness unless:

- target repo exists
- pinned commit exists
- Solana/Rust support is confirmed
- target dependency install succeeded
- build passed
- `prepare-output.json` validates
- no blockers remain

Dependency install failure and build failure block the audit. Test failure does not block the audit, but it must be recorded in `summary.warnings`.
