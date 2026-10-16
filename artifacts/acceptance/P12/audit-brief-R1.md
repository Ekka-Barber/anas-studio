# P12, round R1: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, reads every SQL line itself, runs the checks and
rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`: the two migrations `supabase/migrations/20261016120000_p12_board_role.sql`
and `20261016120100_p12_board.sql`, and the new test files). Not yours: `.claude/launch.json` and `.claude/settings.json`
(the owner's: never open them). The specification is `PLANS/P12-CONTRACT.md` (version 2); the writer's brief is
`artifacts/acceptance/P12/brief-R1.md`; version 1's audit and its rulings (`contract-audit-1.md`, and the contract's last
section) say what the contract had to settle.

## What to verify

1. **The wall.** Every function, for every role (anon, `editor`, `operations`, a `board` person not on the project,
   `viewer`, `member`, owner, an inactive staff member), answers as the contract's section 2 says, and the code proves
   it, not only the tests. The four policies are recreated with named roles and nothing else in them changed (diff each
   against its previous definition). The schema `board` is unreachable from the Data API for every role. Nothing outside
   the board (a policy, a function, an Edge Function action, `staff-admin`, `_shared/staff.ts`) gives `board` more than
   the contract allows: list what you checked.
2. **Every function against section 4:** its name, parameters, reply keys and shapes, its refusals (the transport: the
   code in `message`, 23505 for `STALE`, the field in `detail`), its lock order, its version check and bump, its one
   activity row (no text in it), its limits, `done_at`, positions (dense, clamped, archived cards with none, the
   deferrable uniques), deletes and restores, the link rule (`board_link_targets` and the title a viewer may read: can a
   draft's title, or a hidden post's, reach anyone who may not see drafts?), demotion clearing assignments, deactivation
   and reactivation.
3. **The SQL's safety:** `security definer` with `set search_path = ''` and fully qualified names everywhere; revokes and
   grants; no dynamic SQL built from input; no function a client can call that skips `board.caller()`; the enum
   migration alone in its file.
4. **The tests prove what they claim**, the mutations the writer reports are real, and the races are real races (two
   connections, interleaved), not sequential calls.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact.
