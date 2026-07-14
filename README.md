# sollama

**Sollama is an agentic smart contract auditor for Solana programs.** It ingests a target repository at a pinned commit, builds a mental model of the code, runs static analysis, fans out specialist agents to find candidate vulnerabilities, then reproduces exploitable findings in a sandbox to filter out false positives before writing a human-readable audit report.

Sollama supports both native Rust programs and programs written in common frameworks such as Anchor.

## Installation

Sollama ships as both a Claude Code and a Codex plugin. Clone the repo:

```
git clone https://github.com/parketh/sollama.git
cd sollama
```

Then, add the local marketplace and install:

```
# Claude Code
/plugin marketplace add <path/to/sollama>
/plugin install sollama@sollama

# Codex
codex plugin marketplace add <path/to/sollama>
codex plugin add sollama@sollama
```

## Usage

An audit runs as seven sequential steps, each as an independently invokable skill. Ask Claude or Codex to run them in order.

| Step | Skill | Output |
|------|-------|--------|
| 1. Prepare | `/sollama:a-prepare` | `prepare-output.json` |
| 2. Inspect | `/sollama:b-inspect` | `inspect-findings.md` |
| 3. Static analysis | `/sollama:c-static-analysis` | `static-analysis.md` |
| 4. Agent fanout | `/sollama:d-agent-fanout` | `candidate-findings.md` |
| 5. Organize | `/sollama:e-organize` | `organized-findings.{json,md}` |
| 6. Verify | `/sollama:f-verify` | `verification.json` + PoCs |
| 7. Report | `/sollama:g-report` | `report/report.md` |

Each step consumes the target repo and prior artifacts, and blocks with a clear resume action if a required input, tool, or build is missing. Artifacts are written into the **target repo**, not this one:

```
<target-repo>/.sollama/audits/<audit-id>/
```

Step 4 is the key step that generates candidate findings. It fans out 18 specialist agents in parallel, each applying a distinct lens (invariants, access control, economic security, etc).

## License

Sollama is [MIT licensed](LICENSE).

See also [ATTRIBUTION.md](ATTRIBUTION.md) for attribution for third-party code used or forked in this repo.
