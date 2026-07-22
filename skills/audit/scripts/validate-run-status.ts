import { validateJsonFile } from "../../../scripts/shared/validate.ts"
import { RunStatus } from "./run-status-schema.ts"

validateJsonFile(RunStatus, process.argv[2], "run-status.json")
