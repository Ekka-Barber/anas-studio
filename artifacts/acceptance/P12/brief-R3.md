# P12, round R3: the writer's brief (around the board)

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package P12, round R3, branch `agent/residuals-1`, R2 committed).
Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI 2.106.0, Docker Desktop with
the development stack ANASAQ.ME running. Install nothing.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Rules to keep"), `PLANS/P12-CONTRACT.md` (sections 2, 4, 5 and 7, and
section 8's R3; section 4's reads are R1's, in `supabase/migrations/20261016120100_p12_board.sql`: its JSON builders are
the replies' truth), `artifacts/acceptance/P12/RECORD-R1.md` (the activity's `role` and `to_column`, the caps) and
`RECORD-R2.md` (what R2 built and the rulings on it), `DESIGN.md` section 10, `PLANS/DESIGN-AUDIT.md` (every item that
applies to a control you build: recheck each before handoff), and the approved comp
(`artifacts/acceptance/P12/comp/index.html`). Then read R2's files end to end before you change them:
`src/lib/projects.ts`, `src/components/admin/projects/` (every file), `src/components/admin/AdminHome.tsx` and
`src/components/admin/TeamView.tsx`. Where the contract and this brief differ, the contract wins; where both are silent,
stop and report.

## Reuse before you write (the owner's rule, 2026-10-16)

Start every piece from what exists: R2's parsers, refusal reader (`readRefusal`, `refusalText`, and `writeRefusalText`
for a write whose row may be gone), plural forms, late-day wording, CSV builder, dialogs (`Modal`), menus (`MoveMenu`'s
positions), the read-on-focus pattern and styles; the admin's classes (`admin.module.css`) and its panels (`AdminHome.tsx`'s pattern for a home panel).
Nothing in R3 needs a package: the list view is a `<table>`, the counts are `Intl.PluralRules('ar')`, the CSV is R2's
builder and a `Blob`. If you believe a licensed library (MIT, Apache-2.0 or BSD) would replace more than a hundred lines
of yours, propose it in your report; install nothing.

## Write only these paths

- `src/app/(admin)/admin/(shell)/projects/archived/page.tsx` (new; inside `Suspense`, as R2's routes)
- `src/components/admin/projects/` (R2's files, and new ones as you need them, for example `ListView.tsx`,
  `Overview.tsx`, `ActivityLog.tsx`, `ColumnOptions.tsx`, `LabelsDialog.tsx`, `PeopleDialog.tsx`, `ProjectOptions.tsx`,
  `Archived.tsx`)
- `src/lib/projects.ts` (the strict parsers of every reply R3 reads: `board_overview`, `board_activity`,
  `board_archived`, `board_staff`, `board_export`, `board_due`, and the writes R3 calls; the activity's sentence)
- `src/components/admin/AdminHome.tsx` («مواعيد المشاريع»)
- `src/components/admin/TeamView.tsx` (the invite line only)
- tests: `tests/unit/projects.test.ts`, `tests/unit/admin-ops.test.ts` (the invite line and the home panel), and
  `tests/e2e/projects.spec.ts` (R3's part)
- `docs/development.md` (one line)

Any other path: stop and report.

## Never, and the rules

As `brief-R2.md`'s "Never, and the rules", word for word: no SQL (stop and report if R1's functions do not do what the
contract says); section 7's words exactly (a word it does not give is proposed in your report, never shipped as
settled); logical properties only; Latin digits; 44px targets; the admin's focus ring; nothing animates under
`prefers-reduced-motion: reduce`; no board text in the address bar, `localStorage` or `sessionStorage` (the shown hidden
columns and the list's sort are the view's state, not stored); no `console` output; the public pages unchanged.

## What to build, in order

1. `src/lib/projects.ts` with unit tests first: each new parser refusing a malformed reply; the activity's sentence for
   every action of section 7: the actor's name; a person row's role from the row's own `role` (history, never the
   person's role today); a column row's column from `to`; a move within its column («… غيّر موضع «<card>» في «<to>».»,
   when `from` equals `to`); a deleted column «عمود محذوف»; the changed fields in section 7's field words, joined with
   «و»; the times with `formatRiyadh`.
2. The list view («القائمة»): one table of the cards R2's search and filters leave (العنوان، العمود، الأولوية، الموعد،
   الأشخاص، الوسوم), sorted by «ترتيب حسب الموعد» (earliest first, none last) or «ترتيب حسب الأولوية» (urgent first, then
   by due day); at 480px and below, each row a labelled card; a row opens the card's dialog; «لا بطاقات تطابق البحث.».
3. The overview («نظرة عامة», owners and members): `board_overview`'s counts as section 7's sentences, «لا عمود منجز في
   هذا المشروع.» when `hasDone` is false, and «الأرقام تُعدّ من البطاقات نفسها، ولا تُقدَّر.»; never a zero where a count
   could not be read. For owners only: «سجل النشاط» (50 at a time; «الأقدم» asks for the 50 before the last id shown),
   with «يُسجَّل ما تغيّر ومن غيّره، ولا يُنسخ نص الملاحظات إلى السجل.», and «تصدير البطاقات (CSV)»: `board_export`, then
   R2's builder, then a download made in the browser and never stored, named `cards-<YYYY-MM-DD>.csv` (the Riyadh day).
4. The card's dialog, for owners: the card's own «سجل النشاط» (`board_activity` with `p_card`).
5. A column's «خيارات» (owners; R2 built it with «إعادة تسمية»): add «إخفاء العمود» and «إظهار العمود»; «عمود الإنجاز» (a
   checked menu item; moving the mark to this column); «نقل العمود» (a menu of positions, like «نقل إلى…»); «حذف العمود»
   (its `NOT_EMPTY` sentence, and the only-column sentence when the project has no other column). R2's «الأعمدة المخفية
   (n)» in the tools row already shows the hidden columns until the page is reloaded: keep it.
6. Labels (owners): «وسم جديد» («اسم الوسم» and «اللون» from the four tones with section 7's names), rename, recolour
   and delete, from a dialog the tools row or «خيارات» opens; the `LIMIT labels` sentence.
7. «الأشخاص والأدوار» (owners): the project's owners (fixed) and its members, each member with a «الدور» select
   («مشارك»، «مُطّلع») and «إزالة»; «إضافة شخص» from `board_staff` with its role; the `LIMIT people` sentence; and the
   line to the Team screen, «من ليس في الفريق بعد يُضاف من صفحة الفريق بدور «لوحة المشاريع فقط».», linking to
   `/admin/team`.
8. The project's options (owners): rename the project, «أرشفة المشروع»; and `/admin/projects/archived` (owners):
   «المشاريع المؤرشفة» with «استرجاع» and «حذف المشروع نهائيًا» (the typed-name confirmation of section 7, with «حذف
   نهائي»; «لا مشاريع مؤرشفة.»), and at `?id=<project>` «البطاقات المؤرشفة» (`board_archived`) with «استرجاع» («لا بطاقات
   مؤرشفة.»). «المشاريع المؤرشفة» joins the projects page for owners.
9. The admin home: «مواعيد المشاريع» from `board_due` for every role but `board`, each card linking to
   `/admin/projects/view?id=…&card=…`, with its due day or the late wording; «لا مواعيد قريبة.»; a failed read says so
   and offers «إعادة المحاولة».
10. The Team screen: the invite's answer becomes «أُنشئ الحساب. يدخل صاحبه من anas.studio/admin ببريده، ويصله رمز الدخول
    عندها.» (`doneText`), in place of «أُرسلت الدعوة.».
11. `tests/e2e/projects.spec.ts`, R3's part, at 360 and 1440: the list's two sorts; the overview's counts equal to the
    rows; the owner's activity sentences (a role change and a column rename among them); the CSV (its BOM, every cell
    quoted, a formula cell prefixed, the columns in section 5's order); a column hidden, shown by «الأعمدة المخفية (n)»,
    and hidden again after a reload; the done mark moved; a column deleted; a label made, used and deleted; a person
    added, made a viewer and removed; a project archived, restored, archived again and deleted with its typed name; the
    home's panel; the invite line. Screenshots under `test-results/screenshots/P12/` (git-ignored).

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. mutations, each reverted and checked identical after: the activity's role read from today's role instead of the
   row's (its test fails); the list's due-day sort with nulls first (its test fails); the overview's no-done sentence
   dropped (its test fails);
3. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/projects.spec.ts` (Playwright on `http://localhost:3000`; restore `next-env.d.ts` afterwards); otherwise say
   so;
4. `pnpm build`, `pnpm check:export` (the archived route exported, no board text in `out/`), `pnpm check:budgets` (the
   public pages' figures unchanged).

The report: per step, what changed (files), every decision you took inside the contract and why, the words you needed
that section 7 does not give (proposed, not settled), what you reused and from where, the exact commands with exit codes
and counts, the mutations and what failed, the DESIGN-AUDIT items you rechecked, anything not done and why, and the risks
left. Do not accept your own work.
