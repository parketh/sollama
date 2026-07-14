import { isAbsolute } from "node:path"
import { z } from "zod"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

const AbsolutePath = z
  .string()
  .min(1)
  .refine(isAbsolute, { message: "must be an absolute path" })

const Env = z
  .strictObject({
    name: z.string().min(1),
    value: z.string().optional(),
    valueRef: z.string().optional(),
  })
  .refine((value) => !(value.value && value.valueRef), {
    message: "Env allows value or valueRef, not both",
  })

const Command = z.strictObject({
  cwd: AbsolutePath,
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  error: z.string().optional(),
})

const PrepareInput = z.strictObject({
  schemaVersion: z.literal("1.0"),
  auditId: z.string().min(1),
  repoPath: AbsolutePath,
  commitHash: z.string().min(7),
  auditScope: z.string(),
  auditFocus: z.string(),
})

const PrepareOutput = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    step: z.literal("prepare"),
    status: z.enum(["ready", "blocked"]),
    inputs: PrepareInput,
    detected: z.strictObject({
      isSolana: z.boolean(),
      languages: z.array(z.string()),
      frameworks: z.array(
        z.enum(["anchor", "native-solana", "pinocchio", "steel", "unknown-rust-solana"]),
      ),
      packageManagers: z.array(z.string()),
      env: z.strictObject({
        required: z.array(Env),
        missing: z.array(Env),
      }),
    }),
    commands: z.strictObject({
      install: z.array(Command),
      build: Command,
      tests: z.array(Command),
    }),
    summary: z.strictObject({
      isSupported: z.boolean(),
      buildPassed: z.boolean(),
      testsPassed: z.boolean().nullable(),
      blockers: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  })
  // Readiness invariants: `ready` must be a genuinely usable artifact; `blocked`
  // must explain why. Downstream status guards trust `status`.
  .superRefine((o, ctx) => {
    if (o.status === "ready") {
      if (!o.summary.isSupported)
        ctx.addIssue({ code: "custom", path: ["summary", "isSupported"], message: "ready requires isSupported" })
      if (!o.summary.buildPassed)
        ctx.addIssue({ code: "custom", path: ["summary", "buildPassed"], message: "ready requires buildPassed" })
      if (o.summary.testsPassed === false)
        ctx.addIssue({ code: "custom", path: ["summary", "testsPassed"], message: "ready requires tests to pass or be absent" })
      if (o.summary.blockers.length > 0)
        ctx.addIssue({ code: "custom", path: ["summary", "blockers"], message: "ready must have no blockers" })
    } else if (o.summary.blockers.length === 0) {
      ctx.addIssue({ code: "custom", path: ["summary", "blockers"], message: "blocked requires at least one blocker" })
    }
  })

validateJsonFile(PrepareOutput, process.argv[2], "prepare-output.json")
