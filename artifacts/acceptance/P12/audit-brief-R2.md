# P12, round R2: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, runs the checks and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`). Not yours: `.claude/launch.json` and `.claude/settings.json` (the
owner's: never open them). The specification is `PLANS/P12-CONTRACT.md` (version 2: sections 2, 5 and 7, and section 8's
R2); the writer's brief is `artifacts/acceptance/P12/brief-R2.md`; the API the screens call is R1's,
`supabase/migrations/20261016120100_p12_board.sql` (its JSON builders are the replies' truth); the approved look is
`artifacts/acceptance/P12/comp/index.html`. The screenshots, if the writer took them, are under
`test-results/screenshots/P12/`: look at them.

## What to verify

1. **The gate.** The role `board` sees only «المشاريع» and «الأمان» in the rail, lands on `/admin/projects/mine`, and
   every other admin path sends it there: prove it from `AdminShell.tsx` and `SignIn.tsx`, not only from the tests.
   `TableList.tsx`, `TableForm.tsx` and `StoreHome.tsx` are allow-lists now: no role outside the list reaches them, and
   `editor` is still refused wherever it was before.
2. **The parsers** (`src/lib/projects.ts`) against the SQL's replies: every key, type and null (`dueOn` a day, `doneAt` an
   ISO time with its offset, a link's `title` null, `role` the caller's); a malformed reply refused, never half-drawn. The
   refusal reader: the code in `message`, the field or limit in `detail`, `STALE` as 23505.
3. **Moving cards.** `MouseSensor` and `TouchSensor` (250 ms, 5 px), not the pointer sensor; the keyboard (Space lifts and
   drops, Escape cancels, Enter opens the card); on the right-to-left board the right arrow goes to the previous column;
   the Arabic `aria-roledescription`, instructions and announcements word for word from section 7. The position sent to
   `board_card_move` for a drop and for «نقل إلى…» lands the card where it was dropped, within one column and across
   columns (check the arithmetic against the SQL's clamp and renumbering). A refused move puts the card back, reads the
   project again, says so and leaves the focus on the card. «نقل إلى…» on every card at every width; a viewer has no move
   control and no «بطاقة جديدة».
4. **The card's dialog.** `<dialog>`, Escape closes, the focus returns to the card. «حفظ» sends only the changed keys
   (`dueOn` null versus absent; `checklist` the whole list with ids or null; `people` and `labels` as arrays). A `STALE`
   save keeps what was typed and shows the newer version; «احفظ نسختي» sends the same changes on the newer version;
   «اعتمد الأحدث» drops them. «أرشفة البطاقة» with «تراجع» and no timer; the focus after an archive and after a menu move
   (section 5's "States").
5. **Privacy.** No board text in the address bar (ids only), `localStorage`, `sessionStorage`, the console, analytics or
   error reporting; the routes sit under the admin's `robots` rule; no board text in `out/`.
6. **The words.** Every Arabic string against section 7, exactly. A string section 7 does not give is a finding unless
   the writer's report proposed it.
7. **The design.** The comp's values ported, the admin's classes reused; for every control, the items of
   `PLANS/DESIGN-AUDIT.md` that apply (44px targets, the admin's focus ring, logical properties only, no physical left or
   right, nothing animating under reduced motion, Latin digits); the phone's single column and switcher below 768px; the
   done column's night head and weave with no add button.
8. **The tests** prove what they claim, and the three mutations the brief names (the keyboard mapping flipped, the gate
   letting `board` into `/admin/store`, the CSV without its formula prefix) each really fail a named test.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact.
