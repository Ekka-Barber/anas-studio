# RESIDUALS-1, round R3a: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R3a, branch `agent/residuals-1` with R1,
R2a and R2b committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI
2.106.0, Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell. The package's rounds:
`SCOPE.md` (R3 runs as R3a, the content screens, and R3b, the commerce screens); how the earlier rounds ended:
`RECORD-R1.md`, `RECORD-R2a.md`, `RECORD-R2b.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `PLANS/DESIGN-AUDIT.md` (every item that
applies to an admin control you change), `DESIGN.md` (the admin's copy and states), and each entry's block in
`artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md` by its id. Where this brief decides otherwise, it wins. No SQL
and no Edge Function changes in this round: if an item seems to need one, stop and report.

## Write only these paths

- `src/components/admin/CollectionForm.tsx`, `RichTextEditor.tsx`, `FieldInput.tsx`, `CollectionList.tsx`,
  `PublishBar.tsx`, `AdminHome.tsx`, `EmailView.tsx`; `src/components/admin/admin.module.css` (only if no existing
  class fits)
- `src/admin/fields.ts`, `src/admin/richtext.ts`
- tests: `tests/unit/admin-editor.test.ts`, `richtext.test.ts`, `richtext-editor.test.ts`, `collections.test.ts`,
  `admin-ops.test.ts`, `admin-publish.test.ts`; `tests/e2e/cms.spec.ts`, `owner-operations.spec.ts`, `media.spec.ts`
  (in `media.spec.ts` only what the new states require)

Any other path: stop and report.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, with these additions: Arabic copy exactly
as given here (Western digits, as the admin prints numbers); no new dependency; the admin stays usable at 360 px; every
new sentence that reports a state is announced (`role="status"`, or `role="alert"` for a failure, as the screen's
existing messages are); a new note under a field is tied to it with `aria-describedby`. Work in the order below; if your
run is cut short, your last message says what is built, what ran, and what is left.

## The items

1. **QUALITY-12, the access token in the editor** (`CollectionForm.tsx`). Decided, the digest's fix: delete the
   `accessToken` state, the effect that fills it (`getSession` and `onAuthStateChange`), and the `accessToken &&` in front
   of `PublishBar`; the bar shows whenever `baseSeq > 0`. The shell already gates the admin on the session. Proof: the
   e2e that publishes from the editor (`cms.spec.ts`) stays green.
2. **ADMIN-CMS-05, a click into an empty body** (`RichTextEditor.tsx`, `src/admin/fields.ts`). Decided: both halves.
   `OnChangePlugin` gets `ignoreSelectionChange`; and `handleChange` hands back the richtext field's empty default (the
   value `defaultForField` gives, `{ root: { type: 'root', children: [] } }`) when the editor's root holds one paragraph
   with no children and nothing else, through one small pure exported function in `src/admin/fields.ts`. A typed-then-
   deleted body is therefore unchanged too. Proof: a unit test of the function (one empty paragraph gives the default;
   one paragraph with text, two empty paragraphs, a heading are returned as they are); `cms.spec.ts`, the digest's
   PROOF made right: a post with only «المعرّف» and «العنوان», «حفظ», one click in «محرر النص المنسق», a click on the
   page heading; «نشر» stays enabled and `localStorage` has no `anasaq:draft:posts:<id>` key.
3. **ADMIN-CMS-12, the rich text's limits in Arabic** (`src/admin/richtext.ts`, `fieldPathLabel` in
   `src/admin/fields.ts`). Decided: each document limit carries its own message: a text node over 20000 characters
   «الفقرة أطول من 20000 حرف؛ قسّمها.»; a block's inline children over 2000 «الفقرة فيها أسطر أو تنسيقات كثيرة جدًا؛
   قسّمها إلى فقرات.»; a list over 500 items «القائمة أطول من 500 بند؛ قسّمها.»; the root over 1000 blocks «النص أطول
   من 1000 فقرة؛ قسّمه أو احذف الأسطر الفارغة.». `fieldPathLabel` stops at a richtext field: it prints that field's label
   and nothing of the path inside it (so the form reads «النص: الفقرة أطول من 20000 حرف؛ قسّمها.»). The link address's
   own limit stays as it is (the toolbar refuses a bad address before it reaches the schema). Proof: `richtext.test.ts`
   (each of the four limits gives its message), a unit test of `fieldPathLabel` on a path inside a richtext field (in
   `admin-editor.test.ts` or `collections.test.ts`, where it is tested today).
4. **ADMIN-CMS-13, «حذف» on a paragraph or a list item** (`FieldInput.tsx`, the two `items.filter` buttons). Decided:
   an item that holds text asks first, with `window.confirm` as «أرشفة» does in `PublishBar.tsx`: a paragraph «حذف هذه
   الفقرة وما كُتب فيها؟», a list item «حذف هذا العنصر وما كُتب فيه؟». Cancel changes nothing. An item with no text (a
   paragraph that is empty after trimming; a list item none of whose string values, at any depth, holds text after
   trimming) is removed at once, as today. The "holds text" check is one small pure exported function. Proof: a unit
   test of the check; `cms.spec.ts`: a filled item's «حذف» dismissed keeps the item, accepted removes it; an existing
   test that deletes a filled item accepts the dialog.
5. **ADMIN-CMS-14, typing while the editor reloads** (`CollectionForm.tsx`). Decided: a load after the first one (the
   reload after «نشر», «جدولة», «إلغاء الجدولة», «أرشفة», or a restore) marks the form reloading until that load ends
   (applied, failed, or superseded: a superseded load leaves the flag to the newer one). While it is set, the fields'
   wrapper is `inert` and `aria-busy="true"`, «حفظ» is disabled, and a status line reads «يحمّل آخر نسخة محفوظة…».
   What is typed during the action itself stays handled as today (the local copy and its banner). Proof: `cms.spec.ts`,
   the digest's PROOF made right: with a 2 s delay on `/rest/v1/content_documents` after «نشر» (or «إلغاء الجدولة»), the
   fields' wrapper is `inert` while the request is pending; once it lands, typing 'abc' into «مقتطف» shows in the field
   and in the local copy.
6. **ADMIN-CMS-16, a published article's «المعرّف»** (`CollectionForm.tsx`, `FieldInput.tsx`). Decided: when a post has
   a live version, the form reads that version's slug once per load (`content_versions` at `live_seq`, which the admin
   already reads for the version history). While the form's «المعرّف» differs from it, the field shows under its input
   «تغيير المعرّف يغيّر رابط المقال المنشور، والروابط القديمة لن تعمل.», tied with `aria-describedby`; when it matches
   again, the note goes. Old addresses are not redirected (no `_redirects`; recorded as not built). If the read fails,
   no note (the form works as today). Proof: a unit test of the condition (a pure function: no live slug, same slug,
   other slug); `cms.spec.ts`: a published post, change «المعرّف», the note shows; put it back, it goes.
7. **ADMIN-CMS-18, the documents list's states** (`CollectionList.tsx`). Decided: while the list loads (no rows, no
   error) it shows «يحمّل...» in place of the table; when the load failed it shows the error as today and, for the fixed
   collections (rooms, site settings, policies, scenes), the table with the «العنوان» column only, so each document can
   still be opened, and nothing claims «مسودة لم تُنشر» or «لم يُحفظ بعد»; an open collection that loaded with no rows
   and no local copies says «لا توجد مقالات بعد.» (posts) or «لا توجد تصنيفات بعد.» (taxonomies) in place of the
   table. The choice of state is one small pure exported function. Proof: a unit test of that function;
   `cms.spec.ts`: with `/rest/v1/content_documents` aborted, the rooms list shows the error and the room titles and no
   «مسودة لم تُنشر».
8. **ADMIN-CMS-23, «معاينة» with unsaved edits** (`PublishBar.tsx`, `CollectionForm.tsx`). Decided: `PublishBar` takes
   whether the form has unsaved changes; while it has, beside «معاينة» it shows «احفظ أولًا لترى تعديلاتك في المعاينة.»
   (the link stays: the saved version can still be previewed). Proof: `admin-publish.test.ts` if it renders the bar,
   else `cms.spec.ts`: edit a room's line, the sentence shows; «حفظ», it goes.
9. **ADMIN-CMS-06, the owner home's failed schedules** (`AdminHome.tsx`). Decided: the query also selects `summary`
   (`{seq, sqlstate}`, written by `publish_due`; check its latest definition); `publishFailures` keeps the newest
   failure per document with its seq and sqlstate; one read of `content_documents` for the listed documents
   (`collection`, `doc_id`, `latest_data`, `live_seq`) drops every failure whose document is live at or after the
   failed seq (a failure with no seq stays); each entry is labelled with `documentTitle(collection, docId,
   latest_data)` instead of the raw id, and a 23505 adds «معرّف المقال مستخدم في مقال منشور آخر.». The count line
   counts what is left; nothing left, no line. If that read fails, the home shows «تعذّر التحقق من نجاح النشر
   المجدول.» as for the audit read. Proof: `admin-ops.test.ts` (the newest failure per document with its seq; a failure
   dropped once the document is live at its seq or later, kept when live at an older one; the 23505 sentence; the title
   label).
10. **ADMIN-CMS-10, the email problems screen's cap** (`EmailView.tsx`). R2a already lists the replayable rows first
    (`outbox_attention` in `20261015130000_residuals_r2a.sql`, its `order by`). Decided: when the list holds 200 rows
    (`outbox_attention`'s limit), the screen says under its filters «تُعرض 200 مشكلة فقط: ما يحتاج تدخلًا أولًا، ثم
    الأحدث.». The cap is one exported constant shared with `AdminHome.tsx`'s `ATTENTION_CAP`. Proof: a unit test of the
    note's condition (`admin-ops.test.ts`).

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. a mutation for items 2, 5 and 9 (revert the change, run its test, see it fail, restore);
3. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/cms.spec.ts tests/e2e/owner-operations.spec.ts tests/e2e/media.spec.ts` (Playwright on
   `http://localhost:3000`; restore `next-env.d.ts` afterwards); otherwise say so and list the e2e tests you changed;
4. `pnpm build`, `pnpm check:export`, `pnpm check:budgets`.

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, anything not done and why, and the
risks left. The orchestrator takes the screenshots (360 and 1440) of the changed screens. Do not accept your own work.
