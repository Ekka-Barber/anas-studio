# RESIDUALS-1, round R4b: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, runs the e2e and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`: `src/app/global-error.tsx`, `scripts/lib/restore-objects.mjs`,
`tests/unit/restore-objects.test.ts`). Not yours: `.claude/launch.json` and `.claude/settings.json` (the owner's: never
open them). The writer's brief, with the orchestrator's decided fixes, is
`artifacts/acceptance/RESIDUALS-1/brief-R4b.md` (12 items); each item's evidence is its block, by id, in
`artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md` and `work/waveB/digest.md`.

## What to verify

1. **Each item against its decided fix and its evidence**, and the writer's choices inside the brief. In particular:
   - item 1: `global-error.tsx` renders a complete document (its own `html` and `body`), loads the site's styles,
     works when the root layout itself failed, and its home link needs no client router; `(public)/error.tsx`'s
     `retry`;
   - item 2: the channel condition is exactly the page's own; every state of DESIGN.md section 8 says something true;
   - item 3: the films render once, under the right movement, for every combination of flags, hidden movements and
     movements with no text block; the publish rule and the renderer agree on "visible";
   - item 4: no path of `draw` touches the canvas, the layer or `drawn` after it was superseded; `clear` and `cancel`
     leave the surface drawable again;
   - item 8: the `outbox.ts` change keeps every reply and render the same for the rows the Data API sends;
   - item 10: the new checks cannot false-alarm on the published preview (decoded font and content streams), and
     `--verify` writes nothing;
   - item 11: a version-1 backup still opens exactly as before (raw passphrase); a version-2 one opens with any
     canonically equivalent passphrase; the reader's refusals leave nothing behind; the hand-built archives use the
     format's own header and AAD;
   - item 12: every object path of the rehearsal still fails closed (no silent `{}`, no default type), and the moved
     decision is the same decision.
2. **Security and data:** the backup format change (a passphrase never reaches a file, a command line or a log); the
   preview never rewritten; no secret or customer data in tests or docs.
3. **The public pages:** RTL, Latin digits, calm (no new motion), focus and announcements as the pages' existing ones;
   the budget.
4. **The tests prove what they claim**, the mutations the writer reports are real, and the docs claim nothing beyond
   what is built.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`python`, no `docker` and no `supabase` command: the orchestrator runs every check. `git diff`, `git show`, `git log`,
`grep` and reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
