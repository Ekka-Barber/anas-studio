# ANASAQ: Claude execution entry

Read `AGENTS.md` and `PLANS/README.md`. The only execution kickoff is
`PLANS/FIRST-GLM-PROMPT.md`; its historical filename does not select a model.
Read `PLANS/PREFLIGHT.md` and `PLANS/SKILLS.md` before that kickoff.

## Authority and scope

- `PLANS/` is the plan of record. D01-D25 are settled; do not reopen them.
- D24: Fable orchestrates and audits; `opus-worker` and `opus-worker-lite`
  implement on Claude subscription auth. Definitions are in `.claude/agents/`.
- D25: the canonical domain is `anas.studio`; the folder name is historical.
- Start P00 only and stop with evidence. P00 acceptance gates dependent work.
- Preserve the frozen design. Before UI work, read `PLANS/DESIGN-AUDIT.md`;
  recheck every applicable item and exercise every changed control before handoff.
- Preparation, account existence, and passing structural checks do not close
  runtime, payment, rights, launch, training, or support gates.

## Execution contract

- The orchestrator never edits product code. It directly writes only the lock,
  `PLANS/EXECUTION-STATUS.md`, and `PLANS/ISSUES.md` during execution.
- Exactly one writer holds `.anasaq-execution.lock`, created exclusively with
  `fs.openSync(path, 'wx')`. Enumerate exact paths before writing.
- Keep the lock through integration and independent audit. A writer never
  spawns another writer, self-accepts, or starts the next package.
- An existing lock blocks dispatch. Prove its owner stopped, inspect the diff,
  record recovery, then release it. Time alone never makes a lock safe to remove.
- Return audit fixes to a bounded worker task. Preserve unrelated user edits.
- Never inspect `_archive/`, edit `deploy/design/`, or read/print `.env` contents.
  Secrets are consumed through environment variables only, never logged or copied
  into code, prompts, commits, evidence, or product output.
- No invented prices, successful payments, approvals, or E-gate closure. No paid
  provisioning, live charges, or deployment authority is implied by the plan.

## Working style and context

- Ponytail full: smallest working change; native platform and existing dependencies
  first. Never remove security, validation, accessibility, or required checks.
- Caveman full: terse conversation in the user's language; normal prose in files.
  Explain security, irreversible actions, and ambiguity without compression.
- Orient with `graft map`. Use Graft or CodeGraph for indexed code context, not
  redundant queries to both. CodeGraph MCP: `codegraph_explore`; CLI fallback:
  `codegraph explore`. Use `graft ask --source`, `skeleton`, or `callers` as needed.
- Read unindexed plans/configuration directly when needed. Refresh with `graft
  build` and `codegraph sync`; no paid/deep graph pass. Never let index results
  substitute for tests or broaden the task into archived/frozen source inspection.
- Use Claude subscription auth. Do not set `ANTHROPIC_BASE_URL` or
  `ANTHROPIC_AUTH_TOKEN` for this project. Clear inherited overrides in the launch
  shell, not global settings. Never expose credentials while diagnosing auth.
