# RESIDUALS-1, round R3a: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, exercises the changed screens itself, and rules on
your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against `ddde58e`: `git diff ddde58e` (14 files: `src/admin/fields.ts`,
`src/admin/richtext.ts`, seven components under `src/components/admin/`, four unit test files and
`tests/e2e/cms.spec.ts`). Not yours: `.claude/launch.json` and `.claude/settings.json` (the owner's: never open them).
The writer's brief, with the orchestrator's decided fixes, is `artifacts/acceptance/RESIDUALS-1/brief-R3a.md` (10 items);
each item's evidence is its block, by id, in `artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md`. No SQL and no Edge
Function changed in this round.

## What to verify

1. **Each item against its decided fix and its evidence.** The writer's choices, to rule on:
   - item 2: both halves (`ignoreSelectionChange`, and `emptyRichTextAsDefault` in `fields.ts` with one shared
     `emptyRichText()` that `defaultForField` uses too); any other value comes back by reference. Can a real body be
     taken for an empty one, or an empty one still mark the form changed (a typed then deleted body, a heading emptied)?
   - item 4: `holdsText` asks before deleting an item with text at any depth; a fresh list item whose form has a select
     with a default value therefore asks too. Is that acceptable, and is any value counted that should not be (a
     number, a boolean, an image reference, a hidden flag)?
   - item 5: the reloading flag's life (set on a load after the first; cleared when it applies or fails; a superseded
     load leaves it to the newer one), `inert` and `aria-busy` on the fields, «حفظ» disabled, the status line. Can the
     flag stay set for good (a load that throws, an unmount, a load superseded by one that fails)? What happens to the
     focus and to text typed into a field that turns inert, and does the local-copy offer still work after a reload?
   - item 6: `readLiveSlug` reads `content_versions` at `live_seq` once per load, beside `getSession`; the note through a
     `note` prop on `FieldInput` (`aria-describedby`, `role="status"`); no note when the read fails.
   - item 7: `listState` ('loading', 'titles', 'failed', 'empty', 'table'); rows and local copies set together.
   - item 8: `hasUnsavedChanges` optional on `PublishBar`, the sentence after the link.
   - item 9: `standingFailures` keeps a failure with no seq and one whose document is not found (titled «بلا عنوان»);
     either read failing gives the existing error line.
   - item 10: `ATTENTION_CAP`, its note and `attentionCapped` live in `EmailView.tsx`, and `AdminHome.tsx` imports them.
2. **The editor's existing behaviour stays:** the autosave and its rule (`draftStorageAction`), the local-copy offer and
   its answers, the load tickets, the version history's remount, the publish bar's messages, the taxonomies read.
3. **Accessibility and layout (`PLANS/DESIGN-AUDIT.md`):** each new sentence is announced once and not on every render;
   `aria-describedby` points at a mounted element; nothing new overflows at 360 px in RTL; the confirm texts and every
   new Arabic string match the brief.
4. **The tests prove what they claim**, and the mutations the writer reports are real. `cms.spec.ts`'s new tests: would
   each fail without its fix?
5. **Docs:** known to the orchestrator, not to report: `docs/operations.md:80-86` (the failed-schedule line) and
   `:308-310` (the email screen's cap) describe the old behaviour.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no `docker` and no `supabase`
command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
