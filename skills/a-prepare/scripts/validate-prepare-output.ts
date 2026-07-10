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
