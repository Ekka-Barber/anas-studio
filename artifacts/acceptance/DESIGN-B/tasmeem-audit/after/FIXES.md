# tasmeem audit, acted on · DESIGN-B · 2026-09-28

The orchestrator (Opus 5.5, solo) under the DESIGN-B lock. Owner decisions first (row 5 and the name bands), then the default set: P0 rows 1–3, row 4 as a launch check, P1 rows 6–15, 18 and 19, and row 17 documented as a device.

Round 2 (same day, owner: "continue work, do the work all yourself"): every row left, 10, 15 (its admin half), 16 and 20–36. `src/components/admin/SignIn.tsx` was added to the lock's allowlist for rows 10, 15, 32, 33 and 36, with a note in the lock.

## Totals (the FINDINGS.md numbering, deduplicated)

| | P0 | P1 | P2 | Gate |
|---|---|---|---|---|
| Audit, as corrected by the owner (row 5) | 4 | 14 | 18 | FAIL |
| After round 1 | 1 | 3 | 18 | FAIL |
| After round 2 | 1 | 0 | 1 | FAIL |

Still open:
- **P0:** row 4. The local demo seed's policy text is data, not code; it is recorded as I40, a launch check. It alone keeps the gate at FAIL.
- **P2:** row 5, a note: the owner keeps the «عبدالله» crossing as built.
- **Exception:** row 19 (MO-04), documented in DESIGN.md §6.

The tool's raw merge (`measured.md`, per width and per route) went from P0 53 · P1 157 · P2 67 to P0 15 · P1 100 · P2 65 after round 1, and to P0 15 · P1 100 · P2 30 after round 2. What is left is either ruled not a defect (below) or out of scope. The 30 P2 are QA-12 "no skip link" on the 29 admin inner shells and on the sign-in, whose first control is the email field, so a skip link there would skip nothing.

| ID | Before | After | Note |
|---|---|---|---|
| SC-03 P0 | 37 | 0 | row 3 |
| SC-03 P1 | 24 | 0 | row 6 |
| QA-04 P0 | 1 | 0 | row 2 |
| QA-05 P1 | 16 | 0 | row 12 |
| TY-04 P1 | 6 | 0 | row 17, now a brand exception |
| IG-09 P1 | 6 | 4 | row 18; the 4 left are the ones FINDINGS rules not a defect |
| MO-09 P2 | 4 | 4 | the section bar's 500ms slide is back (row 19, documented exception) |
| QA-03 P1 / QA-12 P2 | 1 / 1 | 0 / 0 | the `/journal/_` page |

The rest of the raw count is findings that were already ruled not a defect, or rows that were not listed:
- CP-08 ×3 (row 4);
- QA-07 ×8 (the 404's status);
- QA-11 ×4 (the hidden cover link);
- LA-22 ×60;
- SC-15 ×4 (the hidden flavour text);
- TY-05, CO-16, CP-03 (owner text);
- the admin shells' QA-14.

## Per row

| # | Result | What changed | Proof |
|---|---|---|---|
| 1 | fixed | `globals.css`: `[data-tone]:is(a, button) { outline-offset: -6px }`, so a control that sets its own tone draws its ring inside itself. `Figure` captions carry `data-tone="aub"`, so their links get the saffron ring. The caption link's ring is inset 3px. | `probe-focus.js` finds no control with fewer than two sides at 3:1 or more. At 360: home 15, the menu 11, `/started` 11, the lightbox 3. At 1440: home 22, `/started` 18, `/passed` 16, `/shelf` 17, `/contact` 26. Keyboard screenshots of the menu, «القائمة», a door and the lightbox's «إغلاق». |
| 2 | fixed | `journal/[slug]` and `store/[slug]` render the site's not-found page inside the public layout instead of calling `notFound()`. The store had the same latent defect for an empty catalog. | `out/journal/_.html` is `<html lang="ar" dir="rtl">`, titled «هذا الطريق لم يُبنَ بعد · …». |
| 3 | fixed | The footer poem uses `max(1.55em, 44.8px)` and `.t-lead` uses `max(1.45em, 44.8px)`: 1.6 below 28px, unchanged at display size. | render: SC-03 P0 37 → 0 |
| 4 | launch check | `PLANS/ISSUES.md` I40: before launch, confirm the production database has no demo rows and the policies are Anas's text. | still measured locally, because the demo seed is loaded |
| 5 | corrected (owner) | FINDINGS row 5 is now a P2 note. The «عبدالله» crossing is moved to the brand exceptions, granted by the new DESIGN.md line. `.t-hero` and `.nameBand` are untouched. | home screenshot at 360: the crossing is as built |
| 6 | fixed | `.t-title`, `.t-band-xl` and `.t-h2-lg` are at 1.25, and `--leading-tight` is 1.25 (for `.t-h2` and `.t-card`). The tighter `.closingDisplay` (built) and `.slogan` (shelf) overrides are removed. `.t-hero`, `.t-mega` and `.t-year` are kept. | render: SC-03 P1 24 → 0. `contact-title-1440.png`: the dots of «لديك» and the damma of «تُبنى» are now apart. |
| 7 | fixed | `metadata.title` is set on the four rooms, the store, cart and checkout; the product page takes the product's title. | built titles, for example «بدأتُ من هنا · أنس عبدالله القرني» |
| 8 | fixed | `VideoTile` focuses the `<video>` once playing starts. | Enter on «تشغيل»: `activeElement` is the VIDEO, playing, with controls, and Tab enters its controls. |
| 9 | fixed | Checkout errors sit under each field, with `aria-invalid` and `aria-describedby`, and focus moves to the first invalid field. The run-on alert now carries only server errors. | Empty submit: focus on the email field, three fields invalid, each with its own message. |
| 10 | fixed (round 2) | One `role="status"` line serves both steps and is present from the start, so the code being sent and the rate limit are announced. A wrong code is `role="alert"`. | `[role="status"]` read on `/admin/sign-in` |
| 11 | fixed | Submit stays enabled. A press before Turnstile finishes shows «جارٍ الإرسال…» and submits once the token arrives. A missing site key still disables it honestly. | With the widget held back, the press waited over 1s with no request sent; once released, it submitted by itself. The create request was stubbed in the page, so no order was written. |
| 12 | fixed | 44px targets: the store's «السلة» and product links, the caption link (inside the caption's padding, so the bar keeps its height), and the journal's empty-state link. | render: QA-05 16 → 0; the caption link measures 94×44 |
| 13 | fixed | Rings over media are two-tone. On a film, the sand-50 ring gets an aub-900 frame (an inset shadow). On a scenes tile, a saffron ring in an aub-900 frame sits on a layer above the photo. | screenshot of the Raha tile focused at 360 |
| 14 | fixed | The header's "you are here" triangle is `currentColor` (aubergine, 6.6:1). | computed colour rgb(84, 53, 59) on `/passed` |
| 15 | fixed | `dir="auto"` on the name and message fields (contact) and on the name and address fields (checkout). Round 2: the sign-in's email field is `dir="ltr"` with `spellCheck={false}`, and its code field is `dir="ltr"`. | the attributes, read in the browser |
| 16 | fixed (round 2) | No component module sets a size in pixels: 55 declarations now use a token. Near-equal sizes took an existing role: the door title is `--size-card`, the footer poem `--size-lead` and the home book title `--size-mega`. Control sizes got tokens (`--size-action` 18px, `--size-small` 16px). The sizes that belong to one place got named tokens (`--size-thura`, `--size-post-title`, `--size-opening`, `--size-flavour`, `--size-menu`, `--size-brand`). DESIGN.md §2 lists them. Visible changes are within a few pixels, apart from the label floor (row 28). The book's subtitle got 0.35em above it to stay clear of the tail of «خوص». | `grep` for pixel `font-size` in the public modules: 0. Screenshots in `rows-16-36/`. |
| 17 | documented | DESIGN.md §2 describes "the two-tone headline", and `EXCEPTIONS.md` grants TY-04, limited to the 404 and the error page. | report: TY-04 listed under brand exceptions |
| 18 | fixed | `/journal`'s first photo is `loading="eager"` with `fetchPriority="high"` (a new `Picture` prop). The first five `/scenes` tiles are eager. | built: IG-09 on `/journal` and `/scenes` is gone |
| 19 | reverted, kept as a documented exception | The transform version played the bar's move back from its new place, which is wrong whenever the bar is not stuck: a browser test (owner's scrolling report) caught it drawn up to 66px above its place on a quick scroll up. The bar's sticky `top` transition is back. DESIGN.md §6 records why this one layout property is animated. | Flick-up test: 0px off at 375 and 1440 (66px before); scroll sweep clean. |
| 20 | fixed (round 2) | A new `--dur-ui` (280ms) covers the header's slide, the section bar that follows it, the lightbox opening and a photo step (ease-out). The tile hover zoom is 280ms instead of 800ms. `--dur-base` (560ms) stays for the menu's woven bands. | computed `transition-duration` 0.28s on the header; `scan.json` has no MO-09 |
| 21 | fixed (round 2) | The scenes grid keeps its list across filters, so only arriving tiles play their wipe. A page opened again in the same visit comes back still: `MotionLayer` sets `data-seen` on the root before paint, and `motion.css` turns its entrances off. | After a filter, 0 tiles are replaying. On home → /started → home, only the scroll-linked zoom runs. |
| 22 | fixed (round 2) | The home portrait's wipe starts at once and lasts 500ms (`--enter-dur`), and the image loads with `fetchPriority="high"`. | computed `0.5s`, delay `0s` |
| 23 | fixed (round 2) | The sequential pop starts at `translateY(24px) scale(.95)`. | source |
| 24 | fixed (round 2) | All 20 hover rules are inside `@media (hover: hover)`. One rule in `globals.css` gives every enabled button on the site a 1px press; it uses `translate`, which adds to any transform, and `.action` uses the same. The menu's «القائمة», «إغلاق» and bands, and the lightbox's «إغلاق», underline on hover. | No top-level `:hover` rule in the page's CSSOM. A pressed filter reads `translate: 0 1px`. |
| 25 | fixed (round 2) | Round 1 kept the current link in view. Round 2 adds a 48px fade at any end of the strip that has more links past it. The fade follows the strip's scroll position and a `ResizeObserver`, so the arrival of the fonts counts. | At 360: the fade is at the end while the strip is at its start, and at the start once scrolled to the end. None at 1440. `book-strip-360*.png` |
| 26 | fixed (round 2) | Each film cell on `/built` is as wide as its 9:14 film at the 86vh cap, and the pair is centred, so the two films meet edge to edge. | At 1440 the cells are 498px each, from x = 222 to 1218; at 360, 180px each |
| 27 | fixed (round 2) | `/started`'s family films are framed at 16:9. Each file is 9:16 with the sharp scene centred between blurred copies, so `object-fit: cover` at 16:9 shows only the sharp scene. The row holds two 16:9 tiles of up to 560px. | 320×180 at 360, 560×315 at 1440; `started-films-*.png` |
| 28 | fixed (round 2) | 15px (`--size-label`) is the floor for Arabic text. This covers the tile tag, the lightbox category, the corner caption, the journal tag, a film's status and the logo names. | computed 15px on each |
| 29 | fixed (round 2) | The filter is a plain group (`role="group"`) of toggle buttons. A polite status line says what it left, with Arabic number agreement: «أماكن: 7 صور». The e2e test checks it. | `public.spec.ts`, the scenes filter test |
| 30 | fixed (round 2) | Crenels and the weave start from the right (`100% 0`), so a partial tile falls on the left. | computed `background-position: 100% 0px` |
| 31 | fixed (round 2) | Turnstile renders with `language: 'ar'` and `theme: 'light'`, from one `TURNSTILE_LOOK` shared by contact and checkout. | the widget's frame URL ends `…/light/…?lang=ar` |
| 32 | fixed (round 2) | The store, cart and checkout use `ActionButton` and `ActionLink`: solid for add, continue and confirm, outline for apply and cancel. The store's own `.button` is deleted. The sign-in carries the site's mark, the serif at `.t-h3` in aubergine, and square corners. | `sign-in-360.png`, `product-*.png`; `cart-checkout.spec.ts` 11/11 |
| 33 | fixed (round 2) | The sign-in is a `<main>`. The admin layout and the global 404 set `theme-color`. | `out/admin/sign-in.html` has one `<main>`. `theme-color` is in `out/404.html`, `out/_not-found.html` and every admin page (built QA-14: 32 → 0). |
| 34 | fixed (round 2) | `/built` and `/passed` now have `<h2>`s. A line on its own band opens a stretch of text, so `StatementBand` and `StoryText` take a `heading` flag, used on these two rooms. On `/built`: its intro band, «لم أكن وحدي في هذه الحكاية», the seven-branches line and the closing line. On `/passed`: its band line and the products' line. Rooms with year headings keep theirs. | headings list read in the browser |
| 35 | fixed (round 2) | `typeset()` binds a separator « · » to the word before it with a no-break space, so «·» never starts a line. | unit test in `design-b.test.ts`; the home door's text holds a no-break space before «·» |
| 36 | fixed (round 2) | The error page says what happened: «تعذّر عرض هذه الصفحة». The sign-in's rate limit says why and what to do: «أُرسلت رموز كثيرة في وقت قصير. انتظر قليلًا ثم اطلب رمزًا جديدًا.» It gives no minute count, because the limit is per hour in the local config and is set by the host in production. | source |

## Checks

- `pnpm check`: lint 0 errors (3 old admin `<img>` warnings), `tsc` passes, frozen, copy, and unit 382/382.
- `pnpm build` against the local Supabase stack.
- tasmeem, all output in this folder:
  - `scan src`;
  - `built out`;
  - `render` at 360, 768, 1024 and 1440 on 15 routes, plus a motion render of `/` and `/book`;
  - `report --design EXCEPTIONS.md`, giving `measured.md`.
- No e2e and no visual suite ran (acceptance only). Free RAM was 10 GB.
- One e2e comment was updated, because checkout no longer disables submit while it waits for the token: `cart-checkout.spec.ts:292`.
- Side effects, all undone: one demo item in the in-app browser's cart, removed; the checkout-session key, removed. No order was created.

## Browser test after the owner's scrolling report (2026-09-28)

Real wheel input in 60px steps, down each page and part way back up, every frame recorded (scroll position, header state, the book's section bar, layout shifts, long frames). The ten public pages were run at 375 (touch) and 1440, with reduced motion and with motion allowed: 40 runs.

- **Clean everywhere else:**
  - no scroll jumps and no header flicker (3 toggles per run: hide, show, hide);
  - zero layout shift;
  - no console errors;
  - no long frames, apart from one 150ms frame right after a recompile, which did not repeat.
- **Found on /book, and fixed:**
  - **The section bar's labels jumped sideways.** The triangle was inserted into the current link, so every later label moved 20px each time the section changed (in the owner's pane too). Every link now keeps the triangle's room, hidden unless current, and the positions stay the same through all five sections.
  - **Row 19's transform drew the bar out of place.** See row 19 above.
  - **Row 25, partly.** The strip now scrolls sideways to keep the current link in view («الطلب» was cut at the edge), and goes back to its start on «نبذة». It still gives no visible hint that it continues.

## Round 2 checks (2026-09-28)

- `pnpm check`: lint 0 errors (the 3 old admin `<img>` warnings), types, frozen, copy, unit 382/382.
- `pnpm build`, `check:export` (25 files, no secrets), `check:budgets` (largest 145.9 KiB of 150).
- e2e against the dev server, workers 1, free RAM 8.8 GB:
  - `public` 26/26, `cart-checkout` 11/11, `auth` 2/2;
  - `visual` 50/50, with the screenshots refreshed in `../../screenshots/`;
  - `cms` 3/3, `media` 8/8.
- `stuck.mjs` on the static export with motion on: 0 held reveals on all 10 pages at 1440 and 390, and no script errors.
- tasmeem `scan`, `built` and `render` were rewritten in this folder (15 routes × 4 widths, plus motion renders of `/` and `/book`); `measured.md` is as above.
- impeccable detect on the changed files: clean. avoid-ai-design: the same 4 × SD5 as the baseline, all brand exceptions (the two-tone headline, the name bands, the book's accent).
- `verify-rows.mjs` (session scratchpad) read each row live; its screenshots are in `rows-16-36/`.
  - Playwright's screenshot hides the caret, which raced hydration on pages with inputs and logged a hydration warning.
  - The same pages loaded without a screenshot logged none.
- The media and cart-checkout suites also rewrite screenshots under `artifacts/acceptance/P05/` and `P07/`. Those packages are accepted and outside the lock, so their files were restored to the committed versions.
