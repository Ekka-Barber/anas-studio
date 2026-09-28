# Design: direction B «أنساق» (woven)

The public site of anas.studio, as Anas chose it on 2026-09-28 (D39): his own palette, woven into full-width bands, with the triangle and palm-weave marks of his work between them. This file is the design system's reference: what each token and component is for, and how to change things without breaking the whole. The code is the source of truth; this explains it.

- Tokens: `src/styles/tokens.css`
- Surfaces (tones), base, text roles: `src/styles/globals.css`
- Motion: `src/styles/motion.css` and `src/components/weave/motion.ts`
- Components: `src/components/weave/` (the system), `src/components/site/` (header and footer), `src/components/public/` (pages), `src/components/book/` (the book's reader)
- Words that are not in the CMS: `src/content/`

## 1. Colour

### Palette

Anas's palette board (sand, coral, aubergine), with the shades direction B added. Components never use these directly for text or surfaces; they use a tone.

| Token | Hex | Role |
|---|---|---|
| `--sand` | #E0C6AD | The page |
| `--sand-50` | #EADAC8 | Paper: cards, fields, light bands |
| `--sand-300` | #D5B89C | A quiet notice panel |
| `--sand-muted` | #CDB39C | Secondary text on aubergine |
| `--aub` | #54353B | Ink on light surfaces; the dark band |
| `--aub-muted` | #684A50 | Secondary text on light surfaces |
| `--aub-800` | #412A2F | The "night" band |
| `--aub-900` | #2A191D | Ink on coral; behind photos and films |
| `--coral` | #E1654D | The accent band; large accent text on aubergine |
| `--coral-deep` | #8E3324 | Field errors on light surfaces |
| `--saffron` | #EFA032 | The book's band |
| `--saffron-ink` | #5A3210 | Ink on saffron |
| `--cover-board` | #E59110 | Cover B's linen: the boards of the open book in the reader, and its back cover |
| `--paper-page` | #F7F0E5 | The warm paper the book's pages are printed on in the reader (the manuscript's black text on it is 18.6:1) |

### Tones

Every band is one of seven surfaces, set with `data-tone`. A tone sets `--bg`, `--fg`, `--muted`, `--accent`, `--focus`, `--action-bg`/`--action-fg`, `--line`, `--field-bg`/`--field-fg` and `--error`, so anything placed on a band is already legible, its focus ring visible and its primary button right.

| Tone | Surface | Text | Focus | Action | Measured contrast |
|---|---|---|---|---|---|
| `sand` | sand | aubergine | aubergine | aubergine / paper | text 6.6:1, muted 4.8:1 |
| `paper` | sand-50 | aubergine | aubergine | aubergine / paper | text 7.9:1, muted 5.7:1 |
| `aub` | aubergine | sand-50 | saffron | coral / aub-900 | text 7.9:1, muted 5.4:1, coral 3.2:1 (large only) |
| `night` | aub-800 | sand-50 | saffron | coral / aub-900 | text 9.6:1 |
| `deep` | aub-900 | sand-50 | saffron | coral / aub-900 | text 12:1 |
| `coral` | coral | aub-900 | aub-900 | aub-900 / sand-50 | text 4.9:1 |
| `saffron` | saffron | saffron-ink | saffron-ink | saffron-ink / saffron | text 5.1:1 |

Rules:
- Coral text only on aubergine and only at display size (it is 3.2:1): `.t-accent` on an aubergine band.
- Errors are words, never colour alone; on light surfaces they are coral-deep (4.9:1).
- Field borders are 3px aubergine on the public site; the admin uses aubergine-muted (4.8:1, WCAG 1.4.11).
- The focus ring is 3px, 3px outside the control, in its band's `--focus`. A control that carries its own tone (a door, «القائمة», a menu band, a dialog's «إغلاق», a caption) draws its ring 6px inside itself, on the surface whose tone chose the colour. Over a photograph the ring is two-tone: its colour framed in aub-900.
- A state cue drawn as a shape (the header's "you are here" triangle) takes the text colour, never coral on sand (2.1:1).
- Hover styles live inside `@media (hover: hover)`, so a tap never leaves an underline behind. A pressed button moves down 1px (`translate`, set once in `globals.css` for every button on the site).

## 2. Type

Thmanyah only (D33): Serif Display (400, 500) for everything set large, Sans (400, 500, 700) for reading and every control. Medium serif and bold sans are preloaded.

Text roles are classes in `globals.css`. A component picks a role and never restates sizes. The large sizes are the design; B sets titles and bands at poster size on purpose.

| Class | Size | Use |
|---|---|---|
| `.t-hero` | 84–212px | Anas's name bands on the home page |
| `.t-mega` | 104–240px | The book title «خوص» |
| `.t-year` | 96–280px | A year band in بدأتُ من هنا |
| `.t-title` | 68–200px | A page title |
| `.t-band-xl`, `.t-band` | 48–136px, 40–108px | A statement on its own band |
| `.t-statement` | 36–92px | A statement on aubergine |
| `.t-h2-lg`, `.t-h2`, `.t-h3` | 52–112px, 44–80px, 28–40px | Section headings |
| `.t-display` | 30–50px | A large line inside a text (a "pull line") |
| `.t-lead` | 26–48px | The line under a page title |
| `.t-card` | 36–50px | A card or door title |
| `.t-quote`, `.t-line` | 24–36px, 20–24px | Quotations; a short serif line on a card |
| `.t-read` | 18–21px, line-height 2.05 | Reading text |
| `.t-body` | 17px | Short text in cards |
| `.t-label` | 15px bold | Labels, captions, meta |

Control sizes are tokens without a class: `--size-action` (18px, a full-size button and a price), `--size-control` (17px, fields), `--size-small` (16px, compact controls such as filters, the header's buttons and a film's chip). 15px (`--size-label`) is the floor for Arabic text anywhere.

A size that belongs to one place is still a token, named for its place: `--size-thura`, `--size-post-title`, `--size-opening` (a room's opening line and the line beside Anas's name), `--size-flavour`, `--size-menu`, `--size-brand`. No component module sets a size in pixels.

Anas's texts are rendered through `<Lines>`, which keeps his line breaks and runs `typeset()`: a comma glued to the next word gets its space, and closing punctuation never starts a line alone. The stored text is never changed.

Arabic leading. A display line that can wrap keeps a line-height of 1.25 or more, so the marks of two lines never meet (`--leading-tight` is 1.25). Only single-word lines sit tighter: `.t-mega` and `.t-year` at 1, and the home name bands (`.t-hero`, one word to a band) at 1.15. A serif line that drops below 28px on a phone (`.t-lead`, the footer poem) gets 1.6 there.

The home page's name bands. A tall mark may cross the seam into the band above, in its own band's ink: the alef over «عبدالله» rises into the aubergine band. Owner decision, 2026-09-28. No mark may be hidden, and no mark may merge with a mark of another line.

Quotations from the book. On كتبتُ هنا, a quoted line is set in `.t-display` between thin rules like the one on the cover. Its guillemets are drawn in the book's ink (saffron-ink), with the opening one hanging in the margin. The source sits at the far left after a short rule. The closing full stop is left out on screen; the stored text keeps it (owner, 2026-09-28).

The two-tone headline. The 404 and the error page set their headline in two parts, the second in coral on aubergine (`.t-accent`): «هذا الطريق لم يُبنَ بعد». It belongs to these two pages only; every other headline is one colour.

## 3. Layout and spacing

- Full-width bands with the page gutter (`--gutter`, 20–72px) as inline padding.
- Block padding steps: `--pad-xs` to `--pad-xl` (24–152px), chosen with `<Band pad padEnd>`.
- A reading column is at most 700px (`--measure`); a journal article 33em.
- Text beside a picture: `layout.split` with `layout.text` (flex 520px, max 700) and `layout.aside` (flex 300px, max 480); they stack when the room runs out. No breakpoints to maintain.
- A grid of equal tiles on 1px lines: `layout.lattice` (set `--tile` for the minimum width). A gap-free photo grid: `layout.mosaic`.
- One breakpoint exists: the header shows the rooms inline from 1024px.

## 4. Edges: the signature

B's identity is what sits between the bands.

- `<Edge kind="crenel" color>`: a row of triangles in the colour of the band that follows, standing on it like the Najdi triangles on Anas's ذرى card. Sizes `sm` (12px, on the home doors), `md` (22px), `lg` (26px square tiles, with `on` for a two-colour edge).
- `<Edge kind="weave">`: the 28px palm-weave strip in all four colours (`public/brand/weave.svg`).
- `<Band edge="crenel">` draws the triangles above itself in its own colour; `edge="weave"` draws the strip.

Use a crenel to open a band of a new colour; use the weave after a page title and before the footer. Never both on the same seam.

The serious pages, the cart, the checkout and the policies, carry no edge at their head: a plain paper band closed by a 3px rule (`.docHead`). They also use a modest title (`--size-card`), and the order summary in a bordered panel beside the form from 1024px (first on a phone). Money is set in tabular digits. The footer keeps its weave (owner, 2026-09-28: "money related pages … look serious and official").

Both start from the right, the reading start, so a partial tile always falls on the left.

## 5. Components

| Component | File | What it is |
|---|---|---|
| `Band` | `weave/Band.tsx` | A full-width section with a tone, block padding and an optional edge. The unit every page is woven from. |
| `Edge` | `weave/Edge.tsx` | Crenel triangles or the weave strip. |
| `Signature` | `weave/Signature.tsx` | Anas's handwritten signature from his own vector (`public/brand/anas-signature.svg`), in the current text colour; it writes itself in when motion is allowed. |
| `ActionLink`, `ActionButton` | `weave/Action.tsx` | `solid` (the band's action colours), `outline` (3px frame) or `text`; 56px high, the RTL arrow «←» after the label. The store, cart and checkout use them too. |
| `Tag`, `Mark` | `weave/Action.tsx` | A short solid label («قريباً», a status); the three-triangle mark. |
| `Figure` | `weave/Figure.tsx` | A photograph with an optional crop and caption (under it, or sewn on its corner in grids). |
| `VideoTile` | `weave/VideoTile.tsx` | A film that plays only when asked; no byte loads before the tap; native controls once playing, and always without JavaScript. |
| `RoomNav` | `weave/RoomNav.tsx` | The two doors at the end of a page. |
| `SectionNav` | `weave/SectionNav.tsx` | A page's own contents under the header (the book), with the current section marked. On a narrow screen the strip scrolls sideways to keep the current link in view, and fades at an end that has more links past it. |
| `RoomHero` | `public/RoomHero.tsx` | A page's opening band: triangles, title, the room's line, then the weave. |
| `StoryText`, `StatementBand`, `StoryFigure` | `public/story/Story.tsx` | A room's text run, a line on its own band, the CMS picture beside a text. |
| `BookPreview`, `ClosedBook`, `PdfBookReader` | `book/` | The book's pages on /book (P02), described under "The book reader" below. See also `docs/book-preview.md`. |
| `SiteHeader`, `Footer` | `site/` | The sticky header (it tucks away while you scroll down) with the full-screen woven menu (a native modal `<dialog>`), and the footer with Anas's closing line. |

## 6. Motion

Everything is visible without motion, without JavaScript, when printed and in a background tab.

- Entrances (`enter(delay, fx)` from `motion.ts`): CSS animations that always finish; nothing waits for script.
- Scroll reveals (`data-reveal`, `data-fx`, `data-delay`, `data-seq`): `mountReveals` holds only what is still below the fold and plays each once as it arrives. Effects: `rise`, `fade`, `band` (a wipe in the reading direction), `media` (a wipe upward), `sign` (the signature written left to right), `grow`, and `data-seq` for children one after another.
- Scroll-linked zoom (`.motion-scrub`) and opening (`.motion-expand`): CSS scroll timelines where the browser has them, nothing where it does not.
- Two easings: `--ease-out` for movement, `--ease-weave` for wipes.
- Durations: `--dur-ui` (280ms) for what answers the visitor (the header's slide, the section bar, the lightbox opening, a photo step), `--dur-quick` for hover and press, `--dur-base` (560ms) for the menu's woven bands. Entrances and reveals are slower on purpose; `--enter-dur` shortens one, as the home portrait's 500ms wipe, which starts at once because it is the first screen's largest picture.
- A page plays its entrances once per visit: opened again after a client navigation, it comes back without them (`data-seen` on the root, set by `MotionLayer` before paint). Its scroll reveals below the fold still play (owner, 2026-09-28). React's development double run of an effect is not a return. A filtered grid animates only the tiles that arrive, never the ones already shown.
- The serious pages (`/cart`, `/checkout`, `/policies/*`, `CALM` in `MotionLayer`) have no scroll reveals: only the title's 280ms fade (`calmEnter`). On the store list and a product, the pictures and titles move; prices and the buy controls never do.
- The book's section bar follows the header's slide by animating its sticky `top`, the one layout property animated on purpose. A transform cannot do this, because it would also move the bar when it is not stuck: a browser test on 2026-09-28 caught the bar drawn up to 66px out of place on a quick scroll up.
- The book reader's page turn (900ms) and the book's slide to the middle when it closes (700ms) are longer than the interface's 280ms, on purpose: opening and turning a book is the section's moment, and it happens only when the visitor asks.
- `prefers-reduced-motion: reduce` turns all of it off, including the header's slide and the lightbox wipes. A turn of the book becomes a 150ms fade instead of a rotation.

Two checks guard it:
- `tests/e2e/motion.spec.ts`, on the dev server and on the export: every held reveal plays on every story page; the serious pages stay still apart from the title; a return visit skips the entrances but plays the reveals; reduced motion holds nothing.
- `stuck.mjs` in the DESIGN-B evidence: no reveal is left held after scrolling. On its own it cannot catch reveals that never mount; the audit of 2026-09-28 found exactly that on the dev server.

### The book reader

«صفحات من الكتاب» on /book shows the pages Anas approved (P02) as the book itself: a 4:5 hardcover (8×10 in), the shape of cover B (owner, 2026-09-28: "find the best suit our own design").

- **One stage.** The closed book, the loading state and the open book stand on the same stage. Two pages side by side up to 78% of the screen's height, one page at a time below 800px; opening never moves the page.
- **Closed.** Cover B, centred, with its shadow. Under it are «افتح الكتاب» and «ابدأ من» with the three parts; without JavaScript they link to the PDF at that page.
- **Open.** An Arabic book, bound on the right, turning the left page to the right. Its parts:
  - boards of cover linen (`--cover-board`) around the page block, and a cast shadow;
  - coffee endpapers (`--saffron-ink`) inside both covers;
  - each part starting on a left-hand page;
  - the spine's shadow on the pages;
  - the pages' edges drawn as fine lines of paper, thicker on the side still to read (the inline end);
  - the back cover in cover B's own linen.
- **The pages.** Each A4 page is drawn on a 4:5 sheet of warm paper (`--paper-page`), framed around the text. The words are Anas's, untouched.
- **Turning.**
  - The corner of the next page is lifted a little, the way to turn by hand. Past the first page, the other bottom corner of the page that turns back is lifted too, smaller.
  - Two pages at a time, a click on a page turns it, and a drag turns it by hand. A corner click that closes the book slides it to the middle with the turn.
  - One page at a time, a click on the left half is the next page and on the right half the previous one. A drag or a swipe never stops on a blank back or an endpaper: the turn carries on to the next page with words.
  - The controls and the focus ring follow the book's width.
- **«عرض للقراءة».** The same pages one under the other, at reading size (up to 880px wide, about 16px text), from the page in view: the place to read closely, zoom and select.

## 7. Where the words live

Anas edits his words in the admin. The composition (which picture goes where, the colours of the bands) is code.

- Rooms (`/admin`, the four room documents):
  - `jewel` (shown as «لون الغرفة») is the colour of the room's opening band;
  - `tagline` («سطر الغرفة») is its line, under the title and on the home page's door;
  - `pullLines` («أسطر كبيرة») names the paragraphs set large, and `bandLines` («أسطر على شريط ملوّن») the paragraphs that break out as a full-width band. Each must repeat a paragraph exactly; a unit test checks the content does;
  - in بدأتُ من هنا, a movement's `films` («تظهر المقاطع هنا») places the family films after its first large line, and each movement's `vignette` is the picture beside its text;
  - a hidden film or picture disappears from the page. The five films that show children stay hidden until their guardians agree.
- Site settings: the navigation, the footer's closing line, and the home page (his name, portrait, tagline, intro, the addition and the big statement).
- Journal posts and their categories: the posts collection.
- Not in the CMS yet, in `src/content/`:
  - `book.ts`: the book page, from his manuscript;
  - `contact.ts`: the services;
  - `scenes.ts`: the gallery and its categories;
  - `home.ts`: the doors' order and short facts;
  - `site.ts`: his social handles;
  - `media-notes.ts`: alt text and captions for pictures stored as a bare id.

## 8. Truthful states

- A section waiting for Anas's material is left out, never shown as a placeholder: the book's characters, the sketches, the 2013 photo.
- A form whose backend does not exist yet is not shown:
  - the availability sign-ups arrive with P08;
  - session booking arrives with P09 (a service's «اطلب جلسة» fills the contact form instead).
- The book's reader holds only the pages Anas approved for free reading (P02, E04 range); the whole book is never on the site, and the reader's last leaf says the rest is in the book.
- The contact form is real: the `contact` Edge Function with Turnstile, a honeypot, and one submission key per message.
- Prices are «يُعلن قريباً» until Anas sets them (D06).

## 9. Recipes

- **A new band on a page:** `<Band tone="coral" edge="crenel" pad="l">…</Band>`. Pick the tone; its text, focus and buttons follow.
- **A line set large, or on a coloured band:** add the paragraph's exact text to the room's «أسطر كبيرة» or «أسطر على شريط ملوّن» in the admin.
- **A new colour of the same family:** add it to the palette in `tokens.css`, then a tone in `globals.css` if it will carry text. Check contrast (section 1) before using it for text.
- **A page's title band:** `<RoomHero tone title tagline />`.
- **A picture beside text:** give the CMS field an image; give a bare-id image its alt and caption in `media-notes.ts`.
- **Change a type size everywhere:** edit its `--size-*` token.
- **Turn a motion off:** remove its `data-reveal`/`enter()`; the element is already in its final state.

## 10. Checks

- `pnpm check` (lint, types, frozen sources, copy rules, unit tests);
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the largest public page is under 150 KiB of script);
- `tests/e2e/public.spec.ts` (every page, the menu, the gallery and lightbox, films, the book's contents, the contact form, JavaScript off) and `tests/e2e/visual.spec.ts` (every page at 360, 768, 1024 and 1440 without horizontal overflow; screenshots in `artifacts/acceptance/DESIGN-B/screenshots/`).
