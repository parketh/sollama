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
    console.error(
      `Failed to read or parse ${label}: ${error instanceof Error ? error.message : error}`,
    )
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
