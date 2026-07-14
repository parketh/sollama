import { readFileSync } from "node:fs"

type FileCount = {
  path: string
  loc: number
  nsloc: number
}

// Approximate LOC/nSLOC counter for Rust source. `loc` is total physical lines;
// `nsloc` excludes blank lines, `//` line comments, and `/* ... */` block
// comments. It does not parse strings, so `//` inside a string literal is
// treated as a comment. This approximation is sufficient for audit scoping.
function countLoc(text: string): { loc: number; nsloc: number } {
  if (text === "") {
    return { loc: 0, nsloc: 0 }
  }

  const rawLines = text.split("\n")
  const lines =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === "" ? rawLines.slice(0, -1) : rawLines

  let inBlock = false
  let nsloc = 0

  for (const line of lines) {
    let hasCode = false
    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i)
        if (end === -1) {
          i = line.length
        } else {
          inBlock = false
          i = end + 2
        }
        continue
      }

      const two = line.slice(i, i + 2)
      if (two === "//") {
        i = line.length
        continue
      }
      if (two === "/*") {
        inBlock = true
        i += 2
        continue
      }

      if (!/\s/.test(line.charAt(i))) {
        hasCode = true
      }
      i += 1
    }

    if (hasCode) {
      nsloc += 1
    }
  }

  return { loc: lines.length, nsloc }
}

function main(): void {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error("Usage: bun run skills/b-inspect/scripts/count-loc.ts <file...>")
    process.exit(2)
  }

  const files: FileCount[] = []
  const totals = { loc: 0, nsloc: 0 }

  for (const path of paths) {
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch (error) {
      console.error(`Failed to read ${path}: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }

    const { loc, nsloc } = countLoc(text)
    files.push({ path, loc, nsloc })
    totals.loc += loc
    totals.nsloc += nsloc
  }

  console.log(JSON.stringify({ files, totals }, null, 2))
}

main()
