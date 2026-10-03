# Handoff

One current handoff. Earlier handoffs are in Git history; what was accepted, and how, is in `PLANS/EXECUTION-STATUS.md`.

## State (2026-10-03)

- **Repository.** `main` is the only long-lived branch, locally and on GitHub, and the single source of truth. It holds every accepted package through P07, DESIGN-B, P02, CLEANUP-1, AUDIT-1, AUDIT-2, FOUNDATION-1, the owner's D41 to D47 decisions, SOON-1 (`0b915c5`) and P08 rounds 0 to 10a. P08 itself is not finished: it is built on the short-lived `agent/p08`, fast-forwarded into `main` one accepted round at a time.
- **P08 stopped after round 10a (2026-10-03) on the owner's word, to continue in a new session.** No lock is held: the session released `.anasaq-execution.lock` after the last commit, so the WhatsApp-assets session could write. The next P08 session takes the lock again.
  - The contract between the layers is `PLANS/P08-CONTRACT.md`: sections 6 and 7 list every SQL function and endpoint, section 10 the pages, section 12 the rounds. Each round's worker reports, Opus audits and the orchestrator's rulings are in `artifacts/acceptance/P08/rounds/round-NN.md`.
  - Accepted and pushed: rounds 0 and 1 (`f308c97`), 2 (`69b7940`), 3 (`538e716`), 4 (`b8fbf2f`), 4b (`bdc57a0`), 5 (`c04525f`), the sandbox evidence (`ced46d4`), 6 (`fef5119`), 7 (`217a74b`), 7b (`febd469`), 8 (`157d725`), 9 (`3dbe25a`), 10a (the order page and the notification link pages).
  - Left: 10b (the product page's availability and preorder states, the sign-up form, the preorder notes and the held wording in the cart and checkout, the hold view loaded on demand so `checkout.html` stays under 150 KiB, and the invoice link's expiry in `finance.payment_view`); 11 (the admin screens, with the read-only list of availability sign-ups moved from round 8 and the statistics screen's commerce figures); 12 (`tests/e2e/orders.spec.ts` and the documents: the runbook with "When the Moyasar keys arrive", `docs/operations.md`, `docs/privacy-data-map.md`, `docs/development.md`); then the auditor's checkpoint (c), the acceptance battery from a fresh reset, and the plan documents.
  - Kept for the close: the uncovered cases listed at the end of each round file (checkpoint (c)); one real `pnpm backup --local` and `pnpm restore-check` with a paid file; the hosted checks to add to I32 (the CORS answer of `orders` and `download`, Range and `nosniff` on the file reply, the `_headers` rules of `/orders` and `/notify/*`).
  - Moyasar: Anas's test keys are in the git-ignored `.env` (2026-10-02). The owner approved one read-only sandbox pass, which is done (`artifacts/acceptance/P08/moyasar-sandbox-2026-10-02.md`); nothing else calls Moyasar, everything is proven against the local emulator (D38), and E02 and E03 stay open.
- **How to continue P08.** Read `PLANS/P08-KICKOFF.md` (the roles and the run rules; its note says what changed since it was written), `PLANS/P08-CONTRACT.md` and `artifacts/acceptance/P08/rounds/round-10a.md`. The round tooling is in `artifacts/acceptance/P08/tools/` (its README): `p08-round.js` (the workflow), `round-report.cjs` (the round file) and `round-10b.json`, the next round's brief, ready to pass as the workflow's `args`. Take the lock (`fs.openSync('.anasaq-execution.lock', 'wx')`, package P08, branch `agent/p08`, the round's exact paths), reset the local database with the imports, check free memory before any e2e run, then launch round 10b.
- **anas.studio shows the soon page (D46, D47).** The Worker `anas-studio-soon` in Anas's Cloudflare account serves `artifacts/soon/`: three soon designs at random, and three maintenance designs that answer 503. The state is the Worker variable `MODE`, switched with `artifacts/soon/deploy.cjs --mode=` (README there). No other deploy is authorized. The owner's switch in the admin is SITE-STATE-1 (`PLANS/SITE-STATE-CONTRACT.md`), the first product work after P08 releases the lock; it edits `_shared/admin.ts`, so never beside a P08 worker.
- **History was rewritten (D42).** The WhatsApp export is gone from every commit. Any clone made before 2026-09-30 must be re-cloned, not pulled, or the old history comes back. `../anas-studio-backup-2026-09-30/` (outside the repository) holds bundles of the old history and a copy of the folder, until the owner deletes it.
- **What is open.** `PLANS/ISSUES.md` (I24, I28, I32–I34, I40, I41, I43–I49); the latest audit record is `artifacts/acceptance/AUDIT-2/REPORT.md` (AUDIT-1's is beside it), and the latest package record `artifacts/acceptance/FOUNDATION-1/REPORT.md`.
- **graft.** Its session-start upkeep rewrites the agent configuration when its wiring stamp (`graft/.cache/wiring-stamp.json`) names another version than the running one. Upgrade the global CLI and the `.mcp.json` pin together, and keep the stamp's version equal to them (AUDIT-2, 4.12).

## Branches

Work on a short-lived `agent/<package>` branch cut from `main`. Fast-forward each accepted piece into `main` and push; when the owner accepts the package, delete the branch, locally and on GitHub. Nothing else stays long-lived. Never push a branch that `main` does not contain. Another session that commits while a package holds the lock commits through the lock holder (SOON-1's `0b915c5` was committed onto `agent/p08` while P08 held it; the orchestrator accepted it).

## Local stack

- Every migration through `20261002170000_stats_disputes.sql` (P08 round 9) is applied; round 10a added none. The checks of each round ran from a fresh `supabase db reset` followed by `pnpm db:import` and `pnpm db:demo-catalog` (`DATABASE_URL` is `DB_URL` from `supabase status -o json`).
- The local edge runtime does not reload `_shared` on its own: after an edit under `supabase/functions`, `docker restart supabase_edge_runtime_ANASAQ.ME` before any test that calls a function over HTTP. If the functions answer 503, it has exited: `docker start supabase_edge_runtime_ANASAQ.ME`. `pnpm test:db` needs it too.
- E2E suites that reach checkout start the local Moyasar emulator themselves (port 54390, `pnpm emulator`); it is a test harness, never Moyasar.
- If sign-in e2e tests fail with `fetch failed: other side closed`, Mailpit's forwarded port died after a Docker restart while the container still runs: `docker restart supabase_inbucket_ANASAQ.ME`.
- After a change to `supabase/config.toml` (the Auth hook lives there), restart with plain `supabase stop` then `supabase start`, never `--no-backup`.
- Test runs add staff and orders every time; past about 1,000 staff rows the team screen (PostgREST `max_rows`) hides a new invite and `auth.spec` fails. Before an acceptance battery, check that every local row is test data, then `supabase db reset` followed by the two imports.
- Before a full e2e run, check free memory: at about 6 GB free it crashes; 10 GB or more is safe. After an e2e run, restore `next-env.d.ts` and remove `.next/e2e` if `pnpm typecheck` then fails on truncated generated types (TS1128).

## How sessions run

- The orchestrator (Opus 5.5) plans, audits, fixes and designs. Workers are Sonnet 5.5 at effort max and auditors Opus 5.5 at effort xhigh (D45); Sonnet never audits Sonnet work (D43). The orchestrator rules on the audit findings, re-runs the checks and reads every money, security and migration diff itself before acceptance. Name the model and effort on every dispatch: in a workflow `{ agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' }` and `{ agentType: 'auditor', model: 'opus', effort: 'xhigh' }`; with the Agent tool `subagent_type: auditor, model: opus`. Do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` again: it would put the auditors back on Sonnet.
- Never `/compact` while a background Workflow runs: it never returns.
- One writer at a time under `.anasaq-execution.lock`. Use a fresh worker per round, no polling, and the dev server for UI work (I24).
- A session's scratchpad is its own (its path holds the session id): anything a later session needs goes into the repository.

## Next

The ordered list is "Next work" in `PLANS/EXECUTION-STATUS.md`. In short: P08 round 10b, 11, 12, checkpoint (c), the acceptance battery and the plan documents; then SITE-STATE-1 (with the name-band change if Anas wants only «أنس القرني»); P09; P10; P11 when the owner authorizes hosting. Owner and Anas inputs come in whenever they arrive (I43, I45, C05, D40, E03, the X link, the maintenance words, the zone's "Always Use HTTPS").

## Rules to keep

- **Secrets and frozen sources:** never read or print `.env` (the repository's or `supabase/functions/.env`); never edit `deploy/design/` or a hash-pinned source (`PLANS/evidence/source-manifest.json`); never inspect `_archive/`.
- **Never invent:** prices, payments or E-gate closures.
- **Runs:** Playwright on `http://localhost:3000`, never `127.0.0.1`. After every e2e run, restore `next-env.d.ts`. Routine runs write screenshots under `test-results/`; `ACCEPTANCE_PACKAGE=<pkg>` files the report under `artifacts/acceptance/<pkg>/`.
- **Editing files with scripts:** a replacement containing `$` followed by a backtick, `'` or `&` is a `String.replace` pattern. Use the Edit tool or a replacer function. Backticks inside a double-quoted shell string are command substitution, and a shell heredoc drops backslashes: write such text with the Edit or Write tool.
- **Escapes:** the command transport turns `\u` escapes into real characters, so write escapes with the Edit tool.
