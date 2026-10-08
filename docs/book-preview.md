# The book preview (P02)

On `/book`, the section «صفحات من الكتاب» lets a visitor read the pages of «خوص» that Anas approved for free reading, and then sends them to the editions to buy the whole book. The site never holds or serves the whole book.

## What is published

The published pages are three fragments Anas sent as Word-exported PDFs, in the book's order:
- «الإهداء»: 1 page;
- «المقدمة»: 2 pages;
- two pages of the chapter «صورة الروضة».

Approval: owner, 2026-09-28: "ANAS provide two or three PDF texts ... we only want to let users see these then had to buy the whole book to read". This settles E04's preview range. The final manuscript, and with it the digital sale, is still open under E04.

| File | What it is |
|---|---|
| `BOOK_ASSETS/ (8).pdf`, ` (11).pdf`, ` (9).pdf` | Anas's fragments, as received (their metadata carries his email) |
| `scripts/prepare-preview.py` | Builds the public copy and checks it |
| `public/book/khous-preview.pdf` | The only PDF the site serves: 5 pages, sanitized |
| `content/book-source-manifest.json` | Input and output hashes, page labels, the approval |
| `content/book-preview-text.json` | Each page's text in reading order (see "Text" below) |

`prepare-preview.py` copies each page's content and its embedded font subsets unchanged, so the words are never retyped. It drops the rest:
- the document information and XMP metadata;
- the structure tree;
- open actions, additional actions, names (scripts, attachments), outlines and annotations.

It then refuses to write unless:
- no action, script, attachment, link, metadata or email address is left;
- every page's text matches its source page.

The rendered pages are pixel-identical to the sources, checked with PyMuPDF on 2026-09-28. Running it twice writes the same bytes.

## Updating it

When Anas approves other pages, or sends the final book's pages:
1. Put the PDFs in `BOOK_ASSETS/` and list them, in order and with their labels, in `SOURCES` in `scripts/prepare-preview.py`.
2. Update `APPROVAL` in `scripts/prepare-preview.py` (and the date asserted in `tests/unit/reader-mapping.test.ts`) before running, and record the approval in `PLANS/`. The script refuses to write when the inputs differ from the manifest and `APPROVAL` is unchanged.
3. Run `python scripts/prepare-preview.py` (it writes `APPROVAL` into the manifest as `approval`), then `pnpm test` (the manifest test checks the labels and page count) and `tests/e2e/reader.spec.ts`.

Never put the whole book in `public/`. A preview is a separate, smaller file.

## How the reader works

The design is in `DESIGN.md` ("The book reader"). The owner's audit of the first version (`artifacts/acceptance/P02/tasmeem-audit/FINDINGS.md`) and what changed (`after/FIXES.md`) are next to the evidence.

| Piece | File |
|---|---|
| The closed book, «ابدأ من», and the links without JavaScript | `src/components/book/BookPreview.tsx`, `ClosedBook.tsx` |
| The book: leaves, boards, page-flip, the toolbar, keys, full screen | `src/components/book/PdfBookReader.tsx` |
| «عرض للقراءة»: the pages one under the other | `src/components/book/StaticPdfReader.tsx` |
| pdf.js loading, the 4:5 frame, drawing a page on paper, its text | `src/components/book/pdf.ts` |
| Leaf plan, reading ↔ page-flip order, labels, parts, the ligature fix | `src/lib/book-preview.ts` |

- **The shape.** The book is 4:5 (8×10 in), cover B's own shape (owner, 2026-09-28).
  - Anas's pages are A4 Word pages. Each is shown through one 4:5 frame around the text of all five pages, with a margin (`measureFrame`), so no word is cut or moved.
  - Where the frame runs past the A4 sheet, pdf.js fills the canvas with the paper colour, so the sheet continues seamlessly.
- **Nothing loads until the book is opened.**
  - «افتح الكتاب», or a part under «ابدأ من», imports the reader's chunk, pdf.js (`pdfjs-dist` 6.3.289) and page-flip 2.0.7. Both are pinned (D10). The worker comes from the same package.
  - page-flip 2.0.7 carries a pnpm patch (`patches/page-flip@2.0.7.patch`, registered under `patchedDependencies` in `package.json`) that stops its animation-frame loop when the book is destroyed. Re-check the patch whenever page-flip is upgraded.
  - Without JavaScript the button and the parts are links to the preview PDF, at their page (`#page=`).
- **One stage.** The closed book, the loading state and the open book share one box, sized from `--stage-h`. Opening never moves the page; the e2e test keeps the section's height within 2px.
- **A physical Arabic hardcover.**
  - The leaves, from `leafPlan`: the cover, then the inside of the cover (an endpaper, turned with its board). Each part starts on a left-hand page, and a blank fills the page before it when needed. Then come the closing leaf «بقية الحكاية في الكتاب» (with «النسخ ←» to `#editions` when the page draws its editions; an empty list leaves both out), the back endpaper and the back cover.
  - page-flip only turns left-to-right books, so it gets the leaves reversed and starts at the end. Its "previous" is the reader's next, and the left page turns to the right. ← is the next page and → the previous; Home and End go to the cover and the closing leaf. A key pressed while a page is still turning is kept, only the last one, and made when the turn ends (`pendingRef`), and holding Home or End does not repeat the jump (the book stops on the closing leaf, not on the blank endpaper spread); Alt, Ctrl and Meta chords belong to the browser and do nothing.
  - The boards (a `.case` behind the leaves), the page edges, the spine's shadow and the cover's slide to the middle when the book is closed are all CSS, sized from the stage. JavaScript only marks the state (`data-at`, `data-portrait`, `data-turning`, `data-fading`, the edges' thickness, the corner to turn).
  - page-flip rewrites each leaf's inline style, so anything a leaf needs from JavaScript (the linen of the back cover) is set on the book's root. Loading also pins the root's minimum width to `minWidth`, so the reader resets it after `loadFromHTML`.
- **Canvases.**
  - Only the leaves on screen and one spread either side hold a canvas: at most six, at 1.5× device pixels in the book and 2× in the reading view.
  - Pages are drawn at the book's page width even while page-flip hides them, so a turning page is never blank: in portrait, `renderWindow` counts the skipped empty leaves (blanks and endpapers), so the window reaches past them to the leaf the turn lands on. A stale render is cancelled.
  - The text layers are hidden while a page turns. With a GPU (Intel Iris Xe) a turn at 1440 runs at about 60fps.
- **Motion.**
  - With motion allowed, a page turns in 900ms and a hard board swings.
  - Under `prefers-reduced-motion` a turn is a 150ms fade out and in (`data-fading`), never a rotation. The corners do not fold on hover.
- **Turning by hand.**
  - Two pages at a time, page-flip's own click and drag turn the page.
  - One page at a time, its split is 40/60 and it peels only its outer (right) edge. So the reader takes a click itself: it catches the mouseup before page-flip and tells page-flip to forget the press (`userStop(…, true)`). The left half is then the next page and the right half the previous one, and the corners do not peel on hover.
  - A drag or a swipe that stops on a blank or an endpaper goes on to the next page with words (`skipRef`, on the `read` state).
  - A corner click sets `data-at` when the turn starts, so the book slides with it.
  - The hints: `data-corner` on the next leaf, `data-corner-back` (a smaller fold) on the leaf that turns back.
  - Found by the owner's audit of 2026-09-28 (`artifacts/acceptance/P02/audit-2/FINDINGS.md`).
- **Small screens.**
  - Below 800px the book shows one page at a time; blank backs and endpapers are skipped, so every step shows something.
  - On a phone a page is about 320px wide and page-flip blocks pinch zoom. «عرض للقراءة» shows the pages one under the other, where two fingers zoom (a hint says so on touch screens), and it opens at the page in view.
- **Failure.**
  - A corrupt or unreachable file says «تعذّر فتح الصفحات.», with a retry and the PDF link, on the same stage. The focus goes to «إعادة المحاولة», the first failure included, unless the visitor has moved it elsewhere meanwhile (it never scrolls the page back).
  - A stalled download counts as unreachable and ends in the same state (`pdf.ts`): nothing of the PDF within two minutes of the press (`START_TIMEOUT_MS`: pdf.js, its worker and the request, about 450 KiB, report no progress), or nothing more for 30 seconds once it has started (`OPEN_TIMEOUT_MS`). A download that keeps receiving is not cut off.
  - A failed chunk load says the same under the closed book.
- **Focus.**
  - «التالية» and «السابقة» are `aria-disabled`, not `disabled`, at the covers, so a focused button keeps the focus; `turn` ignores a move past either end.
  - An arrow key pressed on the closing leaf's «النسخ ←» moves the focus to the book first, because the turn hides that leaf and the link with it.

## Two pdf.js findings (2026-09-28)

- **Joined Arabic.** Word's export stores Anas's Arabic as already-joined glyphs in font subsets.
  - Loaded as browser font faces, Chrome drew them as separate, unjoined letters.
  - The reader sets `disableFontFace: true`, so pdf.js draws each glyph from its outline, exactly as the PDF does.
  - pdf.js 6 has no `eval` path, so D10's `isEvalSupported: false` has nothing left to switch off.
- **Text order.** The text pdf.js extracts reverses lam-alef ligatures («الإهداء» becomes «اإلهداء»).
  - On page 4, where a tanween splits a run, it also orders some fragments of a line differently.
  - `fixLigatures` puts a ligature back only when the swapped letters, with their neighbours, are in the page's pypdf text and the unswapped ones are not. That text layer is kept for selecting and finding.
  - Screen readers get the pypdf text of each page instead, and the pdf.js layer is `aria-hidden`.
  - The reference is used only when the PDF has the preview's page count, so a different file keeps pdf.js's own text.

## Tests

- **`tests/unit/reader-mapping.test.ts`:**
  - the manifest;
  - the leaf plan: endpapers, parts on left-hand pages, even counts for 1–9 pages, and labels;
  - the reading ↔ page-flip order;
  - spreads, the canvas window, progress and labels;
  - the ligature fix, including the real preview read through pdf.js in Node.
- **`tests/e2e/reader.spec.ts`**, against the dev server and against the static export:
  - the published file equals the manifest's hash and holds no email;
  - nothing loads before opening, and only `/book/khous-preview.pdf` is fetched;
  - the spreads in order;
  - page 3 sits to the right of page 4;
  - keys, the page jump, the next button stopping at the back cover, a mouse drag;
  - opening keeps the section's height, the closed book and the back cover stand in the middle, and nothing scrolls sideways;
  - a part under the closed book opens the book there;
  - the text for screen readers;
  - the reduced-motion fade, resize, full screen;
  - the reading view (at the page in view, 880px) ending at `#editions`;
  - the synthetic one-page and three-page fixtures (`python scripts/prepare-preview.py --fixtures`);
  - a corrupt file, a network failure and a retry;
  - a phone at 360, turning one page at a time;
  - the page without JavaScript.
