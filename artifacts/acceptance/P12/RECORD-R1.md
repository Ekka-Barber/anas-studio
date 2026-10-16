# P12, round R1: the record

Started under the owner's word of 2026-10-16 ("you build it , send workers with the plan"), once the design was approved
and the contract, version 2, settled after its own audit (D52). Orchestrator Claude Opus 5.5 at effort max, on the owner's
machine. The lock moved from RESIDUALS-1 to P12 on 2026-10-16 (13:51:12Z, round R1, base `3578e4f`), with R1's 11 exact
paths; RESIDUALS-1 waits inside it (`paused`) and resumes at R4b. The shared checkout cannot switch branches, so P12
commits on `agent/residuals-1` too. Committed under the same word: the code first, these records in the commit after it,
by explicit path; the branch pushed for CI.

## Scope

The contract's section 8, R1: the role migration (`board`, a file of its own), the board migration (the schema `board`,
its tables, helpers and `public.board_*` functions, the grants, and the four policies that admitted any staff role
recreated with the roles named), `staff-admin` and `_shared/staff.ts` taking `board`, and the integration tests: every
function called as every kind of caller, versions, the lock order and the races, the activity, the limits, `done_at`,
deletes and archives, the links' titles, removal, deactivation and demotion, and the wall a board-only token meets.

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 91 minutes, 141 tool calls. New: the two migrations (the enum
value; 1,998 lines for the schema, 9 tables, 20 helpers, 29 functions and the 4 policies), `tests/integration/board.test.ts`
(90 tests) and `board-wall.test.ts` (9). Changed: `staff-admin/index.ts` and `_shared/staff.ts` (the role in their sets),
`tests/integration/support.ts` (the `Role` type), `staff.test.ts`, `staff-admin.test.ts` (2 tests: the admin function's 16
actions answer a board token 403), `tests/unit/staff-admin-function.test.ts`, `docs/development.md` (one line). Its 12
decisions inside the contract, ruled below with the audit: a write that changes nothing bumps and logs nothing (a stale
version still wins); restores take no version but bump the row's; an archived card's edit or move is NOT_FOUND after the
version check; INVALID's detail empty where the contract names no field; a new project has no columns, and the only column
holding archived cards cannot be deleted; `board_mine` leaves out archived projects; the caps; `done_at`; the locks (the
project row first, its access checked again once held; an advisory lock for the cap of 50 projects); the link rule; names
from `public.staff.display_name`, `auth.users` never read; arrays in `p_changes` capped at 100. Its checks: lint,
typecheck, copy (237 files), frozen (50) 0; unit 71 files, 2,764 passed and 39 skipped; `supabase migration up --local` 0
on top of the old policies; each file applied twice in one transaction with the catalogue's fingerprint unchanged; the full
database suite 33 files, 1,045 passed (a first run lost two 5-second timeouts in `outbox.test.ts` while two other runs
loaded the machine; alone, 41 of 41); six mutations, each caught (the products policy back to `is not null`, the card
update's version check, a viewer let into `board.enter`, a card's title logged with the fields check dropped, the link's
title and the link's target always privileged).

## 2. The audit and the fixes

The orchestrator read every SQL line of both migrations and diffed the four policies against their definitions
(`20260927160000_catalog_and_checkout.sql:269-270, 290-291, 321-322`, `20260930120000_audit_fixes.sql:52-58`): each
changed only `is not null` to `in ('owner', 'editor', 'operations')`. It found findings 1 and 2 below on its own reading.

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R1.md`), 20 minutes, 54 tool calls: **audit_failed**, on two
major findings, three minor and four nits, none blocking; the wall, the refusal transport, versions, locks, limits,
`done_at`, positions, links and privileges hold. It checked the wall outside the board: no other policy or SQL role check
admits any staff role (`finance.require_staff` names owner and operations; the content checks name owner and editor); the
33 functions granted to `authenticated` outside the board each name their roles (`catalog_availability` is public, and
`media_rename_folder` runs as the caller under the media policy); `storage.objects` has no policy; only `staff-admin` and
`_shared/admin.ts` use `_shared/staff.ts`, and all 16 admin actions name owner, or owner and editor; `staff-admin` is
owner-only; `config.toml` exposes `public` alone. It agreed with ten of the writer's decisions, split one (7) and
disagreed with part of another (11: finding 2).

| Finding | Severity | Ruling | Done by the orchestrator |
|---|---|---|---|
| 1: `column_created`, `column_changed` and `column_moved` rows carry no column, so section 7's «أضاف العمود «…»», «عدّل العمود «…»» and «نقل العمود «…»» cannot be written | major | Accepted | each logs its column as `to_column`; the step test and `board_activity` assert it |
| 2: `person_added` and `person_role_changed` rows hold no role, though «أضاف <person> بدور <role>» and «جعل <person> <role>» name it, and the log is history | major | Accepted; the contract amended (sections 3 and 4) | `board.activity.role` (`member` or `viewer`, a check), set by `board_person_set`, returned by `board_activity` as `role`; a check refuses any other value; tests |
| 3: the cap of 10 people per card leaves out a deactivated person's kept assignment, so reactivation can show 11 | minor | Ruled the other way: a cap counts the people the screens show (counting a hidden one would refuse a 10th person while 9 show, with nothing on screen to explain it); the contract amended (section 3): a reactivated person returns even past the cap, and the next save of the card's people must come back within it | the comment says so; a test: deactivated, out of the count; reactivated, 11 shown; a save of the 11 refused with `LIMIT card_people`; a save of 10 accepted |
| 4: the access check after the lock (`board.enter`'s second pass) has no test | minor | Accepted | four tests: a write queued behind the project lock whose caller is removed, made a viewer, deactivated or shut out by an archive meanwhile is refused (`NOT_FOUND`, `FORBIDDEN`), the card and the log unchanged; the wait is on the holder's own pid (`pg_blocking_pids`) |
| 5: a demoted owner's kept assignments: no test shows them leaving «مهامي» and the home | minor | Accepted | the demotion test assigns the owner first; after it, `board_mine` and `board_due` answer nothing, the row kept |
| 6: the cap of 50 projects is tested in sequence only, so its advisory lock could go unnoticed | nit | Accepted | two creates at 49 queued behind the held advisory lock: one makes the fiftieth, the other `LIMIT projects` |
| 7: section 4 says `board_person_set` refuses "the 30th" | nit | Accepted | "the 31st" |
| 8: `NOT_EMPTY` for the project's only column, which can hold archived cards alone, would say «انقلها أولًا» about cards the board does not show | nit | Accepted | section 7 gains «هذا آخر عمود في المشروع، وفيه بطاقات مؤرشفة؛ أضف عمودًا قبل حذفه.» |
| 9: the cap of 30 people counts inactive members' rows, which no owner read lists, so an owner at the cap cannot see whom to remove | nit | Settled by finding 3's rule | the cap counts the active members who are not owners (the people the owner sees); a test: an inactive member frees a place, and reactivated may pass 30, after which nobody new is added |
| Decision 6: "projects they can see" includes archived ones for owners | note | Accepted | section 4: `board_mine` covers projects that are not archived |
| The orchestrator's: a move within its column logs `card_moved` with `from` equal to `to` | — | — | section 7 gains «… غيّر موضع «<card>» في «<to>».» for R3 |
| The orchestrator's: `board_export`'s comment said the archived cards come newest first; the order groups them by column first | nit | — | the comment matches the order |
| Not covered (the audit's list): the first column deleted while it holds archived cards | — | — | a test: they go to the column first after it, and a restore lands there |

The orchestrator's mutations on the fixed tree, each applied to the local database, the named tests run, then the real
migration applied again: (A) `board.enter` with one pass, the projects' advisory lock removed from `board_project_create`,
and `column_created` without its column: the six targeted tests failed (the four queued writes, the race at 49, the
activity steps); (B) the person rows without their role: the activity steps failed; (C) the cap of 30 counting every
`members` row: the people-cap test failed.

What no test covers, recorded: a late «تراجع» restoring a card someone archived again since (a restore takes no version,
by the contract); a deactivation committed by `staff-admin` while that person's write waits on the project lock (the
deactivation does not take the lock, so that one write may finish; the next is refused); the hosted project's Data API
must not expose `board` (`config.toml` keeps it out locally; a launch check for P11).

## 3. Checks on the final tree

- The local database rebuilt from the fixed file: `drop schema board cascade`, then the migration applied twice in one
  transaction, exit 0 (the file stays idempotent).
- `tests/integration/board.test.ts` and `board-wall.test.ts`: 105 of 105 (99 before the fixes, 6 added).
- lint, copy, frozen 0; typecheck 0 after one fix (the first run, exit 2: the activity test's `Want` type lacked the new
  `role`); unit 71 files, 2,764 passed and 39 skipped.
- `pnpm test:db` (local stack): 33 files, 1,053 of 1,053.
- Not run: e2e, build, export and budgets (R1 changes no screen and no public page; R2 runs them); a Deno type check (no
  Deno here: the two Edge Function edits only widen a union and a set; the edge runtime was restarted after them, and
  `staff-admin.test.ts` ran in the suite against it).
