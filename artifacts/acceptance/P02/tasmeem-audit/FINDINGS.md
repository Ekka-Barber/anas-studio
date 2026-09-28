# Audit · P02 book reader (/book, «صفحات من الكتاب») · 2026-09-28

Findings only, as the owner asked: nothing has been changed.

The owner's complaints:
- "it looks weak";
- "I should see flipping action";
- "the cover looks shorter than the actual pages".

## Measured

The tasmeem tool:
- `scan` (the reader's source): only TY-04 on the book title, a brand exception.
- `built` (`out/book.html`): TY-04 and TY-05, both brand exceptions.
- `render` at 360, 768, 1024 and 1440, and with motion at 390 and 1440: only LA-22, the false positive ruled on earlier.
- Merged in `measured.md`: PASS.

**Those tools see only the closed page.** Every reader finding below comes from the reader probe or from judgment:
- `reader-probe.json`: the opened reader at 1440, 1024, 693 (the owner's pane) and 360, each with motion on and off. It records leaf geometry, cover art, text size, rest shadows and frame timing during a turn.
- `open-jump.json`: height and layout shift while the book opens.
- `video/turn-1440.webm` and `turn-693.webm`: opening, a keyboard turn, the corner hover and a drag, with motion on. The sheets `overview-1440.png`, `open-seq-1440.png` and `turn-mid-1440.png` are cut from them.
- The owner's pane, read live: 693×794, `prefers-reduced-motion: reduce`, coarse pointer, reader open at the cover.

**Totals:** P0 2 · P1 8 · P2 5 · brand exceptions 2. "eye" marks judgment; everything else is measured.

## Why the owner saw no flipping

The page turn works with motion on (see the video). The owner's pane asks for reduced motion, and the reader honours it: the flip time drops to 1ms, so pages change with no transition at all. Below 560px the reader does not open the book at all (it opens «صفحات متتالية»). So in the contexts the owner used, the turn simply never appears.

## Findings

| # | ID | Sev | Where | Finding | Fix | Evidence | Brand exception? |
|---|---|---|---|---|---|---|---|
| 1 | MO (brief) | P0 | `PdfBookReader.tsx:90`, `:158` | **The page turn is missing where the owner looks.** Under reduced motion the turn is instant with nothing in between (`flippingTime: 1`). Below 560px the reader opens as a list with no book. The turn exists only on screens of 560px and wider with motion on. | Reduced motion: keep out the 3D rotation, but show a turn as a turn: a 200–250ms crossfade, or a shade that sweeps across the page. Phones: open the book first (one page at a time), with the list as the second choice. Tell the owner the pane (or Windows' "Animation effects") has reduced motion on. | owner pane; probe `*-reduce`; `open-360-*` (`opensAs: pages`) | no |
| 2 | TY-13 (raised to P0) | P0 | book mode, every width | **The pages can't be read in the book.** Word's 12pt text on an A4 page renders as follows (probe, median of the text layer): 8.6–10.8px at 1440, 7.4–9.3 at 1024, 5.4–6.8 at 693, 5.6 at 360. Arabic body text needs 16px or more. On touch screens page-flip also blocks pinch zoom (`touch-action: pan-y`). Reading is the section's only job. | One page at a time up to about 1100px wide, so the page is larger. A zoom control in book mode (a page view at reading size). Full screen as a promoted action. The real remedy is #3's typeset pages. | `reader-probe.json` `textPx` | no |
| 3 | IG (asset gap) | P1 · eye | `public/book/khous-preview.pdf` | **The pages are manuscript drafts, not book pages.** Arial on A4 with Word margins; top-heavy (page 5 is about a quarter full). The two pages even use different text sizes (8.6 against 10.8px in one spread). A perfect reader would still show two documents. Nothing may be retyped (the words are Anas's). | Ask Anas for the typeset interior of the actual book (the designer's PDF at trim size), even for these same 5 pages. That also gives the true page ratio for #4. | `open-1440-*.png`; source render | no |
| 4 | — (owner) | P1 | `BookPreview.tsx` `closedCover`; `PdfBookReader.tsx` `coverLeaf` | **The cover is shorter than the pages.** Closed, cover B is 4:5 (ratio 1.25) while the pages are A4 (1.414): 11.6% shorter at the same width. Inside the book the cover leaf is A4, but its art is fitted (`object-fit: contain`): 88% of the leaf's height, with 41px bars of `--cover-board` above and below at 1440 (34 at 1024, 26 at 693). | One trim ratio for cover and pages: the printed book's (see #3). Until then, either a cover asset composed at the pages' ratio (the linen extended, never a stretch), or pages shown at the cover's ratio by trimming their empty margins (presentation, not content). The closed book should show that same ratio. | probe `closed.cover`, `atCover.art`; `cover-1440-*.png`, owner-pane screenshot | no |
| 5 | SY-03 | P1 · eye | `reader.module.css` `.leaf` | **The open book has no body.** At rest it is two flat rectangles on the dark band: no gutter shading at the spine, no page-edge thickness, no boards around the page block, no cast shadow. The probe finds `box-shadow: none`, and page-flip's shadow layers exist only while a page moves. It reads as two documents side by side. | Build the object: a gutter gradient at the spine on both pages, a few stacked page edges on the outer sides (thickness that shrinks as you read), the cover boards 6–10px around the block, and one soft cast shadow tinted aubergine. | `open-1440-reduce.png`; probe `restShadows`, `shadow` | no |
| 6 | CO / SY-01 | P1 · eye | `tokens.css` `--pdf-paper: #fff` | **Pure white paper is foreign to the site.** It is the only #FFF on a sand, aubergine, coral and saffron site; I added the token myself, and the owner never chose it. It glares on the dark band and makes the turn white on white (#7). | Render the pages on a warm paper tone: pdf.js's `background` render option changes the paper, never the words. Keep the text contrast at 7:1 or more. | eye; `DESIGN.md` §1 (line added in P02) | no (my addition, not an owner decision) |
| 7 | MO | P1 · eye | `PdfBookReader.tsx:157–158` | **Even with motion, the turn reads weakly.** The curl is white over white, the shadow is capped at 35% (`maxShadowOpacity: 0.35`), and the lifted page has no tone of its own. The hard cover swings as a flat card. | Shading at 60–80%, tinted aubergine. Paper tone (#6). A slightly darker back face on the turning page. A gutter shadow that deepens as the page lifts. Keep about 800ms: this is a rare, meaningful moment. | `turn-mid-1440.png`, `open-seq-1440.png` | no |
| 8 | — (book order) | P1 | `book-preview.ts` `leafPlan` | **The physical order is wrong.** With `showCover`, the first page after the cover is printed on the inside of the hard front cover. So «الإهداء» swings as a rigid board when the book opens, and it sits on the right facing «المقدمة». There are no endpapers, and the closing leaf is the inside of the back cover. In an Arabic book, the inside of the cover is an endpaper on the right and the first page (a recto) is on the left. | Add endpapers (the inside cover in the board colour or the palm-weave pattern). The dedication goes on the first left page, with a blank back, and the introduction starts on a left page. The closing leaf goes before a back endpaper. Keep the leaf count even. | `open-seq-1440.png` (frames 5–6); leaf plan | no |
| 9 | MO / QA | P1 | page-flip turn | **The turn stutters.** Frames over 32ms during one turn (headless Chromium, software rendering): 18 of 33 at 1440 (worst 83ms), 17 of 39 at 1024, 9 of 58 at 693. Likely causes: hundreds of absolutely placed text-layer spans inside each transformed leaf, and full-size canvases (up to 2× device pixels). Needs confirming on a real GPU. | While a page turns, hide the text layers (`visibility: hidden`) and contain each leaf (`contain: strict`). Cap the canvases at 1.5× when two pages show. Measure again on device. | `reader-probe.json` `turnPerf` | no |
| 10 | QA-13 (layout shift) | P1 | `BookPreview.tsx` → `PdfBookReader.tsx` | **Opening the book jumps the page.** The section goes from 1005px (closed) to 581px (loading) to 1389px (open) at 1440; from 773 to 346 to 896 at 693. Layout shift 0.64 at 1440 and 1.00 at 693 (0.25 already counts as poor). Everything below moves twice; the video shows «صور» sliding into view. | Keep the space: the loading state keeps the closed book's height and the open book's aspect, and the book fades or opens inside it. | `open-jump.json`; `overview-1440.png` frame 7 | no |
| 11 | LA-13 | P2 · eye | `.closed` | **The closed book is weakly composed.** At 1440 the cover stands at one side and «افتح الكتاب» is stranded at the other, 394px lower, with a large void between. Nothing says there are 5 pages to read, or which ones. | One composition: the book as the object (at the pages' ratio, #4), the button close to it, and the three parts named next to it («الإهداء · المقدمة · صورة الروضة»), each opening at its page. | `closed-1440-*.png` | no |
| 12 | LA | P2 · eye | page-flip at the cover | **The closed book is lopsided.** At the cover, the book sits alone in the left half and the right half is empty (page-flip's position for a cover). The owner's pane at 693 shows exactly this. | Centre the closed book (shift it by half a page while the cover or back shows), or open straight to the first spread. | owner-pane screenshot; `cover-1440-*.png` | no |
| 13 | CM | P2 | `.toolbar`, `.book:focus-visible` | **The controls are detached from the book.** At 1440 the book is 992px wide in a 1296px box, so «السابقة» and «التالية» sit about 150px beyond its edges, as generic outlined boxes. The focus ring draws around the whole 1296px box, not the book. | Size the toolbar and the ring to the book. Page arrows at its edges, a quieter centre label, and the tools under it. | `open-1440-*.png`, `end-1440.png` | no |
| 14 | CM-07 | P2 | page-flip mouse handling | **Selecting text doesn't work in the book.** page-flip cancels `mousedown` on the leaves, so the drawn selectable layer can't be used with a mouse (it can in «صفحات متتالية»). | Accept it and point to «صفحات متتالية» for selecting, or allow selection while a modifier is held. | code (`UI.ts` `onMouseDown`) | no |
| 15 | CM-14 | P2 · eye | touch | **Touch gives no hint that pages turn by hand.** The corner fold appears only on mouse hover; on touch screens the only affordances are the two buttons. | Show the corner fold once when the book opens (motion allowed), or draw a permanent small fold on the next page's corner. | video; code | no |
| — | TY-04 | P1 | `BookView.tsx:50` | The book title band (brand) | none | scan, built | yes: `DESIGN.md` §2 |
| — | TY-05 | P1 | `out/book.html` | «كتبتُ هنا» above the title: the room's label, Anas's word | none | built | yes: owner's text |

## The three highest-impact fixes

1. **Real pages at one ratio (#3, #4).** Anas's typeset pages at the book's trim size, with the cover made at that same ratio. This settles "the cover is shorter" and removes most of "weak" at the source.
2. **Give the book a body and a visible turn (#5, #6, #7, #8).** Warm paper, gutter shading, page edges, boards, a cast shadow, stronger tinted turn shading, and endpapers with the pages on the right sides.
3. **Make the turn exist everywhere it is looked at, and make the text readable (#1, #2, #10).**
   - A perceptible reduced-motion turn.
   - Phones open the book.
   - One page at a time below about 1100px.
   - A zoom control.
   - No layout jump.

## What works (keep)

- Right-to-left binding is correct: page 1 is the right-hand page, the left page turns to the right, ← is next, and the labels read right.
- Only the approved 5-page file is ever fetched, and nothing loads until the book is opened.
- The public PDF is stripped of Anas's email, actions and attachments, and is pixel-identical to his pages.
- Arabic draws joined (glyph outlines); the lam-alef order is fixed in the selectable text; screen readers get each page's text in reading order.
- Keyboard, live position, page jump, full screen, retry on failure, and the PDF link without JavaScript.
- Contrast passes throughout (the smallest pair is 8.4:1).
- The /book script budget is 141.2 KiB of 150.

## Decisions for the owner before fixing

- Is there a typeset interior (the designer's PDF), and what is the book's trim size? That decides the one ratio for cover and pages.
- On phones: the book first (turning, with a zoom control), or the pages list first?
- Under reduced motion: a gentle crossfade or shade sweep instead of the 3D turn? The 3D turn stays off, for accessibility.
