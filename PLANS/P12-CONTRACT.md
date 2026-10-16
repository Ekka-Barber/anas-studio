# P12 contract: «لوحة المشاريع»

Version 2 (2026-10-16). Written by the orchestrator (Opus 5.5) from D22, D50 and D52, before any worker round. Version 1
was audited by a fresh Opus 5.5 auditor the same day (`artifacts/acceptance/P12/contract-audit-1.md`: `audit_failed`, one
blocking finding, 13 major, 11 minor, 8 nits); this version settles every finding (the rulings are at the end), and the
owner answered its one open question («Owner only»: the activity log stays the owner's, as D50 said). The design is the
preview the owner approved in the Build Ledger on 2026-10-16 (`artifacts/acceptance/P12/comp/`). Every worker and
auditor of P12 reads this file first; where it and `PLANS/WORK-PACKAGES.md` (P12) differ, this file wins. Amended the
same day after R1's audit (`artifacts/acceptance/P12/RECORD-R1.md`): the activity keeps a person row's role and a column
row's column, the caps of people count the people the screens show, and section 7 gains two sentences. Before R3,
section 7 gained the four words R3 needs (the archived cards' title, the label's name field, the activity's heading and
the people dialog's line to the Team screen).

Rules that hold for every round:

- The board is private to the people the owner puts on it. Nothing of it is public: no anon grant, no static page with
  its data, no sitemap entry, no analytics or error reporting of its text, no board text in the address or in
  `localStorage`; the admin's `robots` rule covers its routes.
- All board data lives in the schema `board`: `revoke all on schema board from public, anon, authenticated`, RLS on for
  every table with no policy (deny all), no table granted to a client role, and a request with `Accept-Profile: board`
  refused for every role. The browser reads and writes it only through `public.board_*` functions: `security definer`,
  owned by `postgres`, `set search_path = ''`, fully qualified, `revoke all ... from public, anon` and `grant execute ...
  to authenticated`, each starting with `board.caller()` (an active staff row for `auth.uid()`, else `FORBIDDEN`) and,
  for a project, `board.access(p_project)` (section 2).
- **Refusals**, one transport for every function: `raise exception using errcode = '<state>', message = '<CODE>', detail =
  '<detail>'`. `STALE` is 23505 (the house rule); every other code is `P0001`. `detail` is the field for `INVALID`
  (`name`, `title`, `notes`, `checklist`, `due_on`, `labels`, `people`, `link`, `position`, `role`, `tone`), the limit's
  name for `LIMIT` (`projects`, `columns`, `labels`, `cards`, `people`, `card_people`, `checklist`), and empty otherwise.
  Codes: `NOT_FOUND`, `FORBIDDEN`, `STALE`, `INVALID`, `LIMIT`, `NOT_EMPTY`. A project the caller may not see is
  `NOT_FOUND`, never `FORBIDDEN`.
- **Locks and versions.** Every write locks the project row first (`select ... for update`), then the columns it touches,
  then the cards in ascending id. Every write that changes an existing project, column, label or card takes that row's
  `version` and raises `STALE` when it moved, then bumps it; creates, restores and person changes take no version (the
  project lock orders them). A move checks only the moved card's version; renumbering the cards it passes changes their
  `position` only, not their version. Every write writes exactly one `board.activity` row in the same transaction, with
  no text in it (section 3).
- Text fields refuse control characters (U+0000 to U+001F, U+007F to U+009F; the notes allow line feeds), are trimmed,
  and keep the lengths of section 3, checked in SQL and before the press.
- Linking a card to content never creates, changes or publishes content: it stores a reference and reads a title under
  the caller's own content rights (section 4, `board_link_targets`). Publishing stays the content screens' action.
- Days are Riyadh calendar days (`supabase/functions/_shared/riyadh-day.ts`'s rule; in SQL `(now() at time zone
  'Asia/Riyadh')::date`), shown with Latin digits; "this week" is today and the six days after it. Times shown use
  `formatRiyadh` (`src/lib/format.ts`).
- The screens follow DESIGN.md section 10 and the comp; the words are section 7's. A word a worker needs that section 7
  does not give is proposed in the round's report and ruled before acceptance; it never ships unruled.
- Workers write only the paths their round's brief names; `@dnd-kit` packages are pinned exact, MIT, with their peers
  recorded (D19). The owner's reference board (github.com/kargulstudio/kanban, no license) is never copied (D50).

## 1. Scope

In (D22, D50, D52): several projects, each with its own free-form columns (named by the owner; one may be marked done;
a column may be hidden and shown on demand); cards with a title, notes, a priority («عاجل»، «عادي»، «منخفض»), an
optional due day, labels («الوسوم») in the palette's tones, a checklist («البنود»), the project's people assigned
(owner or `member`), and an optional link to a post or a room document; search (title, notes, checklist) and filters
(priority; due: overdue, today, this week, none; label; person; linked or not); a board view and a list view sorted by
due day or priority; each project's overview from its real rows; the owner's activity log; archive and restore of cards
and projects, with «تراجع» after archiving; a project's cards exported to CSV (the owner); «مهامي» (each person's
assigned cards across projects); the admin home's due cards.

Out (D22, D50, D52): notifications to anyone, mail of any kind, automations or rules, swimlanes, external tools, a
project manager role, comments, attachments, time tracking, dependencies, live updates (no Realtime: the screens read
again on focus and after every write).

## 2. People and access

- **Owners** are the active staff whose role is `owner`. An owner sees and does everything on every project, archived
  ones included, and alone creates, renames, archives, restores and deletes projects, adds and removes people, sets
  their roles, manages columns and labels, reads the activity and exports. An owner needs no `members` row; a project's
  people are its active owners and its active members.
- **A project's people** are `board.members` rows: an active staff member who is not an owner, with the project role
  `member` («مشارك»: adds cards, edits, moves, archives and restores them, and may be assigned) or `viewer` («مُطّلع»:
  reads only, is never assigned). Turning a member into a viewer takes them off the project's cards in the same
  transaction.
- **The board-only role.** `public.staff_role` gains `board` («لوحة المشاريع فقط»), in a migration of its own (`alter
  type public.staff_role add value if not exists 'board'`; a new value cannot be used in the transaction that adds it).
  The owner gives it from the Team screen. Such a person signs in as any staff member does, lands on «مهامي», and sees
  in the rail only «المشاريع» and «الأمان»: the shell routes `board` to `/admin/projects*` and `/admin/security` only,
  and sends any other admin path to `/admin/projects/mine`.
- **The wall outside the board.** Four policies today admit any staff role and would admit `board`; R1 recreates them
  with the roles named, `in ('owner', 'editor', 'operations')`: `products_read_staff`, `product_variants_read_staff`,
  `shipping_rates_read_staff` (`20260927160000_catalog_and_checkout.sql:269-270, 290-291, 321-322`) and
  `published_documents_staff_read` (`20260930120000_audit_fixes.sql:52-58`). Every other use of
  `public.current_staff_role()`, `finance.require_staff`, the role lists of `supabase/functions/staff-admin/index.ts` and
  `supabase/functions/_shared/staff.ts`, the `admin` function's actions and the Auth hooks name their roles already (the
  contract audit checked them); R1 lists each it re-checked. On the screens, `TableList.tsx`, `TableForm.tsx` and
  `StoreHome.tsx` refuse only `editor` today: R2 turns them to allow-lists of the roles that may use them.
- **Deactivation and removal.** Removing a person deletes their `members` row and their assignments on the project. A
  deactivated staff member keeps their rows: `board.access` requires an active staff row, and every read leaves inactive
  people out (no board change follows a deactivation; reactivation brings access and assignments back).
- **The helpers.** `board.caller() returns uuid` (the active staff member's id, else `FORBIDDEN`) and `board.access(p_project
  uuid) returns text` (`'owner'`, `'member'`, `'viewer'`, or null: owner checked first; an archived project is null for
  everyone but owners). Every function uses them; a null answer is `NOT_FOUND`.

## 3. Schema (`board`)

| Table | Columns | Rules |
|---|---|---|
| `projects` | `id uuid pk`, `name text`, `created_by uuid`, `created_at`, `updated_at`, `archived_at timestamptz null`, `version int` | name 1 to 80; at most 50 projects that are not archived |
| `members` | `project_id`, `user_id`, `role text`, `added_by`, `added_at` | pk (project, user); role in (`member`, `viewer`); the user is a staff member who is not an owner; at most 30 per project, counted over the active members who are not owners (the people the owner sees): an inactive person's row never blocks, and a reactivated one may return past 30 |
| `columns` | `id`, `project_id`, `name`, `position int`, `hidden bool`, `is_done bool`, `version int` | name 1 to 40; at most one done column per project (partial unique index); at most 12 per project; `unique (project_id, position) deferrable initially deferred` |
| `labels` | `id`, `project_id`, `name`, `tone text`, `version int` | name 1 to 24, unique per project (case folded); tone in (`saffron`, `coral`, `sand`, `aub`); at most 16 per project |
| `cards` | `id`, `project_id`, `column_id`, `position int null`, `title`, `notes text`, `priority text`, `due_on date null`, `done_at timestamptz null`, `link_collection text null`, `link_doc_id text null`, `created_by`, `created_at`, `updated_at`, `archived_at null`, `version int` | title 1 to 200; notes 0 to 5,000; priority in (`urgent`, `normal`, `low`), default `normal`; an open card has a position and an archived one has none; `unique (column_id, position) deferrable initially deferred` (archived cards' nulls never clash); link both null or both set, collection in (`posts`, `rooms`); at most 1,000 open cards per project |
| `card_labels` | `card_id`, `label_id` | the label is the card's project's |
| `card_people` | `card_id`, `user_id` | the person is an owner or a `member` of the card's project; at most 10 per card, counted over the people it shows (those who can be assigned now): a reactivated person returns even past it, and the next save of the card's people must come back within it |
| `checklist` | `id`, `card_id`, `text`, `done bool`, `position int` | text 1 to 200; at most 50 items per card |
| `activity` | `id bigint identity`, `project_id`, `card_id null`, `subject uuid null`, `role text null`, `actor uuid`, `at timestamptz`, `action text`, `fields text[]`, `from_column uuid null`, `to_column uuid null` | columns referenced `on delete set null`; a `column_created`, `column_changed` or `column_moved` row names its column in `to_column`; `role` (`member`, `viewer`) is the role a `person_added` or `person_role_changed` row gave (the log is history); `action` in (`project_created`, `project_renamed`, `project_archived`, `project_restored`, `person_added`, `person_role_changed`, `person_removed`, `column_created`, `column_changed`, `column_moved`, `column_deleted`, `label_created`, `label_changed`, `label_deleted`, `card_created`, `card_edited`, `card_moved`, `card_archived`, `card_restored`); `subject` is the person of a `person_*` row; `fields` holds names only (`title`, `notes`, `priority`, `due_on`, `labels`, `people`, `checklist`, `link`, `name`, `hidden`, `done`, `tone`) |

- **Positions** are dense from 1 per column (cards) and per project (columns). A move clamps the asked position to 1 to
  n + 1 and renumbers the rows it passes. A card created goes last in its column; a restored card goes last in its
  column, or in the first column when its own was deleted; restoring an open card changes nothing and answers it.
- **Done.** `done_at` is set when a card enters the done column (by a move, a create or a restore into it, or by the done
  mark moving onto its column) and cleared when it leaves it (or the mark leaves its column). A project with no done
  column has no done cards.
- **Deletes.** A column is deleted only when it holds no open card; its archived cards move to the project's first
  column (they keep no position). A project is deleted by an owner only once archived, with all its rows, and the delete
  writes one `public.audit_events` row (`board.project_deleted`, the project's id, no name).

## 4. Functions (`public.board_*`)

Replies are JSON; ids are uuids as text; days `YYYY-MM-DD`; times ISO; people are `{id, name}` (the staff directory's
display name; never an email). Every read leaves out archived cards and inactive people unless it says otherwise.

| Function | Who | Reply |
|---|---|---|
| `board_projects()` | any staff | `[{id, name, archived, cards, overdue, people: [{id, name}]}]`: the caller's projects (owners: all, archived ones flagged) |
| `board_project(p_project uuid)` | access | `{project: {id, name, version, archived}, role, columns: [{id, name, position, hidden, isDone, version}], labels: [{id, name, tone, version}], people: [{id, name, role}], cards: [{id, columnId, position, title, notes, priority, dueOn, doneAt, labels: [id], people: [id], checklist: [{id, text, done}], link: {collection, docId, title} \| null, version}]}`; `role` is the caller's |
| `board_link_targets()` | any staff | `[{collection, docId, title}]`: owners and editors get every post and room (latest title); everyone else gets the rooms and the published, visible posts (published title) |
| `board_archived(p_project uuid)` | access | `[{id, title, columnId, archivedAt}]` |
| `board_mine()` | any staff | `[{id, title, priority, dueOn, project: {id, name}, column: {id, name}}]`: the caller's assigned open cards in projects they can see that are not archived, outside done columns |
| `board_overview(p_project uuid)` | access | `{columns: [{id, name, cards}], overdue, thisWeek, doneThisWeek, hasDone}`: overdue is due before today; thisWeek is due today to today + 6; both outside the done column; doneThisWeek is `done_at` in the last seven days; hidden columns count like the others |
| `board_activity(p_project uuid, p_card uuid null, p_before bigint null)` | owner | `[{id, at, actor: {id, name}, action, fields, card: {id, title} \| null, subject: {id, name} \| null, role: 'member' \| 'viewer' \| null, from: name \| null, to: name \| null}]`: 50 rows, newest first; a deleted column is named null; a column row's column is `to` |
| `board_due()` | any staff | `[{id, title, dueOn, project: {id, name}}]`: owners: every project's cards; others: their assigned ones; overdue and this week, outside done columns and archived projects, at most 20, earliest first |
| `board_staff(p_project uuid)` | owner | `[{id, name, role}]`: the active staff who are not owners and not on the project |
| `board_export(p_project uuid)` | owner | every card, archived ones included, with its notes, labels' names, people's names and checklist, for the CSV |

A link's title in a card follows `board_link_targets`' rule for the caller: an owner or an editor reads the latest title;
anyone else reads the published title of a document that is public, and otherwise `title: null` (the screen says «محتوى
غير منشور»). `board_card_update` accepts only a link the caller's `board_link_targets` holds.

Writes (owner, or `member` where marked; a `viewer` gets `FORBIDDEN`): `board_card_create(p_column uuid, p_title text)`
(member) → the card as `board_project` gives it; `board_card_update(p_card uuid, p_version int, p_changes jsonb)`
(member) → the card; `p_changes` holds only the keys the caller changed, any of `title`, `notes`, `priority`, `dueOn`
(a day or null), `labels` ([id]), `people` ([id]), `checklist` ([{id \| null, text, done}], the whole list in order),
`link` ({collection, docId} or null); `board_card_move(p_card uuid, p_version int, p_column uuid, p_position int)`
(member) → `{card, columns: [{id, cards: [{id, position}]}]}` for the columns it touched; `board_card_archive(p_card,
p_version)` (member) and `board_card_restore(p_card)` (member) → the card; `board_project_create(p_name)`,
`board_project_rename(p_project, p_version, p_name)`, `board_project_archive(p_project, p_version)`,
`board_project_restore(p_project)`, `board_project_delete(p_project, p_version)`; `board_person_set(p_project, p_user,
p_role)` (refuses an owner, an inactive member, and the 31st) and `board_person_remove(p_project, p_user)`;
`board_column_create(p_project, p_name)`, `board_column_update(p_column, p_version, p_changes jsonb)` (`name`, `hidden`,
`isDone`), `board_column_move(p_column, p_version, p_position)`, `board_column_delete(p_column, p_version)`;
`board_label_create(p_project, p_name, p_tone)`, `board_label_update(p_label, p_version, p_changes jsonb)` (`name`,
`tone`), `board_label_delete(p_label, p_version)` (owner). Each owner write answers the row it changed as the reads give it.

## 5. Screens

Routes (static export; ids in the query): `/admin/projects` (the projects), `/admin/projects/view?id=<project>` (the
board, the list and the overview; `&card=<card>` opens a card's dialog, the home's and «مهامي»'s links),
`/admin/projects/mine` («مهامي»), `/admin/projects/archived` (owner: archived projects, and a project's archived cards at
`?id=<project>`). `/admin/projects/view` joins `isWidePath`. The rail's entry «المشاريع» stands after «الرئيسية» in the
first group, for every role. `StaffRole` and `ROLE_LABEL` (`TableList.tsx`) gain `board`.

- **The projects**: doors as the content home draws its collections (name; the card and overdue counts in words; the
  people), «مشروع جديد» (owner), «مهامي», «المشاريع المؤرشفة» (owner). Empty: section 7's sentences.
- **A project**: its title row; its people (owners and members, each with their role) and «الأشخاص والأدوار» (owner);
  one tools row: «بحث» with its field, «تصفية» opening the filters, the views «اللوحة»، «القائمة»، «نظرة عامة» (the
  last for owners and members; its activity part for owners only), «الأعمدة المخفية (n)» when n > 0, «بطاقة جديدة»
  (member).
- **The board**: columns from the start (right) edge in position order, scrolling inside their own box when more than
  fit; each column's name in Serif Display, its count, «خيارات» (owner: rename, hide, mark done, move, delete when it
  holds no open card); the done column's night head closed by the palm weave, with no «بطاقة جديدة في» button (cards
  arrive by a move); cards as lighter slips (title; «عاجل» the one accent, «منخفض» quiet, «عادي» unmarked; the due day,
  «اليوم», or the late wording in coral-deep words; label tags; «البنود n من m»; people's initials, each with the name as
  its accessible name; the link's title or «محتوى غير منشور»; in the done column «أُنجزت <day>»); «نقل إلى…» on every
  card at every width; «بطاقة جديدة في «…»» at a column's end (member).
- **Moving a card** (`@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities` if used, pinned exact, MIT, peers
  recorded): `MouseSensor` and `TouchSensor` (a 250 ms hold, tolerance 5 px, so a scroll is never a drag), not the
  pointer sensor (its `touch-action: none` would stop scrolling on cards); the keyboard sensor with Space to lift and drop
  and Escape to cancel (Enter opens the card), a coordinate getter that moves across columns in the reading direction
  (on a right-to-left page the right arrow goes to the previous column), Arabic `aria-roledescription` («بطاقة»), Arabic
  screen-reader instructions and announcements (section 7); and «نقل إلى…» (a menu of columns, then of positions), the
  one way that needs no drag, at every width. A lifted card casts the site's solid ink shadow over the dashed place it
  will land; with reduced motion nothing animates. Auto-scroll on a right-to-left board is proven in R4 (a drag to an
  off-screen column of a twelve-column board at 1440); if it fails, auto-scroll is turned off and the screen says
  nothing about it (the menu and the board's own scroll remain), recorded as a residual. A refused move (`STALE`, or the
  network) puts the card back, reads the project again, says so, and leaves the focus on the card.
- **A phone** (below 768px): one column at a time, a switcher with each column's name and count, the views kept, the
  filters behind «تصفية».
- **The card's dialog** (`<dialog>`; Escape closes; the focus returns to the card): title, priority, due day, people (the
  project's owners and members), labels, notes, the checklist («البنود»), the link (from `board_link_targets`), and, for
  owners, the card's own activity; «حفظ» (sends only what changed), «إغلاق», «أرشفة البطاقة». A `STALE` save keeps what
  was typed and shows the newer version beside it, with «احفظ نسختي» (sends the same changes on the newer version) and
  «اعتمد الأحدث».
- **The list view**: one table of the filtered cards (العنوان، العمود، الأولوية، الموعد، الأشخاص، الوسوم), sorted by due
  day (earliest first, none last) or by priority (urgent first, then by due day); at 480px and below, labelled cards.
- **The overview**: `board_overview`'s counts as sentences («لا عمود منجز في هذا المشروع» when it has none), then, for
  owners, the activity (50 at a time, «الأقدم») and «تصدير البطاقات (CSV)».
- **«مهامي»**: the caller's cards grouped «متأخرة»، «اليوم»، «هذا الأسبوع»، «لاحقًا»، «بلا موعد», each linking to its
  card; the landing page of the board-only role (its «متأخرة» and «اليوم» are their reminder).
- **The admin home**: «مواعيد المشاريع» (`board_due`) for every role but `board`, each card linking to it.
- **The people** (owner): the project's owners (fixed) and members, each member with a role select and «إزالة»;
  «إضافة شخص» from `board_staff`; a line pointing to the Team screen for someone new (role «لوحة المشاريع فقط»). The Team
  screen's invite message becomes true: the invite creates the account and sends no mail (`staff-admin`), so it says
  «أُنشئ الحساب. يدخل صاحبه من anas.studio/admin ببريده، ويصله رمز الدخول عندها.» in place of «أُرسلت الدعوة.».
- **States** on every screen: loading (a status line), empty (section 7's sentence and the way on), failed (the sentence
  and «إعادة المحاولة»), stale (as above); never a zero where a count could not be read. After an archive the focus goes
  to the next card of the column, or its «بطاقة جديدة في» button; after a menu move, to the moved card; «تراجع» stays
  until the next action (no timer).
- **The CSV** (owner): made in the browser from `board_export`; UTF-8 with a BOM; every cell quoted; a cell starting with
  `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`; the columns, in this order: العنوان، العمود،
  الأولوية، الموعد، الوسوم، الأشخاص، البنود، الملاحظات، مرتبطة بـ، مؤرشفة. Never stored.

## 6. Privacy and safety

Notes, titles and checklist text never reach the activity, the logs, Sentry or analytics; the CSV is the owner's, made
in the browser, never stored. People appear by display name only; no email reaches a member or a viewer. A board-only
person's rail and routes show nothing else of the admin, and the four policies (section 2) keep the catalogue and the
hidden posts from them; the functions, not the screens, are the wall (R1 calls every function as every role).

## 7. Words

- Names: «المشاريع»، «مشروع جديد»، «مهامي»، «المشاريع المؤرشفة»، «كل المشاريع»، «الأشخاص والأدوار»، «بحث»، «تصفية»،
  «اللوحة»، «القائمة»، «نظرة عامة»، «الأعمدة المخفية (n)»، «بطاقة جديدة»، «بطاقة جديدة في «…»»، «خيارات»، «نقل إلى…»،
  «حفظ»، «إغلاق»، «أرشفة البطاقة»، «استرجاع»، «تراجع»، «بند جديد»، «تصدير البطاقات (CSV)»، «إضافة شخص»، «إزالة»،
  «احفظ نسختي»، «اعتمد الأحدث»، «إعادة المحاولة»، «الأقدم»، «عمود جديد»، «إعادة تسمية»، «إخفاء العمود»، «إظهار العمود»،
  «عمود الإنجاز»، «نقل العمود»، «حذف العمود»، «أرشفة المشروع»، «حذف المشروع نهائيًا»، «وسم جديد»، «البطاقات المؤرشفة»،
  «سجل النشاط»; in «الأشخاص والأدوار», the line to the Team screen: «من ليس في الفريق بعد يُضاف من صفحة الفريق بدور «لوحة
  المشاريع فقط».».
- Fields: «اسم المشروع»، «اسم العمود»، «اسم الوسم»، «العنوان»، «الملاحظات»، «الأولوية»، «الموعد»، «الوسوم»، «الأشخاص»، «البنود»،
  «مرتبطة بـ»، «الدور»، «اللون». Roles: «مالك»، «مشارك»، «مُطّلع»، «لوحة المشاريع فقط». Priorities: «عاجل»، «عادي»،
  «منخفض». Tones: «زعفراني»، «مرجاني»، «رملي»، «باذنجاني». Filters: «الأولوية»، «الموعد» («متأخرة»، «اليوم»، «هذا
  الأسبوع»، «بلا موعد»)، «الوسم»، «الشخص»، «مرتبطة» («مرتبطة بمحتوى»، «غير مرتبطة»), each «الكل» by default; the sort:
  «ترتيب حسب الموعد»، «ترتيب حسب الأولوية».
- On a card: «اليوم»؛ a late card «متأخرة يومًا واحدًا» / «متأخرة يومين» / «متأخرة n أيام» (3 to 10) / «متأخرة n يومًا»
  (11 and more); «أُنجزت <day>»؛ «البنود n من m»؛ «مرتبطة بـ «<title>»»؛ «محتوى غير منشور».
- The overview: «في «<column>»: <cards>»؛ «متأخرة: <cards>»؛ «تستحق هذا الأسبوع: <cards>»؛ «أُنجزت في آخر سبعة أيام:
  <cards>»؛ «لا عمود منجز في هذا المشروع.»؛ «الأرقام تُعدّ من البطاقات نفسها، ولا تُقدَّر.»؛ «يُسجَّل ما تغيّر ومن غيّره،
  ولا يُنسخ نص الملاحظات إلى السجل.». The activity, one sentence per action: «<actor> أنشأ المشروع.»، «… غيّر اسم
  المشروع.»، «… أرشف المشروع.»، «… استرجع المشروع.»، «… أضاف <person> بدور <role>.»، «… جعل <person> <role>.»، «… أزال
  <person>.»، «… أضاف العمود «<column>».»، «… عدّل العمود «<column>» (<fields>).»، «… نقل العمود «<column>».»، «… حذف
  عمودًا.»، «… أضاف الوسم.»، «… عدّل وسمًا.»، «… حذف وسمًا.»، «… أنشأ «<card>».»، «… عدّل <fields> في «<card>».»، «… نقل
  «<card>» من «<from>» إلى «<to>».»، «… غيّر موضع «<card>» في «<to>».» (a move within its column)، «… أرشف «<card>».»، «…
  استرجع «<card>».»؛ a deleted column is «عمود محذوف»; the field names in <fields> are section 7's field words, joined
  with «و».
- Counts use `Intl.PluralRules('ar')` with every form: «لا بطاقات»، «بطاقة واحدة»، «بطاقتان»، «3 بطاقات»، «11 بطاقة»،
  «100 بطاقة»؛ the same for «متأخرة» (people: «لا أحد»، «شخص واحد»، «شخصان»، «3 أشخاص»، «11 شخصًا»).
- Empty: «لا مشاريع بعد. أنشئ أول مشروع.» (owner), «لم تُضَف إلى أي مشروع بعد.» (others); «لا بطاقات في هذا العمود.»؛
  «لا بطاقات تطابق البحث.»؛ «لا بطاقات لك الآن.» («مهامي»)؛ «لا مواعيد قريبة.» (the home)؛ «لا مشاريع مؤرشفة.»؛ «لا
  بطاقات مؤرشفة.».
- Answers: «أُرشفت البطاقة.» with «تراجع»؛ «تغيّرت هذه البطاقة منذ فتحتها؛ هذه نسختها الأحدث.»؛ «تعذّر نقل البطاقة؛
  أعدناها إلى مكانها.»؛ «تعذّر التحميل.»؛ «تعذّر الحفظ؛ أعد المحاولة.»؛ «لم يعد هذا المشروع متاحًا لك.» (`NOT_FOUND` when a project is read; a write refused `NOT_FOUND` on a card or a column
  that is gone says the write's own failure, «تعذّر الحفظ؛ أعد المحاولة.» or «تعذّر نقل البطاقة؛ أعدناها إلى مكانها.», and the
  reading after it says «لم يعد…» if the project went too)؛
  «ليس لدورك أن يفعل هذا.» (`FORBIDDEN`)؛ «لا يُحذف عمود فيه بطاقات؛ انقلها أولًا.» (`NOT_EMPTY`; for the project's only
  column, which can hold archived cards alone: «هذا آخر عمود في المشروع، وفيه بطاقات مؤرشفة؛ أضف عمودًا قبل حذفه.»)؛ for `LIMIT`: «بلغ
  المشروع أقصى عدد من الأعمدة (12).»، «… من الوسوم (16).»، «… من الأشخاص (30).»، «… من البطاقات المفتوحة (1000).»،
  «للبطاقة 10 أشخاص على الأكثر.»، «للبطاقة 50 بندًا على الأكثر.»، «بلغت المشاريع المفتوحة أقصى عددها (50).»؛ for
  `INVALID`, under its field: «اكتب اسمًا.»، «اكتب عنوانًا.»، «النص أطول من المسموح.»، «تاريخ غير صالح.»، «لا يُقبل نص
  فيه رموز تحكم.»؛ the delete confirmation: «يُحذف المشروع وكل بطاقاته نهائيًا، ولا يمكن التراجع. اكتب اسم المشروع
  للتأكيد.» with «حذف نهائي».
- The keyboard and screen readers: instructions «لنقل بطاقة: المسافة ترفعها، والأسهم تنقلها، والمسافة تُفلتها، و Escape
  يلغي النقل.»؛ «رُفعت البطاقة «<card>».»؛ «البطاقة في «<column>»، الموضع n من m.»؛ «وُضعت البطاقة في «<column>».»؛
  «أُلغي النقل.».
- Settled with R2's audit (`RECORD-R2.md`): «يحمّل...» (loading); «الأعمدة» (the phone's switcher); «خيارات العمود <column>»
  (the ⋯ button's name); «نقل إلى… «<card>»» (the move button's name); «لا بطاقات.» (a project with no column); a tile's
  late count «بطاقة واحدة متأخرة»، «بطاقتان متأخرتان»، «n بطاقات متأخرة»، «n بطاقة متأخرة»; the people past the row's first
  «و<people>» («و453 شخصًا»); «الموضع n من m» (the menu's places); «بند n» (a checklist row's name); «نعم» and «لا» (the
  CSV's «مؤرشفة»); «غير مرتبطة» (a card with no link); and from the comp: «تُفلت البطاقة هنا» (the dashed place a lifted
  card will land) and «الربط لا ينشر شيئًا ولا يغيّر حالة المنشور أو الغرفة.» (under «مرتبطة بـ»).
- The home: «مواعيد المشاريع». The dialog's title: «بطاقة: <title>». The tiles: «<cards>»، «<late> متأخرة»
  (coral-deep)، the people in words («أنس وشخصان»).

## 8. Rounds and proof

- **R1, the data:** the role migration (its own file), the board migration (schema, tables, helpers, functions, grants,
  and the four policies of section 2 recreated with named roles), `staff-admin` and `_shared/staff.ts` taking `board`;
  integration tests calling every function as anon, an `editor`, an `operations`, a `board` person not on the project, a
  `viewer`, a `member` and an owner (each allowed or refused as section 2 says); a `board` token reading no draft
  product, no variant, no disabled rate and no hidden post; `Accept-Profile: board` refused; versions (`STALE`), the
  lock order and races (two creates in one column, two column creates at 11, a removal against an assignment); every
  write's one activity row with no text; the limits; `done_at`; deletes and archives; a viewer never receiving a draft
  title; removal and deactivation taking access away at once and reactivation bringing it back.
- **R2, the board:** the routes, the shell's gate for `board`, the allow-lists of `TableList.tsx`, `TableForm.tsx` and
  `StoreHome.tsx`, `SignIn.tsx` sending `board` to «مهامي», the projects, the board and the card's dialog, moving cards
  (mouse, touch, keyboard, the menu), the phone's single column; `src/lib/projects.ts`'s pure parts (search, filters,
  sorting, the reading-direction keyboard mapping, positions, the late-day wording, the CSV) with unit tests.
- **R3, around it:** the list view, the overview and the activity, «مهامي», the admin home's panel, the CSV, hidden and
  done columns, labels, the people and the Team screen's `board` role and its true invite line.
- **R4, the proof:** `tests/e2e/projects.spec.ts` at 360 and 1440 (each control used: mouse, keyboard and «نقل إلى…»
  moves on a right-to-left board, touch at 1024 with `hasTouch`, a drag to an off-screen column of a twelve-column board,
  a stale move and a stale save, a hidden column hidden again after a reload, moves kept after a reload, done and hidden
  columns, filters returning exactly the matching cards, the overview's counts equal to the rows, the CSV, each role's
  view, the board-only role's gate); a canary card title absent from `out/`, the sitemap and any public search; axe with
  no critical or serious finding on the board, the dialog and the list; `docs/projects-guide.ar.md` (Anas's guide, in
  Arabic); the budgets (the public pages must not change).

Each round has a fresh `sonnet-worker` and a fresh Opus `auditor`; the orchestrator reads every SQL line, rules on the
findings and runs the checks.

## Rulings on version 1's audit (`contract-audit-1.md`)

Every finding is accepted and settled above: P12C-01 (section 2, "The wall outside the board", and R1/R2), -02 (the
refusal rule, section 4's table and signatures), -03 (`board_project` carries notes and the checklist, so search runs in
the browser), -04 (`board_link_targets` and the title rule), -05 (members only; demotion clears), -06 (the board-only
role lands on «مهامي»; the home's panel for the others), -07 (locks and versions rule, deferrable uniques, R1's races),
-08 (people are active owners and members; deactivation keeps rows; `board_staff`), -09 (deletes and restores, section
3), -10 (one week, `done_at`, the exclusions), -11 («نقل إلى…» at every width), -12 (the CSV rules), -13 (section 7,
and the rule for a missing word), -14 (the sensors, the codes, the Arabic texts, the auto-scroll proof and its
fallback), -15 (the activity's columns and actions), -16 (the caps), -17 (schema privileges and `Accept-Profile`), -18
(R4's restored proofs), -19 (routes, `isWidePath`, the rail's entry, `StaffRole`, the worker file rule, D50's no-copy),
-20 (only changed fields are sent), -21 (no Realtime, focus, «تراجع» without a timer, nothing in the address or
`localStorage`), -22 (the Team screen's line), -23 (the words), -24 (D52 records the approval), -25 (the plan records
follow at P12's start); the nits are taken in section 7. The open questions: the activity log is the owner's (the owner,
2026-10-16: «Owner only»); a viewer is never assigned (D52: «Yes, to members (Recommended)»); the preview is approved (D52).
