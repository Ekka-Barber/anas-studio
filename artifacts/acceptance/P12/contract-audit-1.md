# P12, the contract: the first audit

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-contract.md`), 22 minutes, 81 tool calls, read-only, on
`PLANS/P12-CONTRACT.md` version 1 (2026-10-16). Its report, as it gave it; the orchestrator's rulings are in version 2's
record.

**Verdict: audit_failed.** The contract has 1 blocking finding, 13 major, 11 minor and 8 nits.

R = the repository root (every path below is R\…). Contract: R\PLANS\P12-CONTRACT.md (§ and line numbers refer to it). Comp: R\artifacts\acceptance\P12\comp\index.html.

What holds:
- The enum value goes in its own migration file (a new value can't be used in the transaction that adds it); add `if not exists`.
- `/admin/projects/view?id=` follows R\src\app\(admin)\admin\(shell)\orders\view\page.tsx (Suspense around `useSearchParams`).
- Every `admin` Edge action names its roles (R\supabase\functions\_shared\admin.ts:198, 236-282).
- The Auth hook reads no role (R\supabase\migrations\20260930120000_audit_fixes.sql:21-35).
- The arrow mapping is geometric, so it is right in RTL.
- The control-character rule matches the house rule (R\src\admin\fields.ts:353).

## Blocking

**P12C-01. §2 l.49-52, §6 l.144-145, R1 l.163-165: `board` gains access outside the board.** The contract says named role lists keep `board` out. Four RLS policies admit any non-null role, so a board-only outsider's token can read these straight through `/rest/v1` (the functions are not the wall here):
- draft products: R\supabase\migrations\20260927160000_catalog_and_checkout.sql:269-270
- every variant column (full grant at :281): stock, `low_stock_threshold`, the private `digital_asset` key (:143), preorder capacity. Policy at :290-291.
- disabled shipping rates: :321-322
- hidden posts: R\supabase\migrations\20260930120000_audit_fixes.sql:52-58

Three screens refuse only `editor`, so a board user opens the store and gets `select('*')` on variants:
- R\src\components\admin\TableList.tsx:63,82
- R\src\components\admin\TableForm.tsx:177,182,272
- R\src\app\(admin)\admin\(shell)\store\StoreHome.tsx:25,37

Also: sign-in sends every role to `/admin` (R\src\components\admin\SignIn.tsx:91), and `EVERYONE` gives the home (R\src\components\admin\AdminShell.tsx:46,59).

Checked clean:
- every other `current_staff_role()` use
- `finance.require_staff` (R\supabase\migrations\20261002145000_order_operations.sql:31-48)
- `staff-admin` (index.ts:53), `staff_directory` (r2a.sql:2145), `staff_read`
- mail recipients (named roles)
- `content_documents` (security_invoker)

Change:
- R1 adds a migration that recreates the four policies with `in ('owner','editor','operations')`, plus tests: a board token reads no draft product, no variant, no disabled rate, no hidden post.
- R2 adds one path gate in AdminShell: `board` renders only `/admin/projects*` and `/admin/security`, and is sent there from `/admin`. TableList, TableForm and StoreHome switch to allow-lists. Name these files in R1 and R2.

## Major

**P12C-02. §4 l.79-105: the layers have no agreed interface.**
- Most functions have no parameter list: project rename/archive/restore/delete, `person_remove`, `column_*`, `label_*`.
- No reply shape is given, and the `p_changes` keys are undefined (label ids, people ids, checklist item shape, link shape).
- The error transport is not fixed: which SQLSTATE per code, and whether the code sits in message, detail or hint (and where INVALID's field goes).
- P08-CONTRACT.md:3 makes these the contract's job, and R1 and R2 are different workers.

Change: add an exact signature and reply table, and one transport rule (`raise exception '<CODE>' using errcode=…, detail='<field>'`; STALE 23505, FORBIDDEN 42501, …). Or have R1 write them back as version 2 before R2 starts.

**P12C-03. §1 l.33 and §5 l.112 against §4 l.82-84: search over notes and checklist cannot work.** `board_project` returns no notes and only checklist counts, and R\PLANS\ARCHITECTURE.md:121 says search runs in the browser. Change: return notes and checklist texts, or add `board_search(p_project, p_query)` that returns card ids.

**P12C-04. Rule l.22-23, §3 l.66, §4 l.83: the link can leak a draft's title.**
- The definer functions bypass `content_versions_read` (owner and editor only; R\supabase\migrations\20260925120000_content_versions_and_publishing.sql:32-34).
- R\PLANS\WORK-PACKAGES.md:157 requires linking drafts, and "the linked document's title" is unspecified. Operations, board people and viewers would see draft or hidden-post titles, and "the document exists" lets them probe draft slugs.
- No function lists link targets for a member.

Change:
- Add `board_link_targets()`. Owners and editors get every post and room (latest title); everyone else gets rooms and visible published posts only.
- `board_card_update` accepts only targets from the caller's set.
- Card reads give owners and editors the latest title, give others the published title if the document is public, and otherwise no title (word in §7).
- R1 test: a viewer never receives a draft title.

**P12C-05. §3 l.68: assignment includes viewers.** Assignment is allowed to anyone with project access, but D52's answer was «Yes, to members (Recommended)» (R\PLANS\DECISIONS.md:59). Change: owners and `member`s only; demoting someone to viewer takes them off the project's cards; add a test.

**P12C-06. §2 l.49-50, §5 l.134, D52 (4) and (5): board-only people get no due-card reminders.** They have no admin home, so `board_due` never reaches them, and their landing page is undefined. Change: `board` lands on «مهامي», whose «متأخرة» and «اليوم» groups are their reminder (or put the due panel on `/admin/projects`). State which.

**P12C-07. Rule l.17-19, §3 l.65 and l.72-74, §4 l.95-102: versions and locks are inexact.**
- "Every write takes the row's version", but the create, restore, person and label functions take none, and `labels` has no `version` column.
- The contract does not say whether renumbering bumps the versions of the cards it passes.
- Only moves are said to lock the project, but these also need the lock: card create (max+1 position), column and label creates at the 12 and 16 limits, and removal of a person racing an assignment to them.

Change:
- Every write locks the project row first, then cards in ascending id.
- A move checks only the moved card's version, and the position is clamped to 1..n+1.
- Archived cards have `position null`, and open cards carry `unique (column_id, position) deferrable initially deferred` (a partial unique index can't be deferred).
- R1 race tests: two creates in one column, two column creates at 11, removal against assignment.

**P12C-08. §2 l.46-48 and l.53-54: the people lifecycle is undefined.**
- Deactivation is a service-role update in `staff-admin` (R\supabase\functions\staff-admin\index.ts:137-141), not a board function. "Taken off its cards" therefore implies a trigger on `public.staff`, which brings a lock-order risk, and «استعادة» is undefined.
- Change: keep `members` rows, `board.access` requires the staff row to be active, and inactive people are filtered out at read time. Restore then brings access and assignments back, with no trigger.
- Owners have no row, but the comp lists «أنس المالك» (comp:269). People should be all active owners plus member rows.
- `board_staff()` excludes owners and people already on the project. `board_person_set` refuses inactive staff and owners. `access()` checks owner first.

**P12C-09. §3 l.74, §4 l.95-102: deletes and archives lead to dead ends.**
- A column that ever held an archived card can never be deleted, because there is no card delete. Change: column delete moves its archived cards to the first column, or add an owner-only delete for archived cards.
- An archived project is undefined for members. Change: owner-only (NOT_FOUND for others and absent from `board_projects`, `board_mine` and `board_due`), or read-only for all.
- Restore and «تراجع»: say the target position; a second restore is a no-op.

**P12C-10. §4 l.88-93, §1 l.34, §5 l.133: the counts' definitions are not exact.**
- "Next 7 days" (overview, `board_due`) and "this week" (filters, «مهامي», comp:356) need one definition in Riyadh days, with today's inclusion stated.
- Done-column, archived cards and archived projects should be excluded everywhere, not only from the overview's overdue count.
- "Done in the last 7 days" read from the activity is miscounted by three cases:
  - a reorder inside the done column (from = to);
  - a card created or restored directly into the done column;
  - moving the done flag to another column.
- The comp's «أُنجزت 16 أكتوبر» (comp:334-336) needs a per-card time that no function returns.
- Change: add `cards.done_at`, set when a card enters the done column and cleared when it leaves, and return it from `board_project`. With no done column, the overview says so instead of 0 (D21). State how hidden columns count.

**P12C-11. §5 l.122 against comp:144: «نقل إلى…» is hidden at 768px and wider in the comp.** WCAG 2.2 SC 2.5.7 needs a single-pointer alternative at every width, and the dialog has no column field. Change: show it on every card at every width; R4 uses it with the mouse at 1440.

**P12C-12. §6 l.142-143: the CSV allows formula injection.** Members now write the text (D52) that the owner opens in a spreadsheet. Change:
- quote every cell, and prefix cells starting with `= + - @`, tab or CR with `'`;
- UTF-8 with BOM;
- fixed columns, and say whether archived cards are included;
- unit test.

**P12C-13. Rule l.26 "word for word" and §4 l.104 against §7: words are missing.** Missing:
- the refusal words for NOT_FOUND, FORBIDDEN, INVALID per field, LIMIT and NOT_EMPTY, and for a failed or stale move (l.124);
- the column menu, project actions and the irreversible-delete confirmation;
- the label editor and the four tone names;
- filter labels, list headers and sort choices;
- the overview headings and sentences (comp:349-357), and the activity sentence for each of the 16 actions (comp:364-367);
- «أُنجزت …», the «متأخرة …» day forms, the tile lines (comp:257-260) and the dialog title;
- the empty states of «مهامي», the archive and the home panel;
- the people dialog, the Team line, and dnd-kit's instructions (P12C-14).

Change: add them, or let workers propose strings that are ruled before acceptance.

**P12C-14. §5 l.119-124, R4 l.174-178: dnd-kit.**
- Peer `react >=16.8` fits React 19.3.0 and Next 16.3.8 (R\package.json:40-44). R2 records versions, license and peers (D19), plus `@dnd-kit/utilities` if imported.
- The defaults are English: `aria-roledescription` and the hidden `screenReaderInstructions`. Set both in Arabic.
- The keyboard sensor lifts on Enter too; set codes to Space and Escape if Enter opens the dialog.
- Cross-column arrows need a coordinate getter for several containers.
- Use `TouchSensor` (250 ms, tolerance 5) plus `MouseSensor`. `PointerSensor` needs `touch-action: none`, which blocks scrolling on cards.
- In RTL, `scrollLeft` runs 0 to negative, while dnd-kit 6's auto-scroll assumes 0..max (recalled; the package is not installed here). R4 must drag to an off-screen column on a 12-column board at 1440, and the contract names a fallback.
- R4 asks for touch moves at 360, where §5 makes the menu the only way. Test touch at 1024 with `hasTouch`.

## Minor

- **P12C-15 (§3 l.70, §4 l.90-91): the activity cannot be rendered as drawn.**
  - No card title is returned (archived cards included), but the comp shows titles.
  - `person_*` rows have no subject column; add `subject uuid`.
  - `fields` lacks the column changes (name, hidden, done).
  - There are no label actions, though rule l.18 says every write writes one.
  - Use `on delete set null` for columns, with «عمود محذوف».
  - A project delete should write a `public.audit_events` row.
- **P12C-16 (§3): no caps** on cards per project, projects, or people per project or card. Add LIMIT values.
- **P12C-17 (l.12-16): schema privileges.** Add `revoke all on schema board from public, anon, authenticated` (precedent: 20260926120000_contacts_and_email.sql:13). R1 proves `Accept-Profile: board` is refused for every role (WORK-PACKAGES.md:157).
- **P12C-18 (R4): proof items dropped from WORK-PACKAGES.md:157.** Restore them:
  - a canary card title is absent from `out/`, the sitemap and search;
  - a hidden column stays hidden after reload;
  - moves persist after reload.
- **P12C-19 (§5, R2): routes and rules unnamed.**
  - The archive routes and the card deep link from the home are not named.
  - `isWidePath` (AdminShell.tsx:35-37) and the rail entry's place (comp:223) are unspecified.
  - R2 already needs `StaffRole` and `ROLE_LABEL` from TableList.tsx:22,25.
  - Missing rules: P08-CONTRACT.md:14's worker file rules, and D50's ban on copying from kargulstudio.
- **P12C-20 (l.127-129): «احفظ نسختي» can lose data.** If the dialog re-sends every field and the whole checklist, it wipes the other person's untouched fields. Send only the changed fields; consider a checklist tick that does not use the card's version.
- **P12C-21 (§5 states): live updates and focus.**
  - With deny-all RLS, Supabase Realtime is impossible; re-read the project on focus and after each write.
  - «تراجع» has no timer (WCAG 2.2.1).
  - Define where focus goes after archive, move or STALE.
  - Keep search text out of the URL and board text out of localStorage.
- **P12C-22 (l.135-136): the Team screen's invite line is false.** The invite creates the user with `email_confirm: true` and sends no mail (staff-admin\index.ts:95), yet the screen says «أُرسلت الدعوة.» (TeamView.tsx:26). The line should tell the owner to give the person the sign-in address.
- **P12C-23 (§7): word clashes and plural forms.**
  - «القائمة» names both the list view and the checklist (comp:284, 314, 390); rename the checklist «البنود».
  - «عمود مخفي (n)» stays singular for any n; use «الأعمدة المخفية (n)».
  - Plural forms for zero and other are missing.
- **P12C-24 (D52 (1)):** record the owner's approval of the preview before R1.
- **P12C-25: plan records contradict D52.** DATA-AND-SECURITY.md:26 and :51, ARCHITECTURE.md:121, WORK-PACKAGES.md:153, EXECUTION-STATUS.md:411 and docs\privacy-data-map.md need the orchestrator's update.

## Nits

- «غيّر أحدٌ…» uses «أحد» in an affirmative clause. The admin's wording is «تغيّر هذا المستند منذ فتحته» (CollectionForm.tsx:41); use «تغيّرت هذه البطاقة منذ فتحتها؛ هذه نسختها الأحدث.»
- «المالك» against the admin's «مالك» (TableList.tsx:25).
- «بطاقة في «…»» → «بطاقة جديدة في «…»».
- «بطاقات حان موعدها» does not fit a 7-day window.
- «التصنيفات» is already the content taxonomies' word (FieldInput.tsx:592); use «الوسوم».
- «رُفعت بطاقة» → «رُفعت البطاقة».
- Activity times: use `formatRiyadh` (R\src\lib\format.ts:39-43, 12-hour), not the comp's 21:05.
- The comp's done column has no add button (comp:330-338); say whether it should.

## Open questions for the owner

1. D50 made the activity log owner-only, while the contract shows every member and viewer who changed what and when. Keep it owner-only, or show it to the project's people?
2. Is the preview approved for building (D52 (1))?
3. If «Yes, to members» meant something other than "members only": may a «مُطّلع» be assigned cards?
