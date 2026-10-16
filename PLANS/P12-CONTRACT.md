# P12 contract: «لوحة المشاريع»

Version 1 (2026-10-16). Written by the orchestrator (Opus 5.5) from D22, D50 and D52, before any worker round. Its first audit (2026-10-16, `artifacts/acceptance/P12/contract-audit-1.md`) answered `audit_failed` (one blocking finding: the new `board` role would read draft products, variants, disabled rates and hidden posts through four policies that admit any staff role); version 2 settles every finding before R1, and no worker reads version 1. The design
is the preview the owner was shown in the Build Ledger on 2026-10-16 (its comp: `artifacts/acceptance/P12/comp/`). Every
worker and auditor of P12 reads this file first; where it and `PLANS/WORK-PACKAGES.md` (P12) differ, this file wins, since
D52 widened the package after that text was written.

Rules that hold for every round:

- The board is private to the people the owner puts on it. Nothing of it is public: no anon grant, no static page with
  its data, no sitemap entry, no analytics or error reporting of its text; the admin's `robots` rule covers its routes.
- All board data lives in the schema `board`, which the Data API does not expose. The browser reads and writes it only
  through `public.board_*` functions: `security definer`, owned by `postgres`, `set search_path = ''`, fully qualified,
  `revoke all ... from public, anon` and `grant execute ... to authenticated`, each rechecking the caller from `auth.uid()`
  (an active staff row, then the project access in section 2) before anything else. No table of `board` is granted to a
  client role, and RLS is on for every one of them with no policy (deny all), as a second wall.
- Every write takes the row's `version` the screen read and raises `unique_violation` (23505) with the code `STALE` when
  it moved; it writes one `board.activity` row in the same transaction. No activity row holds a card's text: field names
  only (section 3).
- Text fields refuse control characters (U+0000 to U+001F, U+007F to U+009F; the notes allow line feeds) and have the
  lengths section 3 gives, in characters, checked in SQL and before the press.
- Linking a card to content never creates, changes or publishes content: it stores a reference (section 3) and reads a
  title. Publishing stays the content screens' explicit action.
- Dates are calendar days in Riyadh (`riyadh-day.ts`'s rule), shown with Latin digits; times in the activity are Riyadh
  times.
- The screens follow DESIGN.md section 10 (the admin) and the comp; Arabic copy is section 7's, word for word.

## 1. Scope

In (D22, D50, D52): several projects, each with its own free-form columns (named by the owner; one may be marked done;
a column may be hidden and shown on demand); cards with a title, notes, a priority («عاجل»، «عادي»، «منخفض»), an
optional due day, labels in the palette's tones, a checklist, the project's people assigned, and an optional link to a
post or a room document; search (title, notes, checklist) and filters (priority; due: overdue, today, this week, none;
label; person; linked or not); a board view and a list view sorted by due day or priority; each project's overview from
its real rows and its activity log; archive and restore of cards and projects, with an undo after archiving; a project's
cards exported to CSV (the owner); «مهامي» (each person's assigned cards across projects); the admin home's due cards.

Out (D22, D50, D52): notifications to anyone, mail of any kind, automations or rules, swimlanes, external tools, a
project manager role, comments, attachments, time tracking, dependencies between cards.

## 2. People and access

- **The owner** is any active staff member whose role is `owner`. An owner sees and does everything on every project,
  archived ones included, and alone creates, renames, archives, restores and deletes projects, adds and removes people,
  sets their roles, manages columns and labels, and exports.
- **A project's people** are rows of `board.members`: an active staff member (any role) with the project role `member`
  («مشارك»: adds cards, edits them, moves them, archives and restores them, ticks the checklist) or `viewer` («مُطّلع»:
  reads only). An owner needs no row.
- **The board-only role.** `public.staff_role` gains `board` («لوحة المشاريع فقط»): staff the owner invites from the
  Team screen for the board alone. Such a person sees only «المشاريع» and «الأمان» in the rail, and only the projects
  they are on. Every existing policy, function and Edge Function action that names roles keeps naming them: `board`
  gets nothing outside the board (R1 lists every `current_staff_role()` use and every role list it checked).
- A person removed from a project, or whose staff row is deactivated, loses the project at once (every function reads
  access fresh) and is taken off its cards.
- Access is checked in one SQL helper, `board.access(p_project uuid) returns text` (`'owner'`, `'member'`, `'viewer'` or
  null), used by every function; a null answer is `NOT_FOUND` (a project the caller may not see does not exist for them).

## 3. Schema (`board`)

| Table | Columns | Rules |
|---|---|---|
| `projects` | `id uuid pk`, `name text`, `created_by uuid`, `created_at`, `updated_at`, `archived_at timestamptz null`, `version int` | name 1 to 80 characters |
| `members` | `project_id`, `user_id`, `role text`, `added_by`, `added_at` | pk (project, user); role in (`member`, `viewer`); user is a staff member |
| `columns` | `id`, `project_id`, `name`, `position int`, `hidden bool`, `is_done bool`, `version int` | name 1 to 40; at most one done column per project (partial unique index); at most 12 columns per project |
| `labels` | `id`, `project_id`, `name`, `tone text` | name 1 to 24, unique per project (case folded); tone in (`saffron`, `coral`, `sand`, `aub`); at most 16 per project |
| `cards` | `id`, `project_id`, `column_id`, `position int`, `title`, `notes text`, `priority text`, `due_on date null`, `link_collection text null`, `link_doc_id text null`, `created_by`, `created_at`, `updated_at`, `archived_at null`, `version int` | title 1 to 200; notes 0 to 5,000; priority in (`urgent`, `normal`, `low`), default `normal`; link both null or both set, collection in (`posts`, `rooms`) and the document exists when linked |
| `card_labels` | `card_id`, `label_id` | the label is the card's project's |
| `card_people` | `card_id`, `user_id` | the person has access to the card's project |
| `checklist` | `id`, `card_id`, `text`, `done bool`, `position int` | text 1 to 200; at most 50 items per card |
| `activity` | `id bigint identity`, `project_id`, `card_id null`, `actor uuid`, `at timestamptz`, `action text`, `fields text[]`, `from_column uuid null`, `to_column uuid null` | action in (`project_created`, `project_renamed`, `project_archived`, `project_restored`, `person_added`, `person_role_changed`, `person_removed`, `column_created`, `column_changed`, `column_moved`, `column_deleted`, `card_created`, `card_edited`, `card_moved`, `card_archived`, `card_restored`); `fields` holds field names only (`title`, `notes`, `priority`, `due_on`, `labels`, `people`, `checklist`, `link`) |

Positions are dense integers per column (cards) and per project (columns): a move renumbers the rows it passes, in one
transaction, under a lock on the project row (one lock order: the project, then the column or columns, then the cards
in ascending id). Deleting a column is allowed only when it holds no card, archived ones included. A project is deleted
only after it is archived, by the owner, with its rows.

## 4. Functions (`public.board_*`)

Reads (any project access; `viewer` included):
- `board_projects()`: the caller's projects (owners: all), each with its name, archived flag, card count, overdue count
  and people count.
- `board_project(p_project)`: the project with its columns (hidden ones flagged), labels, people (display name and
  project role) and non-archived cards (id, column, position, title, priority, due day, label ids, people ids, checklist
  done and total, link and the linked document's title, version); no notes.
- `board_card(p_card)`: one card in full (its notes and checklist items too) and its own activity (the newest 50).
- `board_archived(p_project)`: the archived cards (title, column, archived at), for restore.
- `board_mine()`: the caller's assigned, non-archived cards across their projects, with project and column names.
- `board_overview(p_project)`: cards per column, overdue (due before today, not in the done column), due in the next 7
  days, and done in the last 7 days (cards moved into the done column then, still there): counted from the rows.
- `board_activity(p_project, p_before bigint null)`: 50 rows, newest first, with the actor's display name and the
  column names.
- `board_due()`: for the admin home, the caller's due cards (owners: every project's; others: the cards assigned to
  them): overdue and due in the next 7 days, at most 20.

Writes (`member` or owner unless marked; a `viewer` gets `FORBIDDEN`): `board_card_create(p_column, p_title)`,
`board_card_update(p_card, p_version, p_changes jsonb)` (any of title, notes, priority, due_on, label ids, people ids, the
whole checklist as an ordered list, link), `board_card_move(p_card, p_version, p_column, p_position)`,
`board_card_archive(p_card, p_version)`, `board_card_restore(p_card)`. Owner only: `board_project_create(p_name)`,
`board_project_rename`, `board_project_archive`, `board_project_restore`, `board_project_delete`, `board_person_set(p_project,
p_user, p_role)`, `board_person_remove`, `board_column_create`, `board_column_update` (name, hidden, done), `board_column_move`,
`board_column_delete`, `board_label_create`, `board_label_update`, `board_label_delete`, `board_export(p_project)` (every
card with its notes, for the CSV), `board_staff()` (the active staff the owner can add).

Refusals are `raise` with a code the screen maps to section 7's words: `NOT_FOUND`, `FORBIDDEN`, `STALE`, `INVALID`
(with the field), `LIMIT` (the counts in section 3), `NOT_EMPTY` (a column with cards).

## 5. Screens

- `/admin/projects`: the projects as the content home's doors (name; card and overdue counts; people), «مشروع جديد»
  (owner), «مهامي», «المشاريع المؤرشفة» (owner).
- `/admin/projects/view?id=`: the project (static export: the id in the query). Its title row; its people with their
  roles and «الأشخاص والأدوار» (owner); one tools row (search with its label, «تصفية» opening the filters, the views
  «اللوحة»، «القائمة»، «نظرة عامة», «عمود مخفي (n)», «بطاقة جديدة»); then the view.
- **The board.** Columns from the start (right) edge in position order, scrolling inside their own box when more than
  fit; each column's name in Serif Display, its count, «خيارات» (rename, hide, mark done, move, delete when empty; owner);
  the done column's night head closed by the palm weave; cards as lighter slips (title; «عاجل» as the one accent, «منخفض»
  quiet, «عادي» unmarked; the due day, «اليوم», or «متأخرة …» in coral-deep words; label tags; checklist «n من m»;
  people's initials, each with the name as its accessible name; «مرتبطة بـ …»); «بطاقة في «…»» at a column's end.
- **Moving a card** (`@dnd-kit/core` and `@dnd-kit/sortable`, pinned exact versions, MIT): pointer, touch (a 250 ms hold,
  so a scroll is never a drag) and keyboard (Space lifts, the arrows move it in reading order: on a right-to-left page
  the right arrow goes to the previous column, Space drops, Escape cancels), each step announced in Arabic in a live
  region; and «نقل إلى…» on every card (a menu of columns, then a position), the only way on a phone. A lifted card casts
  the site's solid ink shadow over the dashed place it will land; nothing animates with reduced motion. A refused move
  (`STALE`) puts the card back, reads the project again and says so.
- **A phone** (below 768px): one column at a time, a switcher with each column's name and count, the views kept, the
  filters behind «تصفية».
- **The card's dialog** (`<dialog>`, Escape closes, the focus returns to the card): every field, the checklist, the link
  (a post or a room, by title), its own activity, «حفظ», «إغلاق», «أرشفة البطاقة». A `STALE` save keeps what was typed
  and shows the newer version beside it with «احفظ نسختي» and «اعتمد الأحدث».
- **The list view**: one table of the filtered cards (title, column, priority, due, people, labels), sorted by due day or
  priority; at 480px and below, cards (DESIGN.md's tables).
- **The overview**: section 4's counts as sentences, then the activity, then «تصدير البطاقات (CSV)» (owner).
- **«مهامي»** (`/admin/projects/mine`): the caller's cards grouped «متأخرة»، «اليوم»، «هذا الأسبوع»، «لاحقًا»، «بلا موعد».
- **The admin home**: «بطاقات حان موعدها» (section 4's `board_due`), each linking to its card.
- **The people** (owner): the project's people with a role select each and «إزالة»; «إضافة شخص» from the active staff;
  a line pointing to the Team screen to invite someone new for the board alone (role «لوحة المشاريع فقط»).
- **States** on every screen: loading (a status line), empty (the sentence of section 7 and the way on), failed (the
  sentence and «إعادة المحاولة»), stale (as above); never a zero where a count could not be read.

## 6. Privacy and safety

Notes, titles and checklist text never reach the activity, the logs, Sentry or analytics; the CSV is the owner's, made
in the browser, never stored. Display names come from the staff directory; no email is shown to a `viewer` or a
`member`. A board-only person's rail and routes show nothing else of the admin; the functions, not the screens, are the
wall (R1's tests call every function as every role).

## 7. Words

Screen and control names: «المشاريع»، «مشروع جديد»، «مهامي»، «المشاريع المؤرشفة»، «كل المشاريع»، «الأشخاص والأدوار»،
«بحث»، «تصفية»، «اللوحة»، «القائمة»، «نظرة عامة»، «عمود مخفي (n)»، «بطاقة جديدة»، «بطاقة في «…»»، «خيارات»، «نقل إلى…»،
«حفظ»، «إغلاق»، «أرشفة البطاقة»، «استرجاع»، «تراجع»، «بند جديد»، «تصدير البطاقات (CSV)»، «إضافة شخص»، «إزالة»،
«احفظ نسختي»، «اعتمد الأحدث»، «إعادة المحاولة». Fields: «العنوان»، «الملاحظات»، «الأولوية»، «الموعد»، «التصنيفات»،
«الأشخاص»، «القائمة»، «مرتبطة بـ». Roles: «المالك»، «مشارك»، «مُطّلع»، «لوحة المشاريع فقط». Priorities: «عاجل»، «عادي»،
«منخفض». Sentences: «لا مشاريع بعد. أنشئ أول مشروع.» (owner) and «لم تُضَف إلى أي مشروع بعد.» (others); «لا بطاقات في
هذا العمود.»; «لا بطاقات تطابق البحث.»; «أُرشفت البطاقة.» with «تراجع»; «غيّر أحدٌ هذه البطاقة قبلك؛ هذه نسخته.»; «تعذّر
التحميل.»; «الربط لا ينشر شيئًا ولا يغيّر حالة المنشور أو الغرفة.»; «يُسجَّل ما تغيّر ومن غيّره، ولا يُنسخ نص الملاحظات إلى
السجل.»; «الأرقام تُعدّ من البطاقات نفسها، ولا تُقدَّر.». The keyboard's announcements: «رُفعت بطاقة «…». الأسهم تنقلها،
والمسافة تُفلتها، و Escape يلغي.»؛ «البطاقة في «…»، الموضع n من m.»؛ «وُضعت البطاقة في «…».»؛ «أُلغي النقل.». Counts use
`Intl.PluralRules('ar')` forms («بطاقة واحدة»، «بطاقتان»، «3 بطاقات»، «11 بطاقة»).

## 8. Rounds and proof

- **R1, the data:** the role migration (its own file: `alter type public.staff_role add value 'board'`), the board
  migration (schema, tables, helper, functions, grants), `staff-admin` and `_shared/staff.ts` taking `board`; integration
  tests calling every function as anon, an `editor`, an `operations`, a `board` person not on the project, a `viewer`, a
  `member` and an owner (each allowed or refused as section 2 says), versions (`STALE`), the lock order, every write's one
  activity row with no text in it, the limits, a link that leaves the linked document's status and versions unchanged,
  removal and deactivation taking access away at once.
- **R2, the board:** the routes, the projects, the board and the card's dialog, moving cards (pointer, keyboard, the menu),
  the phone's single column, the rail and its role gate; unit tests of the pure parts (`src/lib/projects.ts`: search,
  filters, sorting, the right-to-left keyboard mapping, positions).
- **R3, around it:** the list view, the overview and the activity, «مهامي», the admin home's panel, the CSV, hidden and
  done columns, labels, the people and the Team screen's board role.
- **R4, the proof:** `tests/e2e/projects.spec.ts` at 360 and 1440 (each control used: pointer, touch and keyboard moves on
  a right-to-left board, the menu, a stale move and a stale save, hidden and done columns, filters returning exactly the
  matching cards, the overview's counts equal to the rows, the CSV, each role's view), axe with no critical or serious
  finding on the board, the dialog and the list, `docs/projects-guide.ar.md` (Anas's guide, in Arabic), and the budgets
  (the admin is outside the public budget; the public pages must not change).

Each round has a fresh `sonnet-worker` and a fresh Opus `auditor`; the orchestrator reads every SQL line, rules on the
findings and runs the checks. Before R1, a fresh Opus auditor reads this contract against D22, D50, D52, the comp and
the code it touches.
