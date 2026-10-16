# P12, round R1: the writer's brief (the data)

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package P12, round R1, base `c151949`, branch `agent/residuals-1`:
the shared checkout does not switch branches). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm
10.34.6, Supabase CLI 2.106.0, Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no
Deno.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), and above all `PLANS/P12-CONTRACT.md`
(version 2): its rules, sections 2 to 4 and section 8's R1 are this round. `PLANS/P08-CONTRACT.md`'s rules at its top show
how this repository writes server SQL (security definer, `search_path`, grants, lock order, 23505 for a stale version);
the latest migrations (`supabase/migrations/2026101*.sql`) show the current style. Where the contract and this brief
differ, the contract wins; where both are silent, stop and report.

## Write only these paths

- `supabase/migrations/20261016120000_p12_board_role.sql` (new): `alter type public.staff_role add value if not exists
  'board';` and nothing else.
- `supabase/migrations/20261016120100_p12_board.sql` (new): the schema `board` and its privileges, every table of the
  contract's section 3 with its constraints and indexes (the deferrable uniques, the partial unique done column), the
  helpers `board.caller()` and `board.access(uuid)`, every function of section 4 (reads and writes, with the reply
  shapes, the refusal transport, the lock order, versions, one activity row per write, the limits, `done_at`, the
  deletes, restores and the link rule with `board_link_targets`), and the four policies of section 2 recreated with the
  roles named (`drop policy if exists ...; create policy ...`, otherwise as they are today).
- `supabase/functions/staff-admin/index.ts` and `supabase/functions/_shared/staff.ts`: the role `board` known (the
  former's assignable roles, the latter's role set); nothing else changes in them.
- `tests/integration/support.ts` (a `board` role for the staff it makes), the new `tests/integration/board.test.ts` and
  `tests/integration/board-wall.test.ts`, `tests/integration/staff-admin.test.ts` and `tests/integration/staff.test.ts`
  (the role), `tests/unit/staff-admin-function.test.ts` (the role accepted, an unknown role still refused).
- `docs/development.md` (one line: the two new test files).

Any other path: stop and report.

## Never, and the rules

As `artifacts/acceptance/RESIDUALS-1/brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, with
these additions: the contract's rules bind every line; one forward migration each, idempotent where Postgres allows (the
enum's `if not exists`; `create ... if not exists`, `create or replace`, `drop ... if exists` before a changed
signature), and re-applied twice inside a transaction to prove it (a small `pg` script against `DB_URL` from `supabase
status -o json`, refusing a non-loopback host, never printing the URL); the function names, parameters and reply keys
are the contract's, exactly; display names come from the staff directory the admin already uses (find it; never an
email in a reply). If your run is cut short, your last message says what is built, what ran and what is left.

## What to build, in order

1. The role migration; apply it (`supabase migration up`, local).
2. The board migration: the schema and tables; the helpers; the reads; the writes; the four policies. Apply it.
3. `staff-admin` and `_shared/staff.ts`; then `docker restart supabase_edge_runtime_ANASAQ.ME`.
4. The tests (section 8's R1 list, each item): every function called as anon, an `editor`, an `operations`, a `board`
   person not on the project, a `viewer`, a `member` and an owner, with the answer the contract gives each (a table-driven
   test is fine); the wall (`board-wall.test.ts`): a `board` token reading no draft product, no variant row, no disabled
   shipping rate and no hidden post through the Data API, an `editor` and an `operations` reading what they read today,
   and `Accept-Profile: board` refused for anon and for staff; `STALE` on every versioned write; the races (two creates
   in one column in parallel transactions, two column creates at 11, a removal racing an assignment); one activity row
   per write, with its `fields`, and no title, note or checklist text anywhere in `board.activity`; every limit; `done_at`
   across moves, creates and restores into the done column and the done mark moving; a column delete with archived cards;
   archive, restore (a second restore a no-op) and delete of a project (its `public.audit_events` row); a viewer never
   receiving a draft's title; demotion clearing assignments; removal and deactivation taking access away at once, and
   reactivation bringing it back.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. the migrations applied, then each re-applied twice in a transaction (idempotence);
3. `pnpm test:db` (all files; `TEST_ENV=local`, `DATABASE_URL` from `supabase status -o json`, never printed), after the
   edge runtime's restart;
4. mutations, each reverted and checked identical after: a policy back to "any staff role" (the wall fails); a write
   without its version check (`STALE` fails); a viewer allowed to write (the role table fails); the activity row writing
   the title (the no-text test fails); the link rule letting a draft title through (its test fails).

No e2e and no build: R1 changes no screen.

The report: what you built (files, the function list with their signatures), every decision you took inside the
contract and why, every place you re-checked for the `board` role (the wall), the exact commands with exit codes and
counts, the mutations and what failed, anything not done and why, and the risks left. Do not accept your own work.
