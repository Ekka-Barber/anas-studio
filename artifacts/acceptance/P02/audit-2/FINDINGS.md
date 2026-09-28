# Audit round 2 · 2026-09-28 · findings only, no changes

This audit answers the owner's three questions of 2026-09-28:
1. "Not all pages have transition animations while scrolling. Why?"
2. "Did all the design tests pass?"
3. "On the reader, clicking the bottom-left corner turns the page; clicking the bottom-right corner has no flipping effect."

It was run by the orchestrator (Opus 5.5, solo) against the dev server (`:3000`, what the owner's pane shows) and the static export (`out/`, `:4010`, what production serves). The probes are in `probes/` and the video frames in `frames/`.

## A. Scroll and page motion across the site

### A1. On the dev server, no page animates (high, dev only)

**Symptom.** On `pnpm dev`, a fresh load of any page marks the page as already seen: `<html data-seen>`. The page-open entrances are switched off (`:root[data-seen] [data-enter] { animation: none }`), and no scroll reveal is mounted.

**Measured on a fresh browser context at 1440 and 390.**
- Dev: reveals played while scrolling to the end of the page = **0** on all 15 pages (`probes/motion-dev.json`).
- Export: every reveal on the page plays (`probes/motion-export.json`), for example:
  - `/` 18/18;
  - `/started` 45;
  - `/shelf` 54/54;
  - `/book` 26/26.

**Cause.**
- `next.config.ts` has `reactStrictMode: true`. In development, React runs every effect twice: mount, clean up, mount.
- `MotionLayer`'s first run adds the path to `opened` and mounts the reveals. The cleanup releases them. The second run finds the path in `opened`, takes it for a return visit and sets `data-seen`.
- Production runs effects once, so the export is correct.

**What is left on dev.** Only the CSS scroll-linked zoom still moves (`.motion-scrub` / `.motion-expand` are not tied to `data-seen`), on the pages that have one:
- home, `/book`, `/built`, `/passed`, `/shelf`, `/journal`.

The pages without one stand still:
- `/started`, `/scenes`, `/contact`, and the store pages.

That matches "not all pages".

A dev-only failure still misleads every review done in the pane, and the StrictMode double run is a fair model of a real remount.

### A2. Pages that have no motion of their own, in production too (medium)

Main content with no page-open entrance and no scroll reveal (only the footer's two reveals move):

| Page | Kind | Screens at 1440 |
|---|---|---|
| `/store` | store listing | 2 |
| `/store/[slug]` | product | 2 |
| `/cart` | task flow | 2 |
| `/checkout` | task flow | 2 |
| `/policies/[slug]` | reading | 2 |

- `/scenes` has its two entrances, but the photo grid (3–4 screens) has no reveal.
- `/journal` is one screen with its entrances; it is fine.

### A3. A page seen before in the same visit comes back still (by design, worth revisiting)

- DESIGN-B chose it: `MotionLayer` sets `data-seen` on a return (the Back button, or a link back). The page-open entrance and every scroll reveal are skipped.
- To someone moving between pages, it reads as "this page has no animation".
- Option: skip only the page-open entrance on a return, and keep the scroll reveals below the fold. They never hold what is already on screen.

## B. The design tests

All pass, and none of them can see A1 or A2:
- `pnpm check`: unit 397/397.
- Public and visual: 76/76.
- Reader: 14/14, on dev and on the export.
- tasmeem: PASS.

Why each missed it:
- `tests/e2e/visual.spec.ts` runs with `reducedMotion: 'reduce'` on purpose, so its screenshots show the finished page.
- The motion check (`tasmeem render --motion`, "held reveals") proves nothing stays hidden. A page where no reveal is ever mounted passes it trivially: that is how `/book` showed "0 held" on dev.
- No test asserts that reveals play, or that every page has motion.

**Gap:** a test that loads each public page with motion allowed, scrolls it, and counts played reveals (the probe `probes/motion-inventory.mjs`, turned into an e2e), on the dev server and on the export.

## C. The reader: the bottom-right corner

**Could not reproduce a dead corner.** Both corners turn the page, with the animation, in every run:
- 1440 (two pages), 693 and 390 (one page);
- headless Chrome with the GPU;
- a real pointer in the pane, in a new tab and in the owner's own tab.

On video, a click on either corner turns the page in about 0.55s:
- `frames/sheet-*-right.png`;
- `probes/corner-clicks-video.json`;
- in the pane, 33 turning frames for each direction.

What the probes did find, and what most likely looked like "no flipping":

### C1. One page at a time, a tap stops on an empty page (high)

**Symptom.**
- Below 800px (the owner's pane is 390 wide) the book shows one page. The arrows and ← → skip the blank back of a page and the inside cover (`turn()`).
- A tap, a click or a drag on the page is page-flip's own turn. It does not go through `turn()`, so it stops on those empty leaves:
  - the page is blank;
  - the counter under the book goes empty.
- The owner's own tab was found sitting on such a blank page with an empty label.
- From «المقدمة 2/5», a click on the bottom-right corner turns back onto the blank back of the dedication. The next click turns a blank sheet over a blank sheet, which barely reads as a turn.

**Proof.** `probes/click-corners.mjs`, at 693 and 390:
- page 1 → (left) blank → page 2 → page 3 → (right) page 2 → blank → page 1.

### C2. In one-page view, the hint, the tap zones and the hover peel disagree (medium)

- **The hint.** The lifted-corner hint sits on the bottom-left (the next page).
- **The tap zones.** page-flip splits the page 40/60:
  - a tap on the left 40% goes forward;
  - a tap on the right 60% goes back, including the middle of the page, where a phone reader taps most.
- **The hover peel.** page-flip only peels on hover at the outer corners of its two-page box. In one-page view that is the right edge only, so hovering the bottom-left, where the hint is, shows no peel.
- Together:
  - hovering the right corner peels the page, and a tap there turns back;
  - hovering the left corner shows only the static hint, and a tap there turns forward.
- The owner's right/left experience differs even though both work.
- Source: the zones and the peel come from page-flip 2.0.7's code (`src/Flip/Flip.ts`, `getDirectionByPoint` and `isPointOnCorners`, measured against the one-page box). The probes clicked near each edge, not at the 40% line.

### C3. A click that closes the book slides it afterwards (low)

- At the first or last spread, a click on the outer corner closes the book.
- `data-at` (the slide to the middle) is set only after page-flip's `flip` event, when the turn has ended. So the board swings, then the book jumps sideways as a second, separate move.
- The arrows and keys set it before the turn, so there the slide runs with the turn.

### C4. The inside cover is labelled «الغلاف» (low)

In one-page view, the endpaper (coffee board, the mark) shows «الغلاف» under the book, but it is the inside of the cover.

### C5. No test covers these

`tests/e2e/reader.spec.ts` turns with keys, buttons and one drag from the left page. No test clicks the right corner, or taps a page in one-page view and checks where it lands.

## Proposed fixes (not applied)

| # | Fix | Size |
|---|---|---|
| A1 | `MotionLayer`: count a return only when the path changes (a StrictMode re-run of the same path mounts again). Add the motion e2e from B, on dev and on the export. | small |
| A2 | Entrances for the store listing, the product page and the scenes grid, as on the rooms (a page-open entrance plus reveals). Cart, checkout and the policies get only the title's entrance: task and reading pages stay calm. | medium |
| A3 | On a return, skip the page-open entrance only; the scroll reveals play again. Owner's call. | small |
| C1 | Every turn goes through one path: page-flip's own click and drag included. On a `flip` event that lands on a blank or an endpaper in one-page view, carry on to the next page with something on it, in the same direction. | small |
| C2 | In one-page view, take the page's taps ourselves: the left half is next, the right half is previous (disable page-flip's click, keep its drag). Show the lifted-corner hint on both sides, forward on the left and back on the right, with the back one quieter. | small |
| C3 | Set `data-at` on page-flip's `changeState` → `flipping`, from the direction of the turn, so the slide runs with the board. | small |
| C4 | Label the endpaper as the inside of the cover, or skip it in one-page view entirely (C1 already does). | trivial |
| C5 | e2e: click both corners at 1440 and at 390, and check the turn lands on a page with text and the label is never empty. | small |

## Result (2026-09-28, owner: "go, yes on 3", money pages "serious and official", "once all fixes done commit")

| # | Result |
|---|---|
| A1 | Fixed: `MotionLayer` keeps its decision for a re-run of the same page. On dev every held reveal now plays (motion e2e, 10 story pages). |
| A2 | Fixed. The store list, a product and the scenes grid have entrances and reveals, and their prices and buy controls never move. The cart, the checkout and the policies are calm and official: a plain head with a rule, a modest title, the summary panel, tabular digits, only the title's 280ms fade and no reveals. Before and after: `after/sheet-before-*.png`, `after/sheet-after-*.png`. |
| A3 | Done (the owner chose yes): a return skips the entrances only; the reveals play. |
| B | Closed: `tests/e2e/motion.spec.ts` (15 tests), on dev and on the export. |
| C1 | Fixed: one page at a time, clicks turn by half and skip empty leaves; a drag or swipe carries on past them. |
| C2 | Fixed: halves instead of page-flip's 40/60, no hover peel in one-page view, hints on both sides (`after/hints-1440.png`). |
| C3 | Fixed: `data-at` is set when a corner click starts the turn. |
| C4 | Moot: the endpaper is never a resting page in one-page view. |
| C5 | Closed: 4 new reader tests (click halves, drag, hints, corner close). |

Proof: `../commands.txt`, "Round 3, audit-2".
