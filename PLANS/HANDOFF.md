# Handoff

One current handoff. Earlier handoffs are in Git history; what was accepted, and how, is in `PLANS/EXECUTION-STATUS.md`.

## State (2026-10-01)

- **Repository.** `main` is the only branch, locally and on GitHub, and the single source of truth. It holds every accepted package through P07, DESIGN-B, P02, CLEANUP-1, AUDIT-1, AUDIT-2, FOUNDATION-1 (Foundation finished: the book page, home doors and contact page in the admin, the characters, the five films) and the owner's D41 to D45 decisions. The prompt that starts P08 is `PLANS/P08-KICKOFF.md`. No lock is held.
- **History was rewritten (D42).** The WhatsApp export is gone from every commit. Any clone made before 2026-09-30 must be re-cloned, not pulled, or the old history comes back. `../anas-studio-backup-2026-09-30/` (outside the repository) holds bundles of the old history and a copy of the folder, until the owner deletes it.
- **What is open.** `PLANS/ISSUES.md` (I24, I28, I32–I34, I40, I41, I43–I49); the latest audit record is `artifacts/acceptance/AUDIT-2/REPORT.md` (AUDIT-1's is beside it), and the latest package record `artifacts/acceptance/FOUNDATION-1/REPORT.md`.
- **graft.** Its session-start upkeep rewrites the agent configuration when its wiring stamp (`graft/.cache/wiring-stamp.json`) names another version than the running one. Upgrade the global CLI and the `.mcp.json` pin together, and keep the stamp's version equal to them (AUDIT-2, 4.12).

## Branches

Work on a short-lived `agent/<package>` branch cut from `main`. When the owner accepts the package, fast-forward it into `main`, push, and delete the branch, locally and on GitHub. Nothing else stays long-lived. Never push a branch that `main` does not contain.

## Local stack

- Every migration through `20260930140000_audit2_fixes.sql` is applied. The content is imported and the demo catalog seeded (`pnpm db:import`, `pnpm db:demo-catalog`; `DATABASE_URL` is `DB_URL` from `supabase status -o json`).
- If the functions answer 503, the edge runtime has exited: `docker start supabase_edge_runtime_ANASAQ.ME`. `pnpm test:db` needs it too (its staff-admin tests read `FUNCTIONS_URL`).
- If sign-in e2e tests fail with `fetch failed: other side closed`, Mailpit's forwarded port died after a Docker restart while the container still runs: `docker restart supabase_inbucket_ANASAQ.ME`.
- After a change to `supabase/config.toml` (the Auth hook lives there), restart with plain `supabase stop` then `supabase start`, never `--no-backup`.
- Test runs add staff every time; past about 1,000 staff rows the team screen (PostgREST `max_rows`) hides a new invite and `auth.spec` fails. Before an acceptance battery, check that every local row is test data, then `supabase db reset` followed by the two imports.
- Before a full e2e run, check free memory: at about 6 GB free it crashes; 10 GB or more is safe.

## How sessions run

- The orchestrator (Opus 5.5) plans, audits, fixes and designs. Workers are Sonnet 5.5 at effort max and auditors Opus 5.5 at effort xhigh (D45); Sonnet never audits Sonnet work (D43). The orchestrator rules on the audit findings, re-runs the checks and reads every money, security and migration diff itself before acceptance. Name the model and effort on every dispatch: in a workflow `{ agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' }` and `{ agentType: 'auditor', model: 'opus', effort: 'xhigh' }`; with the Agent tool `subagent_type: auditor, model: opus`. Do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` again: it would put the auditors back on Sonnet.
- Never `/compact` while a background Workflow runs: it never returns.
- One writer at a time under `.anasaq-execution.lock`. Use a fresh worker per round, no polling, and the dev server for UI work (I24).

## Next

1. **P08 under D38:**
   - Moyasar hosted invoices against a local emulator (`tests/support/moyasar-emulator.ts`);
   - the `payments` webhook with `secret_token` and an authoritative fetch;
   - `apply_verified_payment`;
   - receipts through the outbox;
   - the notify routes (D31);
   - refunds with owner step-up;
   - digital delivery;
   - preorder (moved from P07 by D42);
   - the checkout items AUDIT-2 left for it (I48).

   E02 stays open until the real sandbox.
2. **Owner and Anas inputs:**
   - I43: the privacy policy on the contact form, E08;
   - I45: Tabuk imagery, and whether the site shows a contact e-mail;
   - a rights field per scene (C05);
   - new built stages, shelf ideas and project figures (D40);
   - the paper edition's details (E03).
3. **P11, only when the owner authorizes hosting:** I28 (including the password hook), I32, I33, I40 and I41.

## Rules to keep

- **Secrets and frozen sources:** never read or print `.env`; never edit `deploy/design/` or a hash-pinned source (`PLANS/evidence/source-manifest.json`); never inspect `_archive/`.
- **Never invent:** prices, payments or E-gate closures.
- **Runs:** Playwright on `http://localhost:3000`, never `127.0.0.1`. After every e2e run, restore `next-env.d.ts`. Routine runs write screenshots under `test-results/`; `ACCEPTANCE_PACKAGE=<pkg>` files the report under `artifacts/acceptance/<pkg>/`.
- **Editing files with scripts:** a replacement containing `$` followed by a backtick, `'` or `&` is a `String.replace` pattern. Use the Edit tool or a replacer function. Backticks inside a double-quoted shell string are command substitution: write such text with the Edit or Write tool.
- **Escapes:** the command transport turns `\u` escapes into real characters, so write escapes with the Edit tool.
