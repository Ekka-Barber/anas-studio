# P12, round R2: the writer's brief (the board)

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package P12, round R2, branch `agent/residuals-1`, R1 committed).
Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI 2.106.0, Docker Desktop with
the development stack ANASAQ.ME running. `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0 and `@dnd-kit/utilities`
3.2.2 are installed by the orchestrator before you start (exact versions, MIT); install nothing else.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Rules to keep"), `PLANS/P12-CONTRACT.md` (version 2: sections 2, 5 and 7
and section 8's R2 are this round; section 4 is the API R1 built, in `supabase/migrations/20261016120100_p12_board.sql`),
`DESIGN.md` section 10 (the admin), `PLANS/DESIGN-AUDIT.md` (every item that applies to a control you build: recheck each
before handoff), and the design the owner approved: `artifacts/acceptance/P12/comp/index.html` and its pictures. The comp
is the look: port its values (they are the admin's own) into `projects.module.css`, and reuse `admin.module.css`'s
classes for what already exists there (`.page` titles, `.button`, `.buttonSecondary`, `.input`, `.label`, `.field`,
`.badge`, `.toolbarButton`, `.dialog`, `.tile`, `.grid`, `.metaList`, `.message`, `.error`). Read one existing admin
screen end to end first (`src/components/admin/OrderView.tsx` with `src/lib/admin-orders.ts`: strict reply parsers in
`src/lib`, Supabase calls from the component, `?id=` routes inside `Suspense`). Where the contract and this brief
differ, the contract wins; where both are silent, stop and report.

## Write only these paths

- routes: `src/app/(admin)/admin/(shell)/projects/page.tsx`, `projects/view/page.tsx`, `projects/mine/page.tsx` (new)
- `src/components/admin/projects/` (new): `ProjectsHome.tsx` (the doors, «مشروع جديد»), `ProjectView.tsx` (the title
  row, the people, the tools row, the board view; the list and the overview are R3's: their buttons may stand disabled
  with no other effect, or be left out, your choice, said in the report), `Board.tsx` (columns, the drag context, the
  phone's switcher), `BoardCard.tsx`, `CardDialog.tsx`, `MoveMenu.tsx`, `MyCards.tsx` («مهامي»), `projects.module.css`
- `src/lib/projects.ts` (new, pure): the strict parsers of every reply R2 reads (`board_projects`, `board_project`,
  `board_mine`, `board_link_targets`, and the writes' replies), the refusal reader (section 1 of the contract: the code
  in `message`, the field in `detail`), search over title, notes and checklist, the filters and their «الكل», the
  reading-direction keyboard mapping, position arithmetic for a drop and for «نقل إلى…», the late-day wording, the
  plural forms, and the CSV builder (section 5's rules; its button is R3's)
- `src/components/admin/AdminShell.tsx` (the rail's «المشاريع» for every role; the role `board` sees only it and
  «الأمان», and any other admin path sends it to `/admin/projects/mine`; `/admin/projects/view` joins `isWidePath`),
  `src/components/admin/SignIn.tsx` (`board` lands on `/admin/projects/mine`), `src/components/admin/TableList.tsx`
  (`StaffRole` and `ROLE_LABEL` gain `board`, «لوحة المشاريع فقط»; its role check becomes an allow-list),
  `src/components/admin/TableForm.tsx` and `src/app/(admin)/admin/(shell)/store/StoreHome.tsx` (allow-lists)
- tests: `tests/unit/projects.test.ts` (new), `tests/unit/admin-ops.test.ts` (it pins the rail and `isWidePath`), and the
  new `tests/e2e/projects.spec.ts` (R2's part: below)
- `docs/development.md` (one line: the new files)

Any other path: stop and report.

## Never, and the rules

As `artifacts/acceptance/RESIDUALS-1/brief-R2a.md`'s "Never" and "Rules that bind every item", word for word (no SQL
this round: stop and report if R1's functions do not do what the contract says), with these additions: the contract's
section 7 words, exactly (a word it does not give is proposed in your report, never shipped as settled); logical
properties only; no physical left or right in CSS; Latin digits; 44px targets; the focus ring of the admin; nothing
animates under `prefers-reduced-motion: reduce`; no board text in the address bar or `localStorage`; no `console` output;
the public pages unchanged (`pnpm check:budgets`). If your run is cut short, your last message says what is built, what
ran and what is left.

## What to build, in order

1. `src/lib/projects.ts` with its unit tests first (every parser refusing a malformed reply; search; each filter; both
   keyboard directions on a right-to-left board; positions; the late-day forms for 1, 2, 3, 10, 11 and 100 days; the CSV's
   quoting, its formula prefix and its BOM).
2. The shell: the rail entry, the `board` gate, `SignIn`, the allow-lists, `isWidePath`; a unit test of the gate.
3. The projects, the project's view and its board, as the contract's section 5 and the comp draw them: columns from the
   right; the done column's night head and weave, with no add button; the card's face; «بطاقة جديدة في «…»» (members);
   «عمود جديد» and «إعادة تسمية» for owners (the rest of «خيارات» is R3's); the phone's single column and switcher.
4. Moving cards: `MouseSensor` and `TouchSensor` (250 ms, 5 px), the keyboard sensor (Space lifts and drops, Escape
   cancels, Enter opens the card; a coordinate getter across columns in the reading direction), Arabic
   `aria-roledescription` and instructions and announcements (section 7), the lifted card's solid ink shadow over the
   dashed landing place, `board_card_move` with the card's version; a refused move puts the card back, reads the project
   again and says so; «نقل إلى…» on every card at every width.
5. The card's dialog (`<dialog>`): every field of section 5, «حفظ» sending only what changed, the stale save with «احفظ
   نسختي» and «اعتمد الأحدث», «أرشفة البطاقة» with «تراجع» (no timer), focus rules (section 5's "States").
6. «مهامي»: the groups of section 5, each card linking to `/admin/projects/view?id=…&card=…`, which opens its dialog.
7. `tests/e2e/projects.spec.ts`, R2's part, at 360 and 1440: an owner makes a project, a column and two cards; a member
   (seeded through the integration harness or SQL as the existing admin specs seed staff) moves a card by mouse, by
   keyboard (Space, an arrow, Space) and by «نقل إلى…», and the move survives a reload; a viewer sees no move control and
   no «بطاقة جديدة»; a `board` person lands on «مهامي» and is sent there from `/admin/store`; screenshots under
   `test-results/screenshots/P12/` (git-ignored).

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. mutations, each reverted and checked identical after: the keyboard mapping's direction flipped (its test fails); the
   gate letting `board` reach `/admin/store` (its test fails); the CSV without its formula prefix (its test fails);
3. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/projects.spec.ts` (Playwright on `http://localhost:3000`; restore `next-env.d.ts` afterwards); otherwise say
   so;
4. `pnpm build`, `pnpm check:export` (the three new routes exported, no board text in `out/`), `pnpm check:budgets` (the
   public pages' figures unchanged).

The report: per step, what changed (files), every decision you took inside the contract and why, the words you needed
that section 7 does not give (proposed, not settled), the exact commands with exit codes and counts, the mutations and
what failed, the DESIGN-AUDIT items you rechecked, anything not done and why, and the risks left. Do not accept your own
work.
