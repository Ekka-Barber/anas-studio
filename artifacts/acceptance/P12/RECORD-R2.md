# P12, round R2: the record

Started under the owner's word of 2026-10-16 ("you build it , send workers with the plan"), once R1 was committed and
pushed (`d864f88`, `2d0ab5b`). Orchestrator Claude Opus 5.5 at effort max, on the owner's machine. The lock moved from R1
to R2 on 2026-10-16 (base `2d0ab5b`), with R2's 16 exact paths, `package.json` and `pnpm-lock.yaml` among them for the
install below. Two words of the owner while it ran: "KEEP IN MIND USING OPEN SOURCE OPEN PROJECTS FROM GITHUB IS BETTER
AND SAVER TME FROm BUILDING THIS FROM SCRACH !!", on which the writer was sent dnd-kit's own MIT example mid-run; and,
after he had another tool search GitHub's boards and it proposed Kaneo (MIT, a separate app with its own server, database
and login, in English), "Keep building our board inside the admin, starting from open-source parts like dnd-kit's
example." Then: "once create round-3 brief and round two done, Stop working on this project till I say continue". So this
round ends with R3's brief written and nothing started after it.

## Scope

The contract's section 8, R2: the routes, the shell's gate for `board`, the allow-lists of `TableList.tsx`,
`TableForm.tsx` and `StoreHome.tsx`, `SignIn.tsx` sending `board` to «مهامي», the projects, the board and the card's
dialog, moving cards (mouse, touch, keyboard, the menu), the phone's single column, and `src/lib/projects.ts`'s pure
parts with unit tests (`brief-R2.md`).

## The dependencies

Installed by the orchestrator before the writer started, exact (D19), from the npm registry: `@dnd-kit/core` 6.3.1,
`@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2, and with them `@dnd-kit/accessibility` 3.1.1; all MIT. Their peers:
`react` >= 16.8 for each (and `react-dom` >= 16.8 for the core); the sortable preset needs `@dnd-kit/core` ^6.3.0; their
only other dependency is `tslib` ^2. The project runs React 19.3.0. They load only on the admin's board routes.

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 87 minutes, 220 tool calls. New: `src/lib/projects.ts`;
`src/components/admin/projects/` (`ProjectsHome`, `ProjectView`, `Board`, `BoardCard`, `CardDialog`, `MoveMenu`,
`MyCards` and `projects.module.css`); the three routes under `src/app/(admin)/admin/(shell)/projects/`;
`tests/unit/projects.test.ts` (62 tests); `tests/e2e/projects.spec.ts` (R2's part, at 360 and 1440). Changed:
`AdminShell.tsx` («المشاريع» in the rail for every role; the gate `gateRedirect` with `boardMayVisit`, `BOARD_HOME`;
`STORE_ROLES`; `/admin/projects/view` wide), `SignIn.tsx` (`landingFor`: the board-only role lands on «مهامي»),
`TableList.tsx`, `TableForm.tsx` and `StoreHome.tsx` (allow-lists on `STORE_ROLES`; `StaffRole` and `ROLE_LABEL` gain
`board`), `tests/unit/admin-ops.test.ts` (9 tests), `docs/development.md` (one line).

The drag code starts from dnd-kit's `MultipleContainers` story and its keyboard coordinate getter
(`stories/2 - Presets/Sortable/`, read on 2026-10-16; MIT, "Copyright (c) 2021, Claudéric Demers"; the notice in
`Board.tsx`'s header): it kept the collision detection, the move over another column, the clone and its restore, and the
getter; it dropped the story's trash, handles, virtualisation and options; it added the reading-order arrows, the mouse
and touch sensors (250 ms, 5 px), the Arabic instructions and announcements, and `board_card_move` with the card's
version.

Its decisions, ruled below with the audit: (1) the card's face is the drag activator (`role=button`) and «نقل إلى…» its
sibling, so no control nests in another; (2) Enter calls `preventDefault`, or its keypress submits the dialog's form;
(3) the arrows pick candidates in reading order, never the lifted card, and Space scrolls the card into view before
lifting it; (4) `board_card_archive` answers a null position, so it has its own parser; (5) a write, a drag or a newer
reading drops the older readings, and the project is read again after every write and on focus; (6) with a filter on, a
drop's position counts the column's whole list, a column's count shows the cards drawn, and the late filters leave the
done column out; (7) a viewer's dialog is read-only, with no move, new card, save or archive; (8) empty checklist rows are
dropped, their inputs named «بند n»; (9) left to R3 and left out, not disabled: the list and overview buttons, «الأشخاص
والأدوار», the archived projects, the card's activity; (10) `ROLE_LABEL` gaining `board` gives the Team screen's role
selects «لوحة المشاريع فقط» now.

Its checks: lint, typecheck, copy (248 files), frozen 0; unit 72 files, 2,833 passed and 39 skipped; build, export (59
files; the three routes checked by hand in `out/`, no board text there), budgets 0 (the public pages unchanged:
`orders.html` 148.6 KiB, `cart.html` 147.2, `checkout.html` 142.4). Three mutations, each caught: the arrows' direction
flipped (3 tests), the gate letting `board` into `/admin/store` (1), the CSV without its formula prefix (1). The e2e did
not run under the runner (6.4 to 8.1 GB free, and 2,007 staff rows); it ran the spec's bodies and two scripts of its own
against the dev server instead (all flows, at both widths). Its scratch runs filled the cap of 50 open projects: it
deleted its projects through the board's functions and made its 136 scratch staff inactive.

## 2. The audit and the fixes

The orchestrator read the gate (`AdminShell.tsx`, `SignIn.tsx`) and the allow-lists itself, looked at the writer's
screenshots at 1440 and 360 against the comp, and ran the e2e spec alone under Playwright's runner with a fresh dev
server (8.0 GB free; the R4a practice): **12 of 12** at 360 and 1440 (1.7 minutes).

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R2.md`), 23 minutes, 71 tool calls: **audit_failed**, on two
major findings, thirteen minor and five nits, none blocking. It confirmed: the gate withholds the screen while it
redirects, and `board` lands on «مهامي»; `STORE_ROLES` is used in every store screen and `editor` is still refused; the
parsers match the SQL's builders key by key; the drop and menu arithmetic matches the SQL's clamp and renumbering (within
a column, across columns, with filters on); ids only in the address, nothing stored, no console output; `package.json`
and `pnpm-lock.yaml` hold only the three pins and the transitive `@dnd-kit/accessibility`; the MIT notice is complete and
verbatim; the kept dnd-kit code is right for this board (but m3); the three mutations each fail a named test; the
spec, as code, is sound. It agreed with all ten of the writer's decisions (with m12 and m13 beside two of them, and one
gap in decision 5) and ruled the writer's words fit, but the blank no-link option.

| Finding | Severity | Ruling | Done by the orchestrator |
|---|---|---|---|
| M1: after a stale archive the dialog moved its base to the newer version but kept the old form, so a «حفظ» on an untouched form sent the old values on the new version: someone else's change undone, silently | major | Accepted | the base never moves without the form: with nothing typed the dialog takes the newer version (its sentence now true) and the next press archives it; with something typed, both are shown as after a stale save |
| M2: «احفظ نسختي» sent the changes captured at the first press, dropping what was typed after; a checklist item the newer version had removed refused every press | major | Accepted | «احفظ نسختي» reads the form at the press against the card it was opened on, on the newer version (`saveMine`); `fitChanges` (`projects.ts`) sends an item the newer version no longer holds as a new one, and leaves out a label or a person the project no longer has (on every save: its box is gone, so it could not be unticked); unit tests, one mutation caught |
| m3: in the one-column layout a side arrow picked a card of a hidden column (an empty rect at the corner) | minor | Accepted | the keyboard getter skips a candidate whose rect is empty |
| m4: a write refused `NOT_FOUND` on a card or column that is gone said «لم يعد هذا المشروع متاحًا لك.» | minor | Accepted; section 7 amended: that sentence is a project reading's | `writeRefusalText` (`projects.ts`): the write's own failure for `NOT_FOUND` (and `STALE` outside the card's dialog), the refusal's own sentence otherwise; used by the dialog, the move, the composer, the rename and «تراجع»; a unit test |
| m5: a reading that no longer held the open card unmounted its dialog, with the typing | minor | Accepted | the dialog keeps the card as it was last read while it is open |
| m6: a stale column rename said the card's sentence | minor | Accepted | «تعذّر الحفظ؛ أعد المحاولة.» (`writeRefusalText`) |
| m7: the move button's name «نقل إلى… «<card>»» | minor | Accepted as fit | settled in section 7 |
| m8: the dialog's no-link option was blank | minor | Accepted | «غير مرتبطة» (section 7's own word) |
| m9: «كل المشاريع» was a 28px target | minor | Accepted | the admin's `.target` (44px) |
| m10: the phone's switcher and the menu's places cut the focus ring | minor | Accepted | 6px of padding in both scroll boxes |
| m11: the keyboard sensor scrolled smoothly under reduced motion | minor | Accepted | `scrollBehavior` follows the visitor's setting |
| m12: a viewer's whole form was a disabled fieldset, so long notes could not be scrolled by keyboard | minor | Accepted | a viewer's text fields are read-only (they take the focus); choices are disabled per group |
| m13: a card that cannot be lifted ignored Space; while a move ran its face said `aria-disabled` yet opened | minor | Accepted | such a card opens with Space as with Enter; `aria-disabled` dropped from the face |
| m14: «مهامي» and the projects page read once | minor | Accepted | both read again on focus, keeping what they show if that reading fails |
| m15: `/admin/preview` sits outside the shell, so `board` is not sent to «مهامي» there | minor | Accepted as a residual | no data reaches it: the preview reads drafts through RLS, which admits owners and editors, and shows «لا توجد مسودة متاحة لك.» (as for `operations` today); outside R2's paths |
| n16: «لا بطاقات.» showed when every column was hidden | nit | Accepted | only for a project with no column |
| n17: the story's `data: {type}` objects, read by nothing | nit | Accepted | removed |
| n18: the focus after an archive ignored the filters and an old position | nit | Accepted | the next card drawn now, by the board's own position |
| n19: a test case named "no list" built a list | nit | Accepted | renamed |
| n20: `aria-controls` named a panel that was not there | nit | Accepted | only while the filters are open |
| Decision 5's gap: a reading dropped during a drag that ended without a write | — | Accepted | the board reads again when a drag ends |
| The orchestrator's: on desktop the bordered «نقل إلى…» on every card weighed the board down (the comp drew none there; the contract keeps it at every width, the move that needs no drag) | — | — | a quiet underlined button on desktop (6.91:1 on the card), the comp's bordered one on a phone; the target stays 44px |
| The orchestrator's: the comp's «تُفلت البطاقة هنا» in the dashed place and its note under «مرتبطة بـ» were left out (not in section 7) | — | — | both settled in section 7 and drawn as the comp drew them |

Carried to R4 (the proof), from what no test covers: the dialog's stale paths (a stale save, «احفظ نسختي» with typing after
it, a stale archive); a refused move (STALE, network, NOT_FOUND, FORBIDDEN: the card back, the sentence, the reading, the
focus); a drop with a filter on; archive with «تراجع» and the focus; keyboard side arrows in the one-column layout; a
keyboard move to an off-screen column on a wide right-to-left board (dnd-kit's keyboard scroll assumes left-to-right, so R4
proves it or records it as the pointer's auto-scroll would be); a write's answer during a drag; touch; reduced motion
during a drag; `&card=` for an archived card or one in a hidden column.

## 3. Checks on the final tree

- lint, typecheck, copy, frozen 0; unit 72 files, 2,836 passed and 39 skipped.
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` 0: the public pages unchanged (`orders.html` 148.6 KiB, the
  largest; `cart.html` 147.2, `checkout.html` 142.4); the board's code loads only on its admin routes.
- `tests/e2e/projects.spec.ts` alone under Playwright's runner, with a fresh dev server (about 8 GB free, so alone):
  12 of 12 before the fixes; on the fixed tree a first run stopped at the viewer's test, which asserted the title field
  disabled where the fix (m12) makes it read-only on purpose (the spec runs in order, so the rest waited); the test now
  asserts that the title and the notes cannot be edited, that the notes take the focus, and that a choice is disabled;
  rerun, **12 of 12** (2.7 minutes). `next-env.d.ts` restored after each run.
- The orchestrator's mutation: `fitChanges` without its newer-version checklist rule fails the «احفظ نسختي» test (restored).
- The screenshots at 1440 and 360 (`test-results/screenshots/P12/projects-*`, git-ignored), looked at: the quiet desktop
  «نقل إلى…», the phone's switcher and single column, the dialog, the viewer, «مهامي».

Then, on the owner's word, the work stopped: R3's brief (`brief-R3.md`, with `audit-brief-R3.md`) is written, the lock
holds no writer, and nothing starts until he says continue.
