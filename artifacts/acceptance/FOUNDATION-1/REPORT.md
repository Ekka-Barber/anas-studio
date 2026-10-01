# FOUNDATION-1: finishing Foundation (P00 to P02), 2026-10-01

**Asked by the owner (2026-10-01):** "finish foundation / there is no 2013 photo / the characters use only what in the first pages anas provided / the five films are consented as per ANAS / yes make pages editable / yes I told anas about supabase instede of cloudflare". Recorded as D44 in `PLANS/DECISIONS.md`.

**Base:** `main` at `3c8228d` (AUDIT-2). Lock `.anasaq-execution.lock`, package FOUNDATION-1, held by the orchestrator from the first round to the commit.

## 1. What was built

| Item | What changed | Where |
|---|---|---|
| The book page in the admin | The book page is the fifth `rooms` document, `book` («كتبتُ هنا»): title lines, author, the cover, standing, spine and bookmark pictures, the about text, excerpts, characters, photos, journey, status lines and editions. The publish gate needs a title; the draft preview draws the real `BookView`. `src/content/book.ts` is deleted. | `src/admin/collections/rooms.ts`, `index.ts`, `src/lib/content.ts` (`getBookRoom`), `src/app/(public)/book/page.tsx`, `RoomPreview.tsx`, `CollectionForm.tsx` |
| The book's characters | A «الشخصيات» section after the excerpts, with a link in the contents strip: four cards (أنس, الأمهات, الجارة, أطفال الحي), each a name, one line quoted exactly from Anas's first pages (the dedication and the introduction) and its source. No other text about them is invented. With no character the section and its link are left out. | `BookView.tsx`, `book.module.css`, `content/initial-content.json` |
| The home doors in the admin | `site_settings.home.doors` («أبواب الغرف»): each door's room (one of the eight, once each), title, colour, short fact, line and call to action, in the list's order. A room with its own document still shows its own line. `src/content/home.ts` is deleted. | `src/admin/collections/site-settings.ts`, `src/app/(public)/page.tsx`, `HomeView.tsx` |
| The contact page in the admin | `site_settings.contactPage` («صفحة التواصل»): the title's lines, the services' title and intro, and the services, each still opening the form with its own name. `src/content/contact.ts` is deleted. | `site-settings.ts`, `src/app/(public)/contact/page.tsx` |
| The five films | The five films that show children are back in «بدأتُ من هنا» (Anas's consent): the content, the media manifest, their five posters, and `scripts/prepare-media.mjs`. The export check's guard that refused them is removed with its test. | `content/initial-content.json`, `public/media/manifest.json`, `public/images/manifest.json`, `public/images/started/46…50-*-poster.webp`, `scripts/check-export.mjs` |
| Edge Function type check in CI | CI installs Deno 2.9.6 (action pinned by commit) and runs `deno check` on every function with its own import map (I49 item 3). | `.github/workflows/ci.yml` |
| JavaScript-off tests | A new spec: the header lists every room inline with no menu button, /scenes lists every photo as a link, /journal lists posts or says there are none, /contact shows the form, its channels and services. | `tests/e2e/no-js.spec.ts` |
| The import | `pnpm db:import` writes `rooms/book` and the two new site settings keys. | `scripts/import-content.mjs` |

No migration: the book is a `rooms` document, and the doors and contact page are keys of the existing `site_settings/site` document.

## 2. How it ran

A workflow (`wf_a57c6e1c-19d`, 8 agents, about 95 minutes) ran four sequential rounds of one `sonnet-worker` each, each followed by a Sonnet pre-audit (D43: a self-check, not acceptance): F1-BOOK, F2-PAGES, F3-FILMS, F4-CI-NOJS. Every round passed its pre-audit the first time. The platform flagged F3 as "security test removal": it removed the child-film export guard, which is exactly what the owner's consent called for; the orchestrator checked that the secret scan and the demo-content guard in `check-export.mjs` are untouched.

Then the orchestrator audited the whole diff itself (D43): the schemas and loaders, the views and pages, the admin preview, the import script, the CI step, `prepare-media.mjs` and `check-export.mjs`, and screenshots of the changed pages at 360 and 1440 (the character cards, the eight doors, the contact page, the seven films with their posters). It fixed two things and added one test:
- the contact page's title lines and services title could be published blank, leaving an empty heading; both are now required (`site-settings.ts`, with a unit test);
- an older problem the acceptance run exposed: in the editor, two overlapping loads of a document could land one after the other, so an edit made between them was offered as an "unsaved local copy" and the form was hidden behind the banner (seen in `cms.spec.ts` "post lifecycle", where `next dev` runs every load twice). Only the newest load applies now (`CollectionForm.tsx`);
- a new e2e test, "book page, home doors and contact page: edit and publish; the pages follow": it renames a character, renames and moves a door and retitles the services in the admin, publishes, and checks /book, / and /contact.

## 3. Phase 1 gate (P00 to P02)

WORK-PACKAGES: "Phase 1 gate: all public pages faithful/responsive/console-clean and reader functionality proven; unresolved rights remain explicit launch blockers."

| Gate part | Evidence (this battery) |
|---|---|
| Every public page renders, one h1, no console errors | `public.spec.ts` "every page renders with one h1 and no console errors" (every route, the 404) |
| Responsive, no horizontal overflow | `visual.spec.ts` at 360, 768, 1024 and 1440, plus JS off |
| Readable without JavaScript and with reduced motion | `public.spec.ts` "readable with JavaScript off", `no-js.spec.ts`, `motion.spec.ts` "without motion" |
| Menu, filter and lightbox by keyboard, focus restored | `public.spec.ts` "header and menu", "المَشاهد" |
| The journal list, category filter and article | `cms.spec.ts` |
| The reader | `reader.spec.ts` (right binding, keyboard, touch, fullscreen, failure, static fallback, no manuscript transfer) |
| Rights stay explicit | E04 (final manuscript, preview range approved), E05 (photos, logos, stories) remain open gates in `PLANS/DECISIONS.md`; nothing in this package closes them |

## 4. P00: the D32 proof map

WORK-PACKAGES P00 D32 "Proof", criterion by criterion:

| Criterion | Evidence |
|---|---|
| `pnpm check` exits 0 | This battery: lint 0, typecheck 0, unit 48 files 648/648, check:copy and check:frozen OK |
| The static build writes every room, the admin shells and `404.html` to `out/` | `pnpm build` exit 0; `check:export` finds its 51 required files |
| `check:export` finds no secret | 320 text files scanned, no secret; demo content only against loopback (I40) |
| The public JS budget holds | `check:budgets`: largest 147.4 KiB of 150 |
| A static smoke of `out/` renders the rooms in Thmanyah at 360 and 1440, no overflow | `artifacts/acceptance/P06/commands.txt` (2026-09-26 cloud smoke and the 2026-09-27 local run), and this battery's `visual.spec.ts` |
| The Edge Functions type-check under Deno | `artifacts/acceptance/P06/commands.txt` (Deno 2.9.6, every function); now a CI step |
| The migrations apply to a throwaway Postgres | `artifacts/acceptance/P06/commands.txt` (PostgreSQL 16.13 with Supabase stubs); this battery's `supabase db reset` applies every migration |
| The ported unit, integration and e2e tests pass on the full stack | This battery: test:db 17 files 232/232 with the edge runtime; e2e below |

P00's earlier proofs (the D29 swap, `3c88331`) are in `artifacts/acceptance/P00/`.

## 5. P01 and P02 acceptance record

- **P01** (C03, C04, C05, C07, C32): every route and its controls are proven by the suites in section 3; DESIGN-B (`artifacts/acceptance/DESIGN-B/`) holds the design comparison and the tasmeem audit. Words and pictures come from Anas's material only: the characters are quoted from his pages, and no section is shown as a placeholder (DESIGN.md §8). Open by gate, not by code: E05.
- **P02** (C06, C33): the reader is accepted (`artifacts/acceptance/P02/`); the book page is now edited in the admin, with its characters. Open by gate: the final manuscript (E04) and the paper edition's details (E03).
- **COVERAGE** after this package: C03, C13 and C32 met; C06, C12 and C14 partial for the reasons in their rows.

## 6. Acceptance battery

All on the final code unless a line says otherwise; the log is `battery.log` beside this file, with `e2e-batch1.log`, `e2e-batch2.log`, `e2e-cms-rerun.log` and `e2e-rerun2.log`.

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | exit 0 |
| `pnpm test` | 48 files, 648/648 (632 before) |
| `pnpm check:copy`, `pnpm check:frozen` | OK (190 source files; 50 files under `deploy/` unchanged) |
| `pnpm db:reset`, `db:env`, `db:import`, `db:demo-catalog` | every migration applied; 7 documents imported (6 before: `rooms/book` is new) |
| `TEST_ENV=local pnpm test:db` | 17 files, 232/232 with the edge runtime (230 before), on the final code from a fresh reset |
| `pnpm build` | exit 0 |
| `pnpm check:export` | 51 required files, 320 text files, no secret; demo content only against loopback |
| `pnpm check:budgets` | largest 147.4 KiB of 150 |
| e2e batch 1 (public, auth, cms, media, owner-operations, no-js) | 66/66 |
| e2e batch 2 (cart-checkout, checkout-api, store-admin, reader, motion, visual) | 107/107 |
| e2e re-run after the audit fixes (cms, media, store-admin, owner-operations) | 44/44, with the new test |
| e2e total | **174/174** on each suite's last run |

On the way:
- The first battery's e2e crashed Chrome (`Target crashed`, worker exit 0xC0000142) after 11 tests: about 60 headless Chrome processes left by an earlier session's scratch test were still running. They were stopped, the database reset and re-imported, and both batches run again.
- The cms re-run for the new test failed once in "post lifecycle" (6 passed, 1 failed): the overlapping-loads problem in section 2, fixed in the editor, then 44/44.
- A test:db run on the database the e2e suites had filled gave 231/232: the staff-admin "last active owner" test timed out at 5 s with 62 test owners in the table (the known pollution case in HANDOFF). From a fresh reset: 232/232.
- `PLANS/verify-plan.ps1` failed on the pinned hash of `AGENTS.md`, stale since AUDIT-2 edited that file for D43; the row in `PLANS/evidence/source-manifest.json` is refreshed and the check passes (13 documents, 13 packages, 40 scope owners, 162 frozen hashes).
- `git checkout -- next-env.d.ts` after every e2e run.

## 7. Left open

- I41: the hosted bootstrap must write `rooms/book`, `home.doors` and `contactPage` before the first hosted build, or the build stops on purpose.
- I49 (6): a full `prepare-media.mjs` run would add about 40 image sizes; it belongs to the P10 media pass.
- The /journal door's title on the home page is the menu label of /journal (D11), so editing that door's own title shows nothing; the admin keeps the field for the other doors' sake.
- With JavaScript off and motion on, the scenes tiles' entrance animation can block a click in the first moments; the spec runs with reduced motion. A P10 check.
