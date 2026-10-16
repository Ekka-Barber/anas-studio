# P12, round R3: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, runs the checks and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`). Not yours: `.claude/launch.json` and `.claude/settings.json` (the
owner's: never open them). The specification is `PLANS/P12-CONTRACT.md` (sections 2, 4, 5 and 7, and section 8's R3);
the writer's brief is `artifacts/acceptance/P12/brief-R3.md`; the replies' truth is R1's SQL
(`supabase/migrations/20261016120100_p12_board.sql`); R2's record (`RECORD-R2.md`) says what this round builds on. The
screenshots, if the writer took them, are under `test-results/screenshots/P12/`: look at them.

## What to verify

1. **The activity's sentences.** Every action of section 7, word for word; a person row's role read from the row's
   `role` (history), never from the person's role today; a column row's column from `to`; a move within its column; a
   deleted column «عمود محذوف»; the fields in section 7's words joined with «و»; «الأقدم» asking for the rows before the
   last id shown, never skipping or repeating one; the log and the CSV for owners only, on the screen and in what the
   screen asks for.
2. **The numbers.** The list's sorts (due day earliest first and none last; priority urgent first, then due day) over
   exactly the cards the search and filters leave; the overview's sentences from `board_overview` and never a zero for a
   count that could not be read; the plural forms.
3. **The CSV.** UTF-8 with a BOM; every cell quoted; a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return
   prefixed with `'`; the columns in section 5's order; made in the browser and never stored or sent anywhere.
4. **The owner's controls.** Column options (hide and show, the done mark, move, delete with its two `NOT_EMPTY`
   sentences), labels, «الأشخاص والأدوار» (owners fixed; a member's role and removal; «إضافة شخص» from `board_staff`; the
   line to the Team screen), the project's rename, archive, restore and delete with the typed name; each write with the
   row's version where the function takes one, each refusal shown with section 7's sentence, and the screen read again
   after it. `/admin/projects/archived` for owners only; a member or a viewer meets no control they cannot use.
5. **The home and the Team screen.** «مواعيد المشاريع» for every role but `board`, linking to the card; the invite line,
   exactly.
6. **Reuse.** R2's parsers, wording, CSV builder, dialogs and styles reused, not copied or rewritten; no package added.
7. **Privacy, words and design**, as `audit-brief-R2.md`'s items 5 to 7: nothing of the board in the address bar (ids
   only), storage, the console or reports; every string from section 7; the comp's values, the DESIGN-AUDIT items for
   each control, the phone widths.
8. **The tests** prove what they claim, and the three mutations the brief names each really fail a named test.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact.
