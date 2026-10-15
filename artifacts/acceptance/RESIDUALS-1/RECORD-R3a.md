# RESIDUALS-1, round R3a: the record

Started under the owner's word to go ahead with the plan's next work (2026-10-15), after R2b was committed and pushed.
Orchestrator Claude Opus 5.5 at effort max, on the owner's machine. The lock moved from R2b to R3a on
2026-10-15T20:10:59Z (base `ddde58e`), with R3a's 19 exact paths; added later, with the reason in the lock:
`docs/operations.md` (the two paragraphs the round made stale). Committed under the same word: the code first, these
records in the commit after it, by explicit path; the branch pushed for CI; the lock kept for R3b.

## Scope

R3a is the first half of R3 (`SCOPE.md`; R3's 20 entries split by screen family, since R3b shares R2b's screens): the
admin's content screens, the owner home and the email screen, with no SQL and no Edge Function: ADMIN-CMS-05, -06, -10,
-12, -13, -14, -16, -18, -23 and QUALITY-12. The decided fixes are in `brief-R3a.md`.

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 71 minutes, 172 tool calls: all 10 items in 14 files
(`src/admin/fields.ts`, `src/admin/richtext.ts`, `CollectionForm.tsx`, `RichTextEditor.tsx`, `FieldInput.tsx`,
`CollectionList.tsx`, `PublishBar.tsx`, `AdminHome.tsx`, `EmailView.tsx`, four unit files and `tests/e2e/cms.spec.ts`).
Its choices, ruled below: the slug note and the preview sentence are `.message` lines with `role="status"`, mounted only
when shown; the 23505 sentence follows the entry's link; a failure whose document is not found stays, titled «بلا
عنوان»; `ATTENTION_CAP` lives in `EmailView.tsx` and the home imports it. Its checks: lint, typecheck, copy, frozen 0;
unit 2,683 passed and 39 skipped; build, export and budgets green; e2e with its own dev server, one file at a time:
`cms.spec.ts` 14 of 14 (10 new tests), `owner-operations.spec.ts` 21 of 21, `media.spec.ts` 8 of 9 (below); mutations for
items 2, 5 and 9, each caught.

## 2. The orchestrator's look

The changed screens at 360 and 1440 px (a scratch Playwright script, git-ignored): the room editor with an unsaved edit
(«احفظ أولًا لترى تعديلاتك في المعاينة.» after «معاينة» at 1440, under it at 360; «نشر» off), the rooms list with its
read failing (the error, then the titles alone: cards at 360, a one-column table at 1440; no «مسودة لم تُنشر»), the
posts list as it loads. Nothing overflows. `docs/operations.md`: the owner home's failed-schedule line (titled, the
newest failure per document, dropped once the document is live at that version or a later one, the slug reason) and the
email screen's 200-row note.

## 3. The audit and the fixes

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R3a.md`): **pass**, with one minor finding and two nits.
Its rulings on the writer's choices, all accepted: only a root holding one empty paragraph becomes the empty body
(nothing drawn is lost; an emptied heading or list still counts as a change, as decided); the reloading flag is set
before the first await and cleared on every end, a superseded load leaving it to the newer one; the slug read fails
closed (no note); the home drops a failure only when its seq is known and the document is live at it or later.

| Finding | Severity | Ruling | Done by the orchestrator |
|---|---|---|---|
| M1: after every reload the last «تم الحفظ.» was announced again (the status line falls back to it) | minor | Accepted | a reload clears the save message |
| N1: the live slug read fetched the whole live version | nit | Accepted | `.select('slug:data->>slug')` |
| N2: a fresh list item whose form presets a choice (a home door, a scene) asked before «حذف» | nit | Accepted | `deleteAsks`: asks only about an item that holds text and differs from what «أضف عنصرًا» made; unit tests |
| Adjacent, older than the round: «نشر» stays clickable during the reload after a restore and would publish the version from before it (`seq` not yet read again) | — | Accepted | the publish bar takes `reloading` and lets nothing be pressed until the reload ends; a unit test |

What no test covers, recorded: what `ignoreSelectionChange` alone protects (a click into a body whose stored JSON
differs from Lexical's own); a reload that fails or is superseded, and keys typed as a field turns inert; the slug read
failing, an archived post, a saved but unpublished slug change; the home's failed-schedule wiring end to end (its pure
functions are tested) and the email note rendered at 200 rows (its condition is tested); list items holding selects or
images; the taxonomies' failure state; a screen reader's reading of the new notes (they are `role="status"` regions
mounted when shown, as eight existing admin regions are). Old article addresses are not redirected (no `_redirects`):
not built, as the brief decided.

## 4. Checks on the final tree

- lint, typecheck, copy, frozen 0; unit 71 files, 2,686 passed and 39 skipped.
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` 0 (`checkout.html` 149.7 KiB, `orders.html` 148.4 KiB, of 150).
- `cms.spec.ts` after the fixes (the editor, the bar and the list items): 14 of 14.
- `pnpm test:db` not run again: R3a changes no SQL and no function, and R2b's 942 of 942 stands on the same database
  code.
- `media.spec.ts`'s screenshot test failed twice in the writer's run, at the 90 s timeout with 7.3 to 8.0 GB free
  (waiting for Turnstile's token at sign-in, then the upload dialog at 1440); R3a changes nothing it uses (the first test
  of the file, through the same dialog, passed). It runs again in R3b, which changes `MediaUpload.tsx`.
- The local database holds R3a's test residue (46 test staff, 5 draft posts); nothing was published.
