# The P02 book reader, after the audit · 2026-09-28

The owner read `../FINDINGS.md` and chose (2026-09-28):
- a book shape that suits the site: "I am not taking care of the book, my own consideration is our app design";
- then "GO AHEAD DO THE BEST, VERY THOUGHTFULLY".

The orchestrator (Opus 5.5, solo) acted on every finding under the P02 lock.

## Decisions taken for the owner

- **The book is 4:5 (8×10 in).** That is cover B's own shape (1792×2240), inside the hardcover range the owner named (6×9 to 8.5×11). A4 is office paper, not a book size.
- **Phones open the book** (one page at a time, turning). «عرض للقراءة» is one tap away for reading closely.
- **Without motion, a turn is a 150ms fade,** never a 3D rotation.

## Per finding

| # | Finding | Result | What changed | Proof |
|---|---|---|---|---|
| 1 | The page turn is missing where the owner looks | fixed | Phones open the book (no more list first). Under reduced motion the book dips out and back in (`data-fading`, 150ms); before, the turn was instant with nothing in between. | e2e: the fade's attribute log is `out, in`; the phone test turns pages in the book |
| 2 | The pages can't be read in the book | improved, with a reading view | One page at a time below 800px. Each page is shown through a 4:5 frame around its text, so the words are larger than on the A4 sheet. «عرض للقراءة» shows the pages at up to 880px wide and opens at the page in view. | Text size (probe median), before → after: 1440 8.6 → 9.6px, 1024 7.4 → 7.9px, 693 5.4 → 8.7px, 360 5.6 → 5.5px. Reading view at 1440 is about 16px. |
| 3 | The pages are manuscript drafts | open (asset gap), eased | The warm paper and the 4:5 frame make them sheets of the book, with the words untouched. The typeset interior, once it exists, goes through `prepare-preview.py` unchanged. | — |
| 4 | The cover is shorter than the pages | fixed | Every leaf is 4:5, the cover's own shape: the closed cover, the cover leaf and the pages are the same size. | Cover leaf 562×702 at 1440 with no bars (was 41px bars above and below); closed ratio 1.25 = page ratio 1.25 |
| 5 | The open book has no body | fixed | Boards of cover linen around the page block, and a cast shadow. The page edges thin from the unread side to the read side as you go. The spine's shadow on every page. | `1440-c-open.png`, `1440-e-end.png` |
| 6 | Pure white paper | fixed | `--paper-page` #F7F0E5: pdf.js draws on it (its `background` option), and the leaves and sheets use it. | Black text on it is 18.6:1; tokens.css, DESIGN.md §1 |
| 7 | The turn reads weakly | fixed | The shading is at 60%, on warm paper. The endpaper and cover swing as hard boards. | `open-seq-1440.png`, `turn-mid-1440.png`, `video/turn-1440.webm` |
| 8 | The physical order is wrong | fixed | Endpapers inside both covers. The dedication is on the first left-hand page, and each part starts on a left page. The back endpaper faces a blank, before the back cover. | `leafPlan` unit tests; the e2e spreads |
| 9 | The turn stutters | resolved on real hardware | Text layers hide while a page turns; the book's canvases stop at 1.5×. With the GPU (Intel Iris Xe) a turn at 1440 has 0–1 frames over 32ms in three runs (one 150ms hitch on the very first turn). The stutter measured before came from software rendering (SwiftShader: still about 13 of 54). | `turn-gpu` run, recorded in `../../commands.txt` |
| 10 | Opening the book jumps the page | fixed | The closed book, the loading state (the same controls, disabled) and the open book share one stage. | Section height, closed → loading → open: 1440 1405/1405/1405, 693 1106/1106/1106, 360 942/942/942 (was 1005 → 581 → 1389, layout shift 0.64 to 1.00). e2e keeps it within 2px. |
| 11 | The closed book is weakly composed | fixed | The cover is centred at the book's size, with «افتح الكتاب» under it and «ابدأ من» with the three parts, each opening at its part. | `1440-a-closed.png`; e2e "a part … opens the book at that part" |
| 12 | The closed book is lopsided | fixed | Closed on either cover, the book slides half a page to stand in the middle, and the slide runs with the turn. The stage clips sideways (`overflow-x: clip`), so nothing scrolls. | e2e: the back cover centred within 2px, no horizontal scroll |
| 13 | The controls are detached from the book | fixed | The controls are as wide as the book. The focus ring hugs the book (or the cover, when closed), not the stage. On a narrow book the arrows carry the turn and the words stay for screen readers. | `1440-c-open.png`, `360-c-open.png` |
| 14 | Selecting text doesn't work in the book | accepted | page-flip owns the pointer on the leaves. Selecting and finding happen in «عرض للقراءة». | docs/book-preview.md |
| 15 | Touch gives no hint that pages turn by hand | fixed | The corner of the next page to turn is lifted a little, on touch screens too. | `1440-c-open.png` (bottom-left corner) |

Found and fixed while doing this:
- **Portrait steps.** Blank backs and endpapers were empty steps in one-page mode; they are skipped now.
- **Phone width.** On a 360 phone, page-flip's `loadFromHTML` pins the book's minimum width to 400px, which forced a 420px layout. The reset now comes after loading.
- **Back cover linen.** page-flip rewrites each leaf's inline style, which wiped the back cover's linen. It is set on the book's root now.
- **Physical CSS in RTL (SC-05).** The first rework had it in three places. The case and the ring are now centred with symmetric logical insets, the page edges use inline-end for the unread side, and the corner fold sits at the inline end.

## Measured after

- **tasmeem** (`measured.md`):
  - `scan` of the reader finds MO-09 (the 700ms slide of the book) and CO-13 (the page edges' stripes). DESIGN.md "The book reader" and §6 now document both as the book's own moment and material.
  - `built` (`built.json`, rebuilt after the SC-05 fix): only TY-04 and TY-05 on the book title, both brand exceptions.
  - Merged verdict: PASS (P0 0).
  - `render` finds only LA-22, the known false positive.
- **Probe** (`reader-probe.json`, `look.json`): the geometry and text sizes above, and no console errors at 360, 693, 1024 or 1440 with motion on or off.
- **Checks:**
  - `pnpm check`: unit 397;
  - build, export and budgets: /book 141.6 KiB of 150;
  - e2e: reader 14/14 on the dev server and on the static export; public and visual 76/76;
  - motion check: /book, 0 held reveals.
