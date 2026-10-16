# RESIDUALS-1, round R4c: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, runs the e2e and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`). Not yours: `.claude/launch.json` and `.claude/settings.json` (the
owner's: never open them). The writer's brief, with the orchestrator's decided fixes, is
`artifacts/acceptance/RESIDUALS-1/brief-R4c.md` (11 items); each item's evidence is its block, by id, in
`artifacts/acceptance/FABLE-AUDIT/work/waveB/digest.md`. This round changes tests, the e2e configuration and
`scripts/check-budgets.mjs` only: no product code.

## What to verify

1. **Each test proves what its name claims**, can fail (the writer's mutations: are they real, and would a plausible
   regression slip past?), and is not flaky by construction (time, order, shared state, the outbox allowance).
2. **Each item against its decided fix and its evidence.** In particular:
   - item 1: no integration file can still reach another project's database; CI's runs (no edge runtime) still work;
   - item 2: what the files park is restored exactly, by id, including when a test fails midway;
   - items 3 and 5: the fixtures made in `beforeAll` are cleaned up; the branches now always taken; the privacy policy
     restored on every path;
   - item 6: the teardown touches only what the run created, never the owner's own local accounts, and uses the same
     retirement path as the integration harness;
   - item 7: the budget check still measures every public page it measured, and fails closed with a clear sentence;
   - item 10: the grants test reads the real privileges for the right role and the right write.
3. **Nothing in a test or a doc holds a secret or customer data**; the local database is left no dirtier than before.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and
reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
