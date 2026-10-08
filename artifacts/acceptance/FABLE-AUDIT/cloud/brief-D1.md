You are the fix worker of round D1, its non-visual part, in FABLE-AUDIT, the deep audit of the anas.studio repository. You run Claude Sonnet 5.5 at effort max. The orchestrator (Claude Opus 5.5 at effort max: the cloud continuation session under D48) audits your diff with an independent Opus 5.5 auditor and runs every check again. Write normal prose in comments and tests; Arabic user-facing strings exact and RTL-correct.

This brief adapts round D1's brief (`artifacts/acceptance/FABLE-AUDIT/work/briefs/brief-D1.md`, written for the owner's Windows machine). The owner's ruling of 2026-10-08: D1 is split. THIS round does only D1's logic, accessibility, content and caching items, each provable without seeing the site; every purely visual CSS or layout item is HELD for a later round with screenshots, and you must not touch any of them (the list is below). Design direction B (DESIGN.md) and the Thmanyah type are the owner's decisions; nothing in this round changes how a page looks except where an item's own words say so (a label from the CMS, a link that appears, a section hidden when empty).

ENVIRONMENT (a cloud container, not the owner's machine)
- Repository: /home/user/anas-studio. Before any node or pnpm command run `source /tmp/claude-0/-home-user-anas-studio/03aabc3a-d35b-5669-961b-ade6a38d9a19/scratchpad/env.sh` (Node 24.19.0). node_modules is installed.
- There is NO database, NO Supabase CLI, NO Docker and NO browser here, so no build, no export and no screenshot. Never run `pnpm test:db`, `pnpm test:e2e`, Playwright, `pnpm dev`, `pnpm build`, `supabase`, `docker`, any `pnpm db:*`, `pnpm install`, `pnpm patch`, or anything under `artifacts/acceptance/FABLE-AUDIT/work/scripts/`. CI builds the static export from a seeded database on every push and runs `check:export`, `check:budgets` and the database suite, including `tests/integration/static-site.test.ts`: whatever you change must keep that build and those checks green.
- The public JavaScript budget is nearly spent: the largest page (`checkout.html`) is at about 149.3 of 150 KiB gzip. Add as little client-side code as you can; prefer server components and build-time work (the pages are a static export).
- The findings' evidence is in `artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md` (about 380 KB: never read it whole). Find an entry with `grep -n "^### <ID> " <file>` and read from that line to the next `### `.

HARD RULES
- Write only the ALLOWED PATHS. If an item needs another path, stop that item and report it. Never open, list or read `_archive/`, `deploy/design/`, `.env`, `.env.*` or `supabase/functions/.env`. Never print a secret.
- No git commit, push, stash, checkout, reset or restore. No new dependency. Never weaken, skip or delete an assertion or a test. Never edit `supabase/migrations/`, `content/initial-content.json` or `patches/`.
- Verify each item's premise in today's code before you change anything; if it is false, do what is right for today's code and report it as a deviation; if the right thing is unclear, stop that item and report.
- Smallest change that removes the cause; match each file's style; no new colours, no new CSS rules except where an item says so (none in this round needs one); new Arabic strings short, in the register of the existing ones; Latin digits only (check:copy refuses Arabic-Indic digits in source); write escapes such as   in code as escape text.
- Two failed attempts at the same problem: stop that item and report.
- Token discipline: read each file once and only the parts you need; batch edits; chain shell commands with `&&`; no polling, no sleep, no background processes.

ALLOWED PATHS
src/components/public/scenes/SceneGallery.tsx; src/lib/scenes.ts
src/components/site/{SiteHeader,Footer}.tsx
src/components/public/rooms/{ShelfRoomView,StartedRoomView,BuiltRoomView,PassedRoomView}.tsx; src/components/weave/RoomNav.tsx; src/components/public/Picture.tsx
src/components/public/home/HomeView.tsx; src/components/public/book/BookView.tsx
src/components/book/{PdfBookReader.tsx,StaticPdfReader.tsx,pdf.ts}
src/lib/{store,cart,content}.ts
src/app/(public)/{book,started,built,passed,shelf}/page.tsx
src/admin/collections/rooms.ts; public/_headers; docs/book-preview.md
tests/unit/{book-room,reader-mapping,pdf-open,store,site-pages,cart,collections,content-loaders,design-b}.test.ts; tests/integration/static-site.test.ts (only if a header or page test there must follow an item's change; it runs in CI)

THE ITEMS (the original texts are in brief-D1.md; what follows is what this round does)

D1-1, the caption part only (DSN-PAGES-17 = A11Y-RTL-11): when the scenes lightbox changes photo, its live region announces «<n> من <total>: <caption>» (Arabic words, not a slash). Put the sentence in a small exported function and unit-test it. The lightbox's CSS fit (DSN-PAGES-10) and its Playwright check are HELD.

D1-2, the name part only (A11Y-RTL-13): the brand link's accessible name includes the visible domain («أنس anas.studio، الرئيسية»): read what the link shows today and make its name contain the visible words in order. The 320-pixel header, the hidden domain under 360 pixels and the no-JavaScript header are HELD.

D1-6 (a) (PERF-01): ShelfRoomView.tsx: the first door Picture `loading="eager" fetchPriority="high"`, the second `loading="eager"` (Picture.tsx may need to pass the two attributes through; nothing else of Picture changes). (e) public/_headers, the orchestrator's ruling: the files under /fonts, /images, /brand and /book are NOT content-addressed (their names stay the same when a file is replaced, e.g. `images/v2/anas-portrait-1200.webp`), so a year of `immutable` would serve a replaced portrait for a year. Give `/fonts/*`, `/images/*` and `/brand/*` a block `Cache-Control: public, max-age=86400`, add the same header to the existing `/book/*` block (it matches the PDF, never the /book page itself), and say why in the file's comment style. Never `immutable` for them. (b), (c) and (d) are HELD.

D1-8 (READER-10, READER-04/08/11 = A11Y-RTL-07, READER-09, READER-15): (b) the reading order for assistive technology: ONLY if it can be done without changing how page-flip lays out or moves its leaves (no change to the patch, no change to the leaves' order in the DOM): ids on the leaves and `aria-owns` on the book host listing them in reading order (0..n-1), or one visually hidden region with the visible leaves' text in reading order, whichever today's code makes plainly safe; the ordering itself in a pure, unit-tested function. If neither is plainly safe without a browser, STOP (b) and report what you found. (c) the reader's «التالية»/«السابقة» and the closing leaf's «النسخ ←» must not disable themselves under focus: `aria-disabled` and an early return, as NotifyAction.tsx does; a failed first open focuses «إعادة المحاولة». (d) a stalled preview download: a 30 s timeout on the PDF fetch that ends «جارٍ فتح الكتاب…» with the existing failure state and the PDF link; unit-test the timeout with fake timers if pdf.ts allows it (tests/unit/pdf-open.test.ts). (e) docs/book-preview.md near line 64: say what the code does (the reader queues the last move and makes it after the turn). (a) (fullscreen centring) is HELD, and so are D1-9 (page-flip's idle loop patch) and D1-10 (touch release).

D1-11 (DSN-PAGES-08: the book page never leads to the store). Add an optional `productSlug` text field to the book document's editions in src/admin/collections/rooms.ts (read the editions list's shape and the CMS schema conventions; no publish rule), and in BookView.tsx (server component, build time) read the store's products (src/lib/store.ts: the loader the store pages already use): for an edition whose productSlug matches a store product with a priced, sellable variant, render the store price and an ActionLink «اطلب النسخة» to /store/<slug>; otherwise keep «يُعلن قريباً». The build must keep working with the store empty and with the database's demo catalog (CI builds with it). Unit tests in tests/unit/book-room.test.ts for the matching (a helper you extract), and in tests/unit/store.test.ts if you add one there. content/initial-content.json is NOT in your paths: the seeded editions keep «يُعلن قريباً» until the owner sets slugs (say so).

D1-12, these items only:
- STORE-UI-17 = A11Y-RTL-05 (src/lib/cart.ts near line 420): the hold's end says «بتوقيت الرياض».
- DSN-HOME-19 (StartedRoomView.tsx near line 56): fold Arabic-Indic digits to Latin before the year test (src/lib/digits.ts has the folding; reuse it).
- DSN-HOME-20 (HomeView.tsx near line 67): an emptied intro or big phrase draws no band.
- DSN-HOME-21 (Footer.tsx near line 36): the footer's room labels come from the CMS nav labels, so «المَشاهد» is spelled one way (read how SiteHeader gets them through src/lib/content.ts and reuse it).
- DSN-PAGES-09 (src/app/(public)/book/page.tsx): the document title from the CMS book title.
- DSN-HOME-16: the four room pages' titles (`src/app/(public)/{started,built,passed,shelf}/page.tsx`) and RoomNav's labels from the CMS room names: read how the nav labels are loaded and reuse it.
- DSN-PAGES-18 (BookView.tsx): an empty excerpts, photos or editions list hides its section and its contents link, as the characters section does.
Every other D1-12 item is HELD.

HELD (do NOT touch; they wait for a round with screenshots): D1-1's lightbox fit and its e2e check; D1-2's header at 320 px, the hidden domain and the no-JS header; D1-3 (scroll padding); D1-4 (the home doors' grid); D1-5 entirely (the post title, blockquote and strong typography, and the renderer's `dir="auto"`); D1-6 (b) (c) (d); D1-7 (fallback faces); D1-8 (a); D1-9; D1-10; and D1-12's STORE-UI-02, -06, -07, -15, DSN-HOME-12, -17, -25, -26, -27, DSN-PAGES-02 and -15.

CHECKS (run them yourself; report each as `command → exit code` with a one-line summary)
1. After each item: `pnpm exec vitest run <the unit files you changed>`.
2. At the end, once each: `pnpm typecheck`, `pnpm lint`, `pnpm check:copy`, `pnpm test` (the whole unit suite, about 15 seconds here: 2,496 tests before this round, all passing but the one content-drift skip).

REPORT (your final message, 60 lines or fewer): model id; files changed; one line per item (and sub-item) with status done / partly / skipped / stopped, what changed and the tests that prove it; every command with its exit code; deviations (anything in this brief you found false in the code, and what you did instead); what changes on a page (so the owner's visual pass knows where to look); risks, above all for the build and the JavaScript budget.
