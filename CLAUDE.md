# ANASAQ: Claude execution entry

Read `AGENTS.md` and `PLANS/README.md`. The session kickoff is `PLANS/KICKOFF.md`.

## Authority and scope

- `PLANS/` is the plan of record. Every decision in `PLANS/DECISIONS.md` is settled (D02
  superseded by D29, D30 by D41); do not reopen them.
- D24 as amended by D28, D41 and D43: the orchestrator (Opus 5.5, 1M) plans, audits, fixes
  and does all major design work itself. Every sub-agent runs Claude Sonnet 5.5
  (`claude-sonnet-5-5`, effort xhigh): `sonnet-worker` does long, well-specified work,
  `auditor` gives a pre-audit. D43: acceptance needs the orchestrator's own audit of
  the whole diff; Sonnet never gives the deciding audit of Sonnet work. `.claude/settings.json` forces the model for every
  sub-agent, built-in ones included. No GLM. Definitions are in `.claude/agents/`.
  D29: a custom Supabase admin replaces Payload. D32: a static export on Cloudflare
  Pages, server work in Supabase Edge Functions.
- D25: the canonical domain is `anas.studio`; the folder name is historical.
- Follow "Next work" in `PLANS/EXECUTION-STATUS.md`, one package at a time, and stop with evidence.
- Preserve the accepted design (D39: direction B «أنساق», `DESIGN.md`; `deploy/design/`
  is frozen v1 history). Before UI work, read `PLANS/DESIGN-AUDIT.md`;
  recheck every applicable item and exercise every changed control before handoff.
- Preparation, account existence, and passing structural checks do not close
  runtime, payment, rights, launch, training, or support gates.

## Execution contract

- The orchestrator may edit product code for audit fixes and design work (D28). It
  holds the lock while it writes; never at the same time as a worker.
- Exactly one writer holds `.anasaq-execution.lock`, created exclusively with
  `fs.openSync(path, 'wx')`. Enumerate exact paths before writing.
- Keep the lock through integration and independent audit. A writer never
  spawns another writer, self-accepts, or starts the next package.
- An existing lock blocks dispatch. Prove its owner stopped, inspect the diff,
  record recovery, then release it. Time alone never makes a lock safe to remove.
- Fix small audit findings directly; send large ones to a fresh bounded worker.
  Preserve unrelated user edits.
- Never inspect `_archive/`, edit `deploy/design/`, or read/print `.env` contents.
  Secrets are consumed through environment variables only, never logged or copied
  into code, prompts, commits, evidence, or product output.
- No invented prices, successful payments, approvals, or E-gate closure. No paid
  provisioning, live charges, or deployment authority is implied by the plan.

## Token budget (I24)

- A fresh worker for each task or fix round, with a short brief listing exact files.
  Never resume one worker across rounds: its whole context is re-sent on every call.
- No polling: no sleep, until, tail or wc loops, by any agent. Run long commands once,
  with a timeout, or in the background with a single completion notification.
- UI work: `pnpm dev` with hot reload and one screenshot pass (360 and 1440). Build the
  static export and run the full visual suite only at acceptance.
- When a session gets long, document the state and continue in a new session.

## Working style and context

- Ponytail full: smallest working change; native platform and existing dependencies
  first. Never remove security, validation, accessibility, or required checks.
- Caveman full: terse conversation in the user's language; normal prose in files.
  Explain security, irreversible actions, and ambiguity without compression.
- Orient with `graft map`. Use Graft or CodeGraph for indexed code context, not
  redundant queries to both. CodeGraph MCP: `codegraph_explore`; CLI fallback:
  `codegraph explore`. Use `graft ask --source`, `skeleton`, or `callers` as needed.
- Read unindexed plans/configuration directly when needed. Graft refreshes
  itself before each query; refresh CodeGraph with `codegraph sync`; no paid/deep
  graph pass. Never let index results substitute for tests or broaden the task
  into archived/frozen source inspection.
- The orchestrator and its sub-agents use Claude subscription auth. Do not set
  `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` for any session (D41). Clear inherited
  overrides in the launch shell, not global settings. Never expose credentials while
  diagnosing auth.
