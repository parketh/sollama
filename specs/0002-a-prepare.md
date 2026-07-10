# Prepare Implementation Plan

> Use subagents to implement this plan task-by-task.

**Goal:** Build the `a-prepare` skill that collects audit inputs, validates the target repo at a pinned commit, detects Solana/Rust project shape, establishes the audit run directory, installs target dependencies, and writes a validated `prepare-output.json`.

**Architecture:** `a-prepare` is an independently runnable skill. It uses agent reasoning for repo inspection and decision-making, plus a local Bun/TypeScript/Zod validator for the final JSON artifact. This spec also creates the minimal root tooling needed to run validator scripts across all later skills.

**Tech Stack:** Markdown skill files, Bun, TypeScript, Zod, Biome, Git, target-native Solana build/test tooling.

---

## Context

`0001` defines Sollama as skill-first, not CLI-first. Prepare is the first executable audit phase and the first phase that produces a strict JSON artifact.

Prepare is responsible for deciding whether the rest of the audit can proceed. It should block on:

- missing required inputs
- invalid target repo path
- pinned commit not available locally
- non-Solana or unsupported target
- missing required env vars that the build cannot run without
- target dependency install failure
- build failure
- invalid output `prepare-output.json`

Prepare should not block on:

- missing optional audit scope
- missing optional client-provided audit goals, concerns, or key questions
- missing tests
- failing tests

Failing tests are still important audit context and must be summarized, with a warning surfaced to the user.

## Files

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `skills/a-prepare/SKILL.md`
- Create: `skills/shared/scripts/validate.ts`
- Create: `skills/a-prepare/scripts/validate-prepare-output.ts`
- Create: `skills/a-prepare/templates/prepare-output.template.json`

Do not create the other workflow skills in this spec except for directories if needed by plugin discovery. Their implementation belongs to `0003`-`0008`.

## Artifact Contract

Prepare writes:

```text
<target-repo>/.sollama/audits/<audit-id>/prepare-output.json
```

If prepare blocks after the `auditId` and run directory exist (i.e. repo path and pinned commit both resolved), it still writes a schema-valid `prepare-output.json` with `status: "blocked"` and the blocker details in `summary.blockers`.

If the target repo cannot be resolved or the pinned commit is unavailable, no `auditId` can be formed and no run directory exists; write no target artifact and report the blocking condition directly to the user.

## Prepare Schemas

Use these Zod schema shapes in both the markdown docs and the validator. Prepare intentionally keeps scope/focus as user text; exact scope expansion happens in `b-inspect`.

```typescript
const Env = z
  .object({
    name: z.string().min(1),
    value: z.string().optional(),
    valueRef: z.string().optional(),
  })
  .refine((value) => !(value.value && value.valueRef), {
    message: "Env allows value or valueRef, not both",
  });

const Command = z.object({
  cwd: z.string().min(1),
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  error: z.string().optional(),
});

const PrepareInput = z.object({
  schemaVersion: z.literal("1.0"),
  auditId: z.string().min(1),
  repoPath: z.string().min(1),
  commitHash: z.string().min(7),
  auditScope: z.string(),
  auditFocus: z.string(),
});

const PrepareOutput = z.object({
  schemaVersion: z.literal("1.0"),
  step: z.literal("prepare"),
  status: z.enum(["ready", "blocked"]),
  inputs: PrepareInput,
  detected: z.object({
    isSolana: z.boolean(),
    languages: z.array(z.string()),
    frameworks: z.array(
      z.enum(["anchor", "native-solana", "pinocchio", "steel", "unknown-rust-solana"]),
    ),
    packageManagers: z.array(z.string()),
    env: z.object({
      required: z.array(Env),
      missing: z.array(Env),
    }),
  }),
  commands: z.object({
    install: z.array(Command),
    build: Command,
    tests: z.array(Command),
  }),
  summary: z.object({
    isSupported: z.boolean(),
    buildPassed: z.boolean(),
    testsPassed: z.boolean().nullable(),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
```

Use absolute paths for `inputs.repoPath` and command `cwd`. Do not include confidential env var values in `value`; use `valueRef` only when a non-confidential value is present in a file and the reference helps the auditor.

## Task 1: Add Root Validator Tooling

**Objective:** Create the minimal Bun/Biome/TypeScript project surface used by prepare and later skill validators.

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`

**Implementation notes:**

`package.json` should expose generic script names that can run formatting/linting, typechecking, and the current validators:

```json
{
  "name": "sollama",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "format": "biome check --write .",
    "format:check": "biome check .",
    "typecheck": "tsc --noEmit",
    "validate:prepare": "bun run skills/a-prepare/scripts/validate-prepare-output.ts"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/bun": "^1.0.0",
    "typescript": "^5.0.0"
  }
}
```

`tsconfig.json` should be strict and script-friendly:

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true,
    "types": ["bun"],
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  },
  "include": ["skills/**/*.ts"]
}
```

`biome.json` should format JSON, markdown, and TypeScript without forcing broad style churn:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "asNeeded"
    }
  },
  "files": {
    "ignoreUnknown": false
  }
}
```

**Validation:**

Run:

```bash
bun install
bun run format:check
bun run typecheck
```

Expected:

- `bun install` creates or updates `bun.lock`.
- `bun run format:check` passes after the files in this spec are implemented.
- `bun run typecheck` passes after the validator is implemented.

## Task 2: Add Plugin Manifest Skeletons

**Objective:** Make Sollama installable as both a Codex plugin and Claude Code plugin while keeping `skills/**` canonical.

**Files:**

- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`

**Implementation notes:**

Codex manifest draft:

```json
{
  "name": "sollama",
  "version": "0.1.0",
  "description": "Agentic AI smart contract auditor for Rust Solana programs.",
  "author": {
    "name": "Sollama"
  },
  "homepage": "https://github.com/sollama/sollama",
  "repository": "https://github.com/sollama/sollama",
  "license": "MIT",
  "keywords": ["solana", "security", "audit", "smart-contracts", "agentic"],
  "skills": "./skills/",
  "interface": {
    "displayName": "Sollama",
    "shortDescription": "Agentic smart contract auditor for Solana",
    "longDescription": "Sollama runs a skill-based audit workflow for Solana programs: prepare, inspect, analyze, organize, verify, and report.",
    "developerName": "Sollama",
    "category": "Engineering",
    "capabilities": ["Interactive", "Read", "Write"],
    "defaultPrompt": [
      "Audit this Solana program",
      "Prepare this repo for an audit",
      "Run agent fanout on this audit"
    ],
    "brandColor": "#111827",
    "screenshots": []
  }
}
```

Claude manifest draft:

```json
{
  "name": "sollama",
  "version": "0.1.0",
  "description": "Agentic AI smart contract auditor for Rust Solana programs.",
  "author": {
    "name": "Sollama"
  }
}
```

Implementation must verify current Codex and Claude Code manifest requirements before finalizing fields. Keep both manifests pointing at the canonical `skills/**` tree where the platform supports it; use symlinks only if the platform requires a plugin-local path shape that cannot directly reference the canonical folder.

**Validation:**

Run:

```bash
bunx --bun biome check .codex-plugin/plugin.json .claude-plugin/plugin.json
```

Expected: JSON parses and formats cleanly.

## Task 3: Create The Prepare Skill

**Objective:** Add a self-contained `SKILL.md` with the prepare workflow, schema contract, detection rules, and handoff requirements.

**Files:**

- Create: `skills/a-prepare/SKILL.md`

**Draft `SKILL.md`:**

````markdown
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
3. Confirm the pinned commit exists locally with `git cat-file -e <commit>^{commit}`.
4. Compute the `auditId` and create the run directory `<target-repo>/.sollama/audits/<auditId>/`. Record `auditId` in `inputs.auditId`.
5. Record enough context to explain the result, but do not modify the target's tracked working tree. Writing under `.sollama/` creates untracked files in the target repo; add `.sollama/` to the target's `.gitignore` (or `.git/info/exclude` if `.gitignore` is itself tracked and should not be edited) so audit artifacts never pollute the target's git status or get accidentally committed.
6. Detect whether the repository is a Rust Solana program.
7. Detect frameworks and tooling.
8. Preserve audit scope and focus as text inputs.
9. Identify required environment variables from docs, config, build scripts, and test errors.
10. Install project dependencies using the target repo’s package managers.
11. Run the build command appropriate for the detected framework.
12. Run available tests or record that tests are absent/skipped.
13. Write `prepare-output.json`.
14. Validate `prepare-output.json`.

## Scope And Focus

Prepare does not expand audit scope into exact files.

Record the user’s audit scope as a text prompt in `inputs.auditScope`.

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
- Do not overfit this workflow; use the repo’s conventions.
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

````

## Task 4: Implement Shared JSON Validation And Prepare Schema

**Objective:** Add one generic JSON/Zod validation runner and a prepare-specific schema wrapper.

**Files:**

- Create: `skills/shared/scripts/validate.ts`
- Create: `skills/a-prepare/scripts/validate-prepare-output.ts`
- Create: `skills/a-prepare/templates/prepare-output.template.json`

**Implementation notes:**

The shared validator should:

- accept a Zod schema and file path
- parse JSON from disk
- validate the parsed JSON
- print a concise success message on pass
- print all schema errors on failure
- exit `0` on pass and non-zero on failure

The prepare validator should contain the prepare schemas and call the shared validator. It should not contain bespoke readiness/error-message logic.

Draft shared validator:

```typescript
import { readFileSync } from "node:fs"
import type { ZodType } from "zod"

export function validateJsonFile<T>(
  schema: ZodType<T>,
  path: string | undefined,
  label: string,
): T {
  if (!path) {
    console.error(`Usage: bun run <validator> <${label}>`)
    process.exit(2)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    console.error(`Failed to read or parse ${label}: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    console.error(JSON.stringify(result.error.format(), null, 2))
    process.exit(1)
  }

  console.log(`${label} valid: ${path}`)
  return result.data
}
```

Draft prepare validator:

```typescript
import { z } from "zod"
import { validateJsonFile } from "../../shared/scripts/validate.ts"

const Env = z
  .object({
    name: z.string().min(1),
    value: z.string().optional(),
    valueRef: z.string().optional(),
  })
  .refine((value) => !(value.value && value.valueRef), {
    message: "Env allows value or valueRef, not both",
  })

const Command = z.object({
  cwd: z.string().min(1),
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  error: z.string().optional(),
})

const PrepareInput = z.object({
  schemaVersion: z.literal("1.0"),
  auditId: z.string().min(1),
  repoPath: z.string().min(1),
  commitHash: z.string().min(7),
  auditScope: z.string(),
  auditFocus: z.string(),
})

const PrepareOutput = z.object({
  schemaVersion: z.literal("1.0"),
  step: z.literal("prepare"),
  status: z.enum(["ready", "blocked"]),
  inputs: PrepareInput,
  detected: z.object({
    isSolana: z.boolean(),
    languages: z.array(z.string()),
    frameworks: z.array(
      z.enum(["anchor", "native-solana", "pinocchio", "steel", "unknown-rust-solana"]),
    ),
    packageManagers: z.array(z.string()),
    env: z.object({
      required: z.array(Env),
      missing: z.array(Env),
    }),
  }),
  commands: z.object({
    install: z.array(Command),
    build: Command,
    tests: z.array(Command),
  }),
  summary: z.object({
    isSupported: z.boolean(),
    buildPassed: z.boolean(),
    testsPassed: z.boolean().nullable(),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
})

validateJsonFile(PrepareOutput, process.argv[2], "prepare-output.json")
```

`prepare-output.template.json` should be a passing minimal example with plausible placeholder values. It documents the output shape for both ready and blocked runs; blocked runs use the same schema with `status: "blocked"` and non-empty `summary.blockers`.

**Validation:**

Run:

```bash
bun run skills/a-prepare/scripts/validate-prepare-output.ts skills/a-prepare/templates/prepare-output.template.json
```

Expected: passes.

Then intentionally remove a required field from a copy of the template and verify the command exits non-zero with a useful error.

## Final Verification

After all tasks in this spec are implemented, run:

```bash
bun install
bun run format:check
bun run typecheck
bun run skills/a-prepare/scripts/validate-prepare-output.ts skills/a-prepare/templates/prepare-output.template.json
```

Expected:

- dependencies install successfully
- Biome check passes for repository formatting/linting
- TypeScript typecheck passes
- `prepare-output.template.json` passes schema validation

Manual verification:

- Run `a-prepare` on an Anchor target repo at a pinned commit.
- Run `a-prepare` on a native/Pinocchio/Steel-style Rust Solana repo if available.
- Confirm build failure produces a blocked state and does not proceed to inspect.
- Confirm test failure is summarized but does not block when build passes.

## Risks

- Some Solana repos use custom build scripts. Prepare should prefer documented project commands when they are clear.
- Env var detection is inherently heuristic. Missing env vars discovered from failed builds/tests should be recorded without printing values.
- Framework detection should allow multiple frameworks in monorepos.
- `anchor test` can start validators and be slow or flaky. Test failure is non-blocking, but the command and failure mode must be captured.
- Plugin manifest fields should be verified against current platform docs during implementation; this spec gives initial drafts, not a guarantee of current external schema.
