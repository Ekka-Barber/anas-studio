# RESIDUALS-1, round R4b: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R4b, branch `agent/residuals-1` with R1 to
R4a committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI 2.106.0,
Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no Deno. The package's rounds:
`SCOPE.md` (R4b: the public site, the reader and the backup scripts); how the earlier rounds ended: `RECORD-R1.md` to
`RECORD-R4a.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `PLANS/DESIGN-AUDIT.md` (every item that
applies to a public control you change), `DESIGN.md` (section 8, the contact page's states), `docs/operations.md` (the
backup and restore sections), and each entry's block by its id: DSN-PAGES-13, DSN-PAGES-14, DSN-HOME-18, QUALITY-13,
READER-07, QUALITY-14, -21, -22, -23, -25, READER-14 and -17 in `artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md`;
SUPPLY-04, TEST-UNIT-10 and TEST-UNIT-14 in `work/waveB/digest.md`. The line numbers there are from before R1: find each
spot by its text. Where this brief decides otherwise, it wins.

## Write only these paths

- `src/app/global-error.tsx` (new), `src/app/(public)/error.tsx`
- `src/app/(public)/contact/page.tsx`, `src/components/public/contact/ContactForm.tsx`
- `src/components/public/rooms/StartedRoomView.tsx`, `src/admin/collections/rooms.ts`
- `src/components/book/pdf.ts`, `src/components/book/PdfBookReader.tsx`
- `src/lib/cart.ts` and `src/lib/money-input.ts` (item 7's deletions only)
- item 8's comments: `supabase/functions/_shared/outbox.ts` (also its one branch), `supabase/functions/_shared/media.ts`,
  `supabase/functions/_shared/db.ts`, `src/lib/content.ts`, `src/components/admin/SettingsView.tsx`,
  `src/components/admin/StepUp.tsx`, `src/components/admin/TeamView.tsx`
- `scripts/prepare-preview.py`; `scripts/lib/backup-format.mjs`; `scripts/restore-check.mjs` and the new
  `scripts/lib/restore-objects.mjs`
- tests: `tests/unit/collections.test.ts`, `site-pages.test.ts`, `cart.test.ts`, `money-input.test.ts`,
  `backup-format.test.ts`, `restore-check.test.ts`, the new `tests/unit/restore-objects.test.ts`;
  `tests/e2e/public.spec.ts`, `no-js.spec.ts`, `reader.spec.ts`, `helpers.ts` (item 7's comment only)
- `docs/operations.md` (items 12 and 13)

Any other path: stop and report.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, except its SQL rule (this round changes no
SQL; item 8 changes one Edge Function file), with these additions: Arabic copy exactly as given here; the public pages
keep DESIGN.md's rules (calm, RTL, Latin digits, no new motion); a new sentence that reports a state is announced as the
page's existing ones are; the public JavaScript budget (`pnpm check:budgets`) passes; `scripts/prepare-preview.py`
never rewrites `public/book/khous-preview.pdf` or `content/book-source-manifest.json` (both are hash-pinned: run only
the check item 11 adds). Work in the order below. If your run is cut short, your last message says what is built, what
ran, and what is left.

## The items

1. **DSN-PAGES-13, an error in a root layout.** Decided: a new `src/app/global-error.tsx` (`'use client'`) renders its
   own `<html lang="ar" dir="rtl">` and `<body data-tone="sand" data-surface="site">`, imports `@/styles/globals.css`,
   and shows the public error page's panel (`@/components/public/lost.module.css`, as `(public)/error.tsx` does) with:
   the heading «تعذّر عرض <span className="t-accent">هذه الصفحة</span>», the line «حاول مرة أخرى، أو عد إلى الرئيسية.»,
   «إعادة المحاولة» (an `ActionButton` calling `retry()`), and «الرئيسية», a plain `<a href="/">` styled as the
   site's outline action (no client router: the page may be broken). `(public)/error.tsx` calls `retry()` instead of
   `reset()` (Next 16.3.8 passes both; `retry` is the stable recovery). Proof: `pnpm build` and `pnpm check:export` pass
   with the file; a unit test renders `GlobalError` as static markup (its `lang`, `dir`, heading and both controls).
2. **DSN-PAGES-14, the contact page with no channels.** Decided: the page passes `hasChannels` (the same condition that
   draws its channel list: WhatsApp, the email or a social link) to `ContactForm`. With channels, the two stop notices
   stay as they are. With none, the pointer goes: «التحقق من المرسل غير مُعدّ بعد، فالإرسال متوقف مؤقتاً.» and, in the
   `noscript`, «الإرسال يحتاج JavaScript.». When the widget failed to load (`turnstileFailed`), a press says «تعذّر تحميل
   التحقق من المرسل. أعد تحميل الصفحة.» on the status line instead of «أكمل التحقق من أنك لست آلياً، ثم أرسل.». Proof:
   `no-js.spec.ts` (the contact page without JavaScript, with the demo content: the channel pointer only when a channel
   shows), and `public.spec.ts` with Turnstile's script blocked: a filled form's press says the reload sentence.
3. **DSN-HOME-18, the family films drawn once.** Decided: `StartedRoomView` computes once the index of the first
   visible movement that is marked `films` and has a text block, and passes `films` to that movement only (no movement
   reads `movement.films` itself any more). The publish rule (`roomPublishSchemas.started`): when a visible reel exists,
   exactly one visible movement carries `films`, else an issue on `['movements']` saying «اختر محطّة واحدة تظهر فيها
   المقاطع.» ("visible": not hidden, as `dropHidden` reads it). Proof: `site-pages.test.ts` (two flagged movements: the
   seven films once, under the first; a flagged movement hidden: the next flagged one; none flagged: no films), and
   `collections.test.ts` for the rule (none, two, one; no visible reel: no issue).
4. **QUALITY-13 = READER-07, a superseded page draw.** Decided: `PageSurface` keeps a draw generation: `draw` takes
   `const gen = ++this.gen` right after its own `cancel()`, and returns, without touching the canvas, the text layer or
   `drawn`, after each await (`getPage`, the render, `getTextContent`) when `gen !== this.gen`; `cancel()` and
   `clear()` bump it; the previous layer is cancelled right before a new one is made. Proof: say what proves it (the
   existing reader e2e, `reader.spec.ts`, at least); if a unit test with a stubbed `doc` and `pdfjs` is small, add it
   (two draws, the first's `getTextContent` resolving after the second started: one text layer).
5. **QUALITY-21, a failed page-flip chunk.** Decided: the `import('page-flip')` in `PdfBookReader` gets the rejection
   handler the PDF load already has: `() => !cancelled && setFailed(true)`, so «تعذّر فتح الصفحات.» and «إعادة المحاولة»
   show. Proof: `reader.spec.ts` with the page-flip chunk's request aborted (match it by the content item 10 names, or by
   aborting the second script the click requests): the failure and the retry show.
6. **QUALITY-22, the unused room schemas.** Decided: delete the eight `*Schema` exports in `rooms.ts` that nothing
   imports (`jewelSchema`, `reelMediaSchema`, `galleryPhotoSchema`, `builtMovementSchema`, `thuraFlavourSchema`,
   `thuraItemSchema`, `moonlightCupItemSchema`, `boutiqueItemSchema`), each checked with `git grep` first; keep every
   `*Fields` list and `startedMovementSchema` (`content.ts` imports it).
7. **QUALITY-23, two helpers kept only by their tests.** Decided: delete `removeLine` (`cart.ts`) with its test cases
   (or point them at `removeLines`), and `riyadhLocalToIso` (`money-input.ts`), keeping `riyadhLocalToIsoOrNull`'s
   tests; `tests/e2e/helpers.ts`'s comment names `riyadhLocalToIsoOrNull`.
8. **QUALITY-25, comments from earlier architectures.** Decided: `outbox.ts`'s `renderFor` takes `created_at: string`
   and drops the `Date` branch; and these comments say what is true now: `media.ts` (why there is no `file-type`: no
   Worker since D32; the few signatures are read here, with no dependency), `content.ts` (the picture manifest goes
   through `images.ts`), `SettingsView.tsx` (the `admin` function's `status` action), `StepUp.tsx` (the caller's own
   call, which the money screens and the settings use too), `TeamView.tsx` (a failed ban reverts the revoke: F1-9), and
   `db.ts` (named SQL functions are the functions' main path; `staff-admin` and `staff.ts` read and write tables
   through the Data API). Restart the edge runtime after the `outbox.ts` edit.
9. **READER-14, "closed, it loads nothing".** Decided: `reader.spec.ts`'s check reads, before the click, the scripts
   the page loaded (`performance.getEntriesByType('resource')`), fetches them, and expects none to contain
   `GlobalWorkerOptions` (pdf.js) or `stf__parent` (page-flip); after the click it proves the same search finds both,
   so the check can fail.
10. **READER-17, an address inside a compressed stream.** Decided: `verify()` in `prepare-preview.py` also runs the
    EMAIL check on each page's extracted text and on every stream object's decoded data (`get_data()`), and the
    FORBIDDEN check on the decoded data of object streams (`/Type /ObjStm`), where dictionaries can hide; and a
    `--verify` flag checks the published `public/book/khous-preview.pdf` against the manifest's pages without building or
    writing anything. Proof: `python scripts/prepare-preview.py --verify` passes on the published file; a scratch PDF
    (never committed) with an address inside a Flate-compressed content stream fails `verify()` (report both). If Python
    or pypdf is missing, say so and stop on this item.
11. **SUPPLY-04 with TEST-UNIT-10, the backup format.** Decided: format version 2 derives the key from
    `passphrase.normalize('NFC')`; version 1 keeps the raw string. `VERSION` becomes 2 (written); `readBackup` accepts 1
    (raw) and 2 (NFC); `deriveKey(passphrase, salt, version = VERSION)` normalizes only for 2; the header comment says
    so. `docs/operations.md` says the passphrase is compared after NFC normalization (since format 2). TEST-UNIT-10: a
    test helper seals a hand-built entry stream with the format's own header, gzip and AES-256-GCM (node:crypto,
    node:zlib, `deriveKey`); `readBackup` refuses with `CORRUPT` and leaves nothing behind for the entry paths
    `../escape.txt`, `a\\b` and `C:/x`, a duplicate path, a first entry that is not `manifest.json`, a size that does not
    match and a wrong sha256. Also: a version-1 file sealed with a raw non-NFC passphrase still opens with that same
    string; a version-2 file opens with the passphrase typed in the other canonical order (U+064E U+0651 against U+0651
    U+064E). Mutations: remove the path check from the reader, then the NFC step; each fails its test.
12. **QUALITY-14 with TEST-UNIT-14, the restore rehearsal's objects.** Decided: `bucketMimetypes` throws on a reply it
    cannot parse (no `{}`); an object with no recorded type is a failure, never uploaded as `application/octet-stream`;
    after the upload the rehearsal reads the types again and fails each object whose type differs from the one read
    before. The per-bucket decision (today's loop at the end of `main`: every bucket of `BUCKETS`, of the objects and
    of the restored rows; `ok` when verified equals total equals the row count) and the type comparison move into pure
    exported functions in the new `scripts/lib/restore-objects.mjs`, which `restore-check.mjs` uses; the file's header
    comment says what is checked. Proof: `tests/unit/restore-objects.test.ts` (a missing paid-files bucket with rows,
    an empty bucket, a count mismatch, a sha256 failure, a type that changed, a type missing) and
    `restore-check.test.ts` still green; `docs/operations.md`'s rehearsal paragraph names the type check.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. after the `outbox.ts` edit: `docker restart supabase_edge_runtime_ANASAQ.ME`, then `pnpm test:db` (all files;
   `TEST_ENV=local`, `DATABASE_URL` from `supabase status -o json`, never printed);
3. the mutations items 3, 11 and 12 name (revert the change, run its test, see it fail, restore, run it again);
4. `python scripts/prepare-preview.py --verify` (item 10);
5. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/no-js.spec.ts tests/e2e/public.spec.ts tests/e2e/reader.spec.ts` (Playwright on `http://localhost:3000`;
   restore `next-env.d.ts` afterwards); otherwise say so and list the e2e tests you changed;
6. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the three largest pages).

No `pnpm backup` or `pnpm restore-check`: the rehearsal needs the owner's machine and its word.

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, anything not done and why, and the
risks left. Do not accept your own work.
