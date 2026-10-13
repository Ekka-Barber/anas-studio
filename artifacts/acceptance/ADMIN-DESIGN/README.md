# ADMIN-DESIGN: the admin redesigned to the public site's standard (D49)

The owner, 2026-10-08: "I think we did not make our admin page has best design work like what we had done on the landing page !! I think it looks awdol !!"; then, asked when and how: "after S , before D , but use all skills been used like /tasmeem and \impeccable .. etc the one we used in the landingpage and all other pages , but need the best dashboard ever", and "All screens, then review". D49 records it.

Orchestrator and designer: Claude Opus 5.5 at effort max, FABLE-AUDIT's cloud continuation session (D48), alone, as D39 set for design work. Designed 2026-10-08 in a scratch copy of the site (three drafts), ported onto round S (`4543c99`) on 2026-10-13. Auditor: Claude Opus 5.5 at effort max.

## What changed

Five files of the product, a token file, and DESIGN.md:

| File | Change |
|---|---|
| `src/components/admin/admin.module.css` | Rewritten: every class it had is kept, eleven are added (`rail`, `railInner`, `brand`, `mark`, `brandName`, `brandDomain`, `navGroup`, `navLink`, `signOut`, `home`, and `cellCode` after the final audit) |
| `src/components/admin/AdminShell.tsx` | The rail (`<header data-tone="night">`) with the mark drawn in CSS, «أنس» and «anas.studio»; the nav's links in four groups (the same links for each role, in the same order); `currentEntry()` marks the link of the screen in view with `aria-current="page"`; below 1280px, the strip's fade flags (an IntersectionObserver on its first and last controls), and the current link, and a control the keyboard focuses, kept whole in view |
| `src/components/admin/AdminHome.tsx` | The root element takes `styles.home` (the panels' two-column flow) |
| `src/components/admin/OrderView.tsx` | A shipment's tracking number's cell takes `cellCode`: from 768px its column keeps the usual codes, up to about 18 characters, on one line, and a longer one breaks (the final audit's AD-F2 and the fix check's AD-G1) |
| `tests/unit/admin-ops.test.ts` | A test for `currentEntry`: each screen's link, the home only by itself, none for a lookalike path, the sign-in or the preview |
| `src/styles/tokens.css` | The admin's place-named sizes: `--size-admin-title`, `--size-admin-section`, `--size-admin-door`, `--size-admin-dialog`, `--size-admin-legend`, `--size-sign-in` (DESIGN.md: no component module sets a size in pixels) |
| `DESIGN.md` | Section 10, «The admin» (the checks become section 11); the colour, breakpoint and place-token lines of sections 1 to 3 follow it |

What the screens do is unchanged: every route, role gate, label, accessible name, `data-label` and the page structure the e2e specs read (`contract.md`, from the specs as they were read on 2026-10-08).

## How it was made

- The direction (`direction.md`): tasmeem's direction protocol in redesign mode and impeccable's Operate mode: the identity lock (direction B «أنساق», D39), the design read, the scene (Anas on a phone between shifts, at a laptop at night), the subject's nouns, the dials (variance 3, motion 2, density 6), the colour strategy, type, layout and signature, the reflex check, and the hard constraints from the specs.
- The harness (`harness/`, its README): every admin screen drawn in Chromium by `next dev` with all of its Supabase calls answered by mock data, a seeded session and a fixed clock (2026-10-08 10:30 Riyadh), with no database and no login: 62 screens at 360 and 1440 wide (the shell's gate screen was added after the audit), 124 shots a run, each with its overflow, console errors, unmocked calls and settle state in `report.json`; `--widths`, `--height` and `--scrollbars` draw other viewports and classic scrollbars.
- The gates, run on the final set: tasmeem's in-page audit on every shot (`gate/page-audit.expr.js`, tasmeem's own `pageAudit` passed to the harness as `--eval`), tasmeem's static scan of `src/components/admin`, impeccable's detector on the three changed files, the contrast of every new colour pair (`tasmeem contrast`), `tools/classcheck.mjs` (every `styles.X` the 31 admin files use is a class the stylesheet defines), `gate/verify.expr.js` (the shell's own checks after the audit: page and table boxes, the rail, the phone strip, focus rings, the gate) at 360, 768, 1024, 1280, 1366 and 1440, and the re-auditor's driver (`tools/driver.mjs`) for what a one-shot page cannot show: resizes, navigation, a role change, real Tab presses, a late web font, short windows, classic scrollbars, the skip link and the sign-out.

## Results (the final set, shot from the working tree on top of `e8072e5`, with the final audit's fixes)

- The final set (`final5`, 124 shots, its order views re-shot after the tracking cell's last change): every shot settled; no horizontal overflow; no page error; no unmocked call; no screen left unhydrated; no console error but the ones the mock answers on purpose (a 500 on `orders-failed`, a 403 on `team-step-up-dialog`, the gate screen's own 500s). The five dialogs are shot 1.5 s after they settle (`--delay 1500`), so the strip under their backdrop has painted.
- `gate/verify.expr.js` on all 62 screens at 360, 768, 1024, 1280, 1366 and 1440 (`verify5`, 372 views, every one settled, no console error from the app):
  - No page scrolls sideways at any width. The shell's gate is 512px wide (328px at 360).
  - The rail's box never scrolls sideways and draws no scrollbar; on a wide screen it holds its contents (0px taller than the viewport on every view). The current page's tab covers the weave and the weave shows beside the other links on 147 of 147 views (every view from 1280 with a current link, but the five dialogs, whose backdrop is on top).
  - Below 1280 the current link is in the strip on 162 of 162 views (the dialogs' too: the strip lies under their backdrop). At rest the fade flags point at the hidden links: `01` (more past the far end), `11` (the current link mid-strip), `00` (nothing hidden: the editor's shorter nav at 768 and 1024).
  - Every control of the nav, focused in turn on 306 views (the five dialogs aside, whose nav is inert under the modal): the 2,934 focuses that draw a ring have it inside the box that clips it and clear of a fade. On the three screens the harness sets up with a click (the library, the refund's confirmation, the dispute form) a scripted focus is not `:focus-visible` (198 focuses): it draws no ring and, like a press, does not move the strip, so the probe counts it apart; real Tab presses draw the ring and bring the control into view (the driver, below).
  - Tables: none scrolls inside its box at 360 (the card view, and the version tables with their phone-sized buttons), 1024, 1280, 1366 or 1440. At 768 the orders list scrolls 87px inside its box (HEAD's: 328px, `probe-cols-site`) and the mail 174px, its buttons on one line (HEAD's: 338px, and HEAD's page itself overflowed by 193px, the first auditor's `audit-before-vh`): the established pattern for wide tables. Between the cards and 1024 more of them do (`mid5`, every screen at 481, 600 and 900, no page overflow on any): at 481 the customers 176px, the notifications 239px, the orders list 374px, the order views' tables up to 102px, the mail 461px and the team 172px; at 600 the customers 57px, the notifications 120px, the orders list 255px, the mail 342px and the team 53px; at 900 the mail 46px.
- The mail and the order views from 360 to 1440 (`f2c`, at 360, 481, 540, 600, 650, 700, 768, 900, 1024, 1280, 1366 and 1440, `fix-tools/f2.expr.js`; `f2` before it at 1300 to 1340): no button in a table taller than its one line; a shipment's tracking number on one line from 768 and in the card at 360, broken over three to five lines from 481 to 700 where its column is narrow; the order views' tables scroll inside their box only at 481 and 540 (at 481 the shipments table 98px, as at `e8072e5`; HEAD 156px); the mail fits from 1024. With tracking numbers of other lengths in the same cell (`fa-trackch2`): 14, 15 and 18 characters on one line from 768 to 1440, 22 on two, 120 on three to six, and the table never scrolls inside its box.
- Classic scrollbars at 768 and 1024 (`sb5`, the home, the orders, the mail and the team): the strip keeps the current link in view, and its fade flags and focus rings hold; the page never scrolls sideways. That the strip draws its scrollbar for a mouse rests on its computed `scrollbar-width: thin` (`fa-fix`) and on the fix check's own measure, a 10px bar wherever the strip overflows: the harness's full-page shots hide scrollbars, so `sb5`'s pictures cannot show it.
- The sign-in at 320 (`w320`): no horizontal overflow, the widget's stand-in included (HEAD 0; `e8072e5` 17px).
- The re-auditor's driver on the final code (`drv-r4`): resizes across 1280 both ways, down to 360 and to 768 x 1024; client navigation by the nav, by a link in the page and back; a role change each way (owner to editor, editor to owner, owner to operations) after the strip was swiped to its far end; real Tab presses at 360 x 800, 1280 x 720 and 1440 x 900, and at 768 and 1023; a web font 1.5 s and 2 s late; nine windows from 1280 x 600 to 1920 x 1080; classic scrollbars at 1280 x 720, 1366 x 657 and 1366 x 625; the skip link; the sign-out at 360 and 768. The current link is whole in view and clear of the fades after every resize, navigation, role change and late font, with the fade flags matching the strip's geometry at every step; the page never scrolls sideways; no Tab stop is cut, faded or without its ring (the dev server's own `nextjs-portal` aside); the rail is 0px taller than the window at every size, its sign-out above the window's bottom, with no scrollbar and the tab flush with the page; the sign-out's ring is unclipped; the skip link's ring is saffron on the night bar.
- The final auditor's own tests on the final code (`fa-fix`, its driver with one test added, `hydrwait`): a mouse click or a tap on each strip control partly in view, at 360, 412, 768, 1024 and 1100, navigates 8 times of 8 (`e8072e5`: 2 of 8); a press's focus is not `:focus-visible` and a Tab's is; Tab still brings each link whole into view; the strip's computed `scrollbar-width` is `thin` for a mouse; in the five dialogs no ring is clipped (the picker at 360: 0 of 10; `e8072e5` 5, HEAD 2); with the client's scripts held back 2.5 s, the page audit run at once still draws React's warning 3 times of 3, and run after the harness's new wait 0 times of 3.
- tasmeem scan of `src/components/admin`: 30 files, 0 findings. impeccable detect on the four changed files: no findings. `tools/classcheck.mjs`: the 58 classes the 31 admin files use are all defined.
- tasmeem's in-page audit, what remains and why it stays: LA-22 (a control's label wraps) on the content and store doors, the library's tiles and the previews, whose names are meant to wrap inside a large target; on the home's links (`a.target`) and on the version tables' «استعادة» at 360, each on one line: the rule reads a multi-word accessible name («استعادة النسخة 3») and counts a 44 or 46px target against its line; SC-15 (marks clipped) on visually hidden table headers (customers, mail), which are clipped on purpose; QA-03 (no `h1`) on `store-editor` and `gate-error`, whose markup is older than the redesign (recorded for P10); TY-12, TY-13 and QA-01 on `sign-in-widget`, all on the harness's own grey stand-in where Cloudflare's widget would be, which is not product code.
- Contrast (measured): aubergine on `--paper-page` 9.5:1; aubergine-muted on `--paper-page` 6.9:1, on paper 5.7:1, on sand 4.8:1; coral-deep on paper 5.8:1, on `--paper-page` 7.0:1, on sand 4.85:1; sand-50 on night 9.6:1; sand-muted on night 6.6:1 (the strip's scrollbar too); aubergine on sand-300 5.7:1; saffron (the rail's focus) on night 6.1:1; coral on night 3.9:1, a shape only. Aubergine-muted on sand-300 is 4.2:1 and is never used for text.
- Pages are longer: the 57 full-page screens are 26% taller in total at 360 and 16% at 1440 (the site settings form: 14,331 to 18,203 px at 360), from 46px controls, panel padding and ruled rows. Stated to the owner with the review.
- The design copy (Next.js 16.3.5) and the final copy (16.3.8) render the same screens byte-identically, so round S's Next.js update changed nothing visible.
- CI on `e8072e5` (run 38425748094): green; the 25 public pages' JavaScript budgets identical to `107054c`'s (largest 149.6 KiB of 150); the admin is not budgeted.

## The audit (Opus 5.5 at effort max, 2026-10-13): audit_failed; the orchestrator's rulings

The auditor confirmed what must not change: every screen's `main` structure, with classes and styles stripped, identical to HEAD's on all 122 views; the nav, its links, hrefs and order, the sign-out inside it, for each role; `currentEntry` on all 17 route patterns; the unit test (7 mutants, all killed); the e2e contract; every contrast pair; logical properties only; the gates. Its findings, all fixed by the orchestrator:

| Finding | Ruling and fix |
|---|---|
| AD-A1 major: the mail table scrolled sideways where HEAD's did not (3px at 360, 20px at 1440; at 1024 the page by 244px, a visually hidden header escaping its box), a regression owner-operations.spec.ts:743 guards | Fixed: HEAD's 8px cells (12px at a row's ends), headers may take two lines, table data compact at 16px, the table box holds its hidden labels (`position: relative`), one-line cells wrap in the card view. The mail at 360 and 1440: 0 |
| AD-A2 major: the phone strip faded its start, not its far end, and left the current tab off-screen on 32 of 54 screens | Fixed: the strip fades only toward controls out of view, and keeps the current page's link in view on each route (as SectionNav does) |
| AD-A3 minor: other tables widened and scrolled in their box | Fixed with AD-A1 at 360 and 1440; between 768 and 1280 the orders list and the mail scroll inside their box, as HEAD's orders list did (the rail takes 16.5rem from 1024) |
| AD-A4 minor: the rail clipped the tab's overhang and scrolled 28px sideways; focus rings clipped | Fixed: the weave lies under the rail box's own end padding, with the box above it, so the tab covers the weave inside the box; rings 6px inside a nav link, aubergine on the sand tab |
| AD-A5 minor: a card's first and last cells indented | Fixed: every cell of a card starts at its edge |
| AD-A6 minor: the shell's gate squeezed into the rail's column | Fixed: the gate takes the row; the harness draws it (`gate-error`) |
| AD-A7 minor: the owner's rail taller than a 720px viewport | Fixed: under 820px of height the rail tightens; at 1280 x 720 it fits |
| AD-A8 minor: DESIGN.md claims not true to the code | Fixed in the code (no field or editor past the reading measure; the strip; the tab) and in the words (targets, the focus ring, the home's ways onward, the brand line) |
| AD-A9 minor: eight pixel font sizes | Fixed: `--size-brand` and six place-named tokens |
| AD-A10 nit: "the crenel standing on its head" | Reworded: the crenel along its top |
| AD-A11 nit: a long address pushed cards and the customer form sideways | Fixed: card cells and a read-only value break |
| AD-A12 nit: two dialog shots without the strip painted | Fixed: the dialogs are shot after 1.5 s |

Found by the orchestrator while checking the fixes: the gate's message, a 26px serif line, had line-height 1.35 (tasmeem SC-03, on the new gate screen): 1.6, DESIGN.md's rule for a serif line under 28px; tasmeem MO-17 on the strip's first scroll listener: replaced by the IntersectionObserver.

## The re-audit (a fresh Opus 5.5 at effort max, 2026-10-13): audit_failed; the orchestrator's rulings

Confirmed closed by its own measurements: AD-A1 (the specs' own expressions: owner-operations.spec.ts:722-743 at 360x740 and 1440x900, store-admin.spec.ts:404-406, orders-admin.spec.ts:375, with the mock rows and with the specs' own row text), AD-A5, AD-A6, AD-A9, AD-A10, AD-A11, AD-A12. Partly closed: AD-A2, AD-A3, AD-A4, AD-A7, AD-A8. New: AD-R1 to AD-R6. All fixed by the orchestrator:

| Finding | Ruling and fix |
|---|---|
| AD-R1 major: a control focused from the keyboard stayed cut under the strip's fade (Chromium does not scroll a focused control that is partly in view) | Fixed: a control focused in the strip is brought whole into view (one `focusin` listener, once per focus) |
| AD-A2 rest, AD-R2 minor: the current link left the strip when the rail turned into it, and the strip was placed before the web font arrived | Fixed: the strip's size is observed (a ResizeObserver, the rail turning into the strip included), and the current link is placed again once the fonts are ready |
| AD-A3 rest minor: tables scrolled inside their box from 1024 to 1366 (at 1280 the orders list 110px and the mail 124px, where HEAD's fit) | Fixed: the rail stands at the side from 1280px, the bar below it; below 1440px a one-line cell may wrap at its spaces, never inside a word; the version tables' buttons are narrower on a phone (15px label, still 46px tall) |
| AD-A4 rest: the sign-out's ring clipped at its top in the strip | Fixed: its ring is 6px inside, as the links' are |
| AD-A7 rest, AD-R3 minor: the rail too tall for short Windows laptop windows, then a scrollbar over the weave | Fixed: a second step under 700px of height, and the rail's box draws no scrollbar |
| AD-A8 rest: three DESIGN.md claims | Fixed: the words follow the code (the sign-out's ring, the strip kept on its current link, the window heights, the breakpoints line with the height steps and the cells) |
| AD-R4 nit: the skip link's ring invisible over the night bar (aubergine on night, 1.22:1) | Fixed: saffron, as globals.css draws it elsewhere |
| AD-R5 nit: forced colours lost the current link's triangle and the badge's box | Fixed: both drawn in the system's text colour, as the site's header does |
| AD-R6 nit: evidence claims | Fixed: the results below are re-measured (every nav control focused in turn; heights down to 600; the 768 band as measured); the harness gained `--delay`, so the dialogs' wait is in its code, and its screen table the gate screen |

The re-auditor's own driver (`driver.mjs`: resizes across the rail's breakpoint, client navigation, a role change, real Tab presses, a slow web font, short heights, classic scrollbars, the skip link, the sign-out) was run again on the fixed code; its results are in "Results".

## Found in the final runs (the orchestrator, before the final audit)

- A role change left the strip where a person had swiped it, with the current link out of view or under a fade (the driver's role case, in the re-auditor's run as in the orchestrator's). Fixed: a new role gives the strip other links, so the strip places its current link again (`navRole` among the keep-in-view effect's dependencies in `AdminShell.tsx`). In `drv-r3d` the current link is whole and clear of the fades after each of the three role changes. `final4` and `verify4` were shot before this fix, which changes nothing a screen draws as it loads (for one role the effect runs when it ran before): `hydr-a`, the 62 screens at 1440 shot on the fixed code, matches `final4` pixel for pixel on 60; the other two differ by timing, a picture of the built-room preview not yet decoded, and 14 pixels at the edge of the current link's triangle on the refund's confirmation, whose shot follows a typed amount (at 1440 the effect returns at once: the rail is not a scroller).
- tasmeem's LA-22 (a control's label wraps) on the eight content edit screens at 360, since the version tables' buttons became phone-sized (AD-A3 rest). The button's label, «استعادة», is one word on one line: the rule reads its accessible name («استعادة النسخة 3») and counts its 46px minimum height against the 15px label's line. The change it follows is the fix that made that button whole; in `final3` it was cut at the table's edge. Kept, and listed under "Results".
- Once, React's hydration warning on `sign-in` at 1440 in `final4` ("some attributes of the server rendered HTML didn't match the client properties"). The orchestrator could not reproduce it (none in `verify4`'s 372 views, in the whole 1440 set again, `hydr-a`, or in the three sign-in screens at 360 and 1440 twice more, `hydr-b` and `hydr-c`) and took it for a race in `next dev`. The final audit found the cause (AD-F4): the harness. tasmeem's page audit (`gate/page-audit.expr.js:83`) writes `data-tsm-font` on the elements it reads, and the sign-in is the one admin screen whose heading the server draws, so the harness's settle could pass, and the audit run, before React hydrated it; with the client's scripts held back 2.5 s the warning came 3 times of 3, its diff naming `data-tsm-font` on the heading, a label and the button. The product was never at fault. The harness now waits until React has hydrated every heading, label and button before an `--eval` runs, and keeps 4,000 characters of a console message.
- The before set is `e800fc5`'s admin. Round S, on top of it, changed two files the admin builds on, removing an unused type (`src/admin/fields.ts`) and an unused class (`src/components/weave/layout.module.css`), and its Next.js update renders the same screens byte-identically: `107054c` draws every screen of the before set as it is.

## The final audit (a fresh Opus 5.5 at effort max, 2026-10-13, on `e8072e5`): audit_failed; the orchestrator's rulings

Confirmed closed by its own measurements: AD-A1 to AD-A12 and AD-R1 to AD-R5 (the specs' own expressions on all 62 screens at 360 and 1440; the strip on 392 views from 320 to 1279; tables at ten widths; 412 card cells; 5,316 focus rings; the forced colours; the contrast pairs recomputed), the role fix, the LA-22 ruling and the before set; AD-R6 partly (new evidence errors below). New: AD-F1 to AD-F8. The orchestrator reproduced AD-F1 and AD-F3 with the auditor's own driver before ruling.

| Finding | Ruling and fix |
|---|---|
| AD-F1 major: a mouse click or a tap on a strip link partly in view did nothing (6 presses of 8): the press focuses the link on the way down, the strip's `focusin` scrolled it, and the press ended on the next link, so the click went to the nav. The e2e suites cannot show it: Playwright centres a link before it clicks | Fixed: the strip brings a focused control into view only when the keyboard focused it (`:focus-visible`); a press is left where it lands. The auditor's control showed the same gate lets every press navigate while Tab still brings each link whole into view |
| AD-F2 minor: below 1440px the one-line cell rule also reached the buttons in a row (the mail's «إعادة الإرسال» on two lines at 768 and 1280, the row's two buttons stacked), and a shipment's tracking number was cut over two lines at 1280 and 1366 | Fixed: the rule reaches table cells only (`td.cellNowrap`), so a button keeps its line (the mail's two buttons still stand one over the other, as HEAD's do at 1440); the tracking number keeps `.break`, and from 768px its cell holds 20ch (`cellCode`, `OrderView.tsx`), so the usual codes stay on one line and a longer one breaks rather than push the table past its box (a first fix kept it whole at every width, `.whole`, and made the table scroll: the fix check's AD-G1) |
| AD-F3 minor: below 1280px a plain mouse could not move the strip (no scrollbar; the wheel scrolls the page): at 768 «الأمان», «الفريق» and «تسجيل الخروج» were out of its reach | Fixed: where the pointer is fine and hovers, the strip keeps a thin scrollbar in the night's own ink (`scrollbar-color: var(--sand-muted) transparent`); a finger still swipes a bare strip |
| AD-F4 minor (evidence): the sign-in's hydration warning was the harness, not `next dev` | Fixed: the README says so ("Found in the final runs"); the harness waits for React's hydration before an `--eval` |
| AD-F5 nit (evidence): "147 of 147" for the strip (162 of 162 with the dialogs); the home's links missing from the LA-22 list; the review page's "every link and control is at least a 44 px target" (83 to 85 small controls in main on 32 or 33 screens, 93 before the redesign) | Fixed: the counts, the list, and DESIGN.md's own wording on targets in the review page |
| AD-F6 nit: below 337px the sign-in's padded form left the 300px Turnstile widget no room (the page scrolled 17px at 320; HEAD 0) | Fixed: below 360px the form's panel gives way to the page (no inline padding, border or ground) |
| AD-F7 nit: from 1280px wide and under 588px tall the rail scrolls with no visible bar | Accepted: the owner's eleven 44px controls cannot fit a shorter window; the rail scrolls by the wheel, a finger or the keyboard (Tab reaches the sign-out), and DESIGN.md now says so |
| AD-F8 nit (older than the redesign): in the picker, a tile that Tab scrolls into view had its ring cut at the bottom (5 of 10 stops at 360; HEAD 2 of 10) | Fixed: `scroll-padding-block: 8px` on the dialog |

The fixes' own evidence is in "Results" (the runs `final5`, `verify5`, `sb5`, `f2`, `w320`, `drv-r4` and `fa-fix`).

## The fix check (a fresh Opus 5.5 at effort max, 2026-10-13, on `bc9c743`): audit_failed; the orchestrator's rulings

Confirmed by its own measurements: AD-F1 closed (258 real presses of 258, mouse and touch, three roles, at 320 to 1279, on every strip control partly in view, each to the link pressed; 810 Tab and Shift+Tab stops, all `:focus-visible`, whole, ringed inside and clear of the fades; a press after the keyboard, a held press, a short drag, a swipe; and, from WebKit's and Gecko's sources, `:focus-visible` is set before `focusin` there too); AD-F3, AD-F4, AD-F5, AD-F6 and AD-F8 closed; AD-F7 accepted; the probe's change honest; AD-F2 partly, for AD-G1. Residual, from Firefox's source: with its non-default `browser.display.show_focus_rings` a press's focus matches `:focus-visible`, so a press there could still scroll the strip.

| Finding | Ruling and fix |
|---|---|
| AD-G1 minor: `.whole` held the tracking number on one line at every width, so its column could not shrink: the shipments table scrolled inside its box from 481 to 650 where `e8072e5`'s fit (at 481 196px against 98px), and a long number scrolled it at any width (120 characters: 558 to 777px from 1024) | Fixed as the check proposed and measured: the number keeps `.break`, and from 768px its cell holds 20ch (`cellCode`), which keeps the usual codes (up to about 18 characters) on one line; a longer one, or a narrower table, breaks it (Results: `f2c`, `fa-trackch2`) |
| AD-G2 nit: on the review page, the "needs a change" triangle of the screen in view stayed coral-deep on the ink fill (1.69:1 in the new dark mode, 1.36:1 in light, older than the dark mode) | Fixed: on that row the triangle takes the fill's own light colour, as the approve square does; its shape tells it apart |
| AD-G3 nit: DESIGN.md said the sign-in form sits on a paper panel (none below 360px); this README credited `sb5`'s pictures with the strip's scrollbar (full-page shots hide scrollbars); the review page said only 768 scrolls a table inside its box (481 to 900 do too) | Fixed: the three sentences say what is measured (Results: `mid5`, `fa-fix`) |

The audits close on these fixes with the orchestrator's measurements, not a fourth audit: AD-G1's fix is the check's own, tried by it in the page and measured here at twelve widths and five lengths, and AD-G2 and AD-G3 change no product code. What the redesign still waits for before it is accepted is the owner's review and the admin e2e suites on the owner's machine ("Still open"); the Fable deep audit (D48) reads the whole round before `main` moves.

## The owner's review

`admin-review.html` is the review page: every screen before and after at both widths, with a mark (approve, or needs a change) and a note per screen, published to the owner as a private page. Its source is `review/` (`node tools/webp.mjs <run> before|after`, `node tools/meta.mjs`, `node review/build.mjs`).

## Still open

- The owner's review of every screen (D49: "All screens, then review").
- The admin e2e suites on the owner's machine before acceptance (the specs need the local stack): `auth`, `cms`, `media`, `owner-operations`, `store-admin`, `orders-admin`, `orders-money` and `orders` (`tests/e2e/`).
- `store-editor` and the shell's gate have no `h1` (their markup is older than this round): P10's accessibility pass.
- At 768, a tablet's width, the orders list and the mail scroll inside their own box, by 87 and 174px (at 360 they are cards, and from 1024 they fit): a narrower design of those two tables is P10's, if the owner wants one.
- From 1280px wide and under about 590px tall, the rail scrolls with no visible bar (the final audit's AD-F7, accepted): the wheel, a finger and the keyboard reach all of it.
- A tap on the strip on a real phone, and a click on it with a mouse in a window about 1024px wide: the final audit's AD-F1 is closed in Chromium's emulation of both; the owner's own devices are the last proof.

## Files

| Path | What |
|---|---|
| `contract.md` | What the e2e specs rely on, read from the specs |
| `direction.md` | The design direction |
| `harness/` | The screenshot harness and its README (run it on a copy of the site, never a working tree) |
| `gate/page-audit.expr.js` | tasmeem's in-page audit as one expression for the harness's `--eval` |
| `gate/verify.expr.js` | The shell's own checks after the audit, for the harness's `--eval` |
| `tools/` | `classcheck.mjs`, `webp.mjs` (a harness run to WebP), `meta.mjs` (the review's screen list) |
| `shots/before/`, `shots/after/` | The two sets in WebP (quality 82; a shot taller than 16,000px in parts), each with `manifest.json` and the run's `report.json` |
| `review/` | The review page's template, builder, config and screen list |
| `admin-review.html` | The built review page |
