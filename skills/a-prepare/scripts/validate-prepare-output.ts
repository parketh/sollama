import { PrepareOutput } from "../../../scripts/shared/prepare-output-schema.ts"
import { validateJsonFile } from "../../../scripts/shared/validate.ts"

validateJsonFile(PrepareOutput, process.argv[2], "prepare-output.json")
