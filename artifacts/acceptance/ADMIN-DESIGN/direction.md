# Admin redesign (D49): the direction (tasmeem core/direction.md, redesign mode; impeccable's Operate mode)

> Written on 2026-10-08, before the drafts, the port and the audits. The direction stands; some measures moved while it was made and audited: the rail stands at the side from 1280px, 16.5rem wide (below, from 1024px at 272px); under 1280px the bar scrolls with the page, not sticky; the rail reads «أنس» over «anas.studio»; the weave is the site's 28px strip. DESIGN.md section 10 and README.md give the final state.

## 1. What exists (identity lock)
- Brand system: direction B «أنساق» (D39, DESIGN.md): Anas's palette (sand, aubergine, coral, saffron and shades) as seven tones (`data-tone`), Thmanyah only (Serif Display for display, Sans for reading and every control), full-width woven bands, the crenel (Najdi triangles) and the palm-weave strip as the signature between bands, square corners, 3px frames, the RTL arrow «←». Inherited, not replaced (D04: CSS Modules and tokens, native controls, no Tailwind or kit).
- The admin today (P03): "plain and functional, main theme tokens only, no marketing signature": one 10 KB `admin.module.css` for 29 screens, a wrapping top nav of bare links, browser-default headings (h1 32px bold Sans), 4px radii, pill badges, a 700px column, tables with 1px rules. It reads as an unstyled document: that is the owner's "awful".
- PRODUCT.md: the admin serves Anas and his staff "editing their own words, posts, catalogue and orders; it follows the product register inside the same palette".

## 2. The design read
Reading this as: **the back room of anas.studio, where Anas and two staff keep his words, pictures, catalogue and orders**, for **a founder who runs restaurants in Tabuk and checks his site between shifts, mostly on a phone, and at a laptop at night**, in **Arabic (MSA interface verbs, the site's own register)**, with a **calm, crafted, proud** voice, leaning toward **the same woven world as the site, set as a workshop: paper, ink and palm weave, quiet surfaces, the brand in exact places**.

## 3. The scene
Anas opens the admin on his phone in a bright kitchen office between lunch and dinner to see if anything needs him (an order to ship, a mail that bounced, a refund), and at night on a laptop he edits a room's text or his book page for half an hour. → Light (sand and paper grounds, aubergine ink), high contrast, 44 to 48px targets, the day's attention first, dense enough lists that a whole order fits a laptop screen, long forms that stay calm.

## 4. The subject's world (nouns)
Palm-leaf weave (khous) and its strips; the Najdi triangles of his ذرى card; the book's saffron linen board and its khous bookmark; his handwritten signature; the order slip and the kitchen ticket rail; the ledger with its ruled columns; the shop's paper bag and stamp; the market stall's price card; Tabuk's sand and the aubergine of his palette board.

## 5. Dials
Variance 3 (a product surface: a steady grid, conventions kept), Motion 2 (state changes only: 180ms; no entrances), Density 6 (lists and tables dense, forms airy).

## 6. Colour strategy
Restrained product surface inside a committed frame:
- The frame (the rail and the mobile bar): tone `night` (aub-800), about 15% of a laptop screen: the brand's committed band.
- The ground: `sand` (the site's page colour); panels and tables on `paper` (sand-50); fields on `paper` with 2px aub-muted borders (5.7:1 on paper, WCAG 1.4.11).
- One accent: coral for the single primary call to attention (a problem marker, the current item's triangle on dark), never for text on sand (2.1:1); errors in coral-deep words (4.9:1).
- Saffron for "waiting" and warnings on dark only (focus on dark is saffron already).
- Every pair is one of DESIGN.md's measured tone pairs; any new pair is measured with `tasmeem contrast` before use.

## 7. Type, layout, signature
- Type: page titles (each screen's h1) in Thmanyah Serif Display 500, clamp(34px, 3.4vw, 48px), line-height 1.25; section titles (h2) in Serif Display, clamp(24px, 2vw, 30px); everything else Thmanyah Sans: 17px body, 15px bold labels (the floor), tabular figures for money, counts, dates and order numbers. No letter-spacing, no italics (the reset stands).
- Layout, laptop (≥ 1024px): a fixed rail on the start side (right), 272px, tone night: the three-triangle mark and «لوحة أنس» in Serif Display; under it the nav, grouped by spacing (the work of the day, the words and pictures, the store and its orders, the house: stats, settings, team, security); the sign-out at the rail's foot. The content column beside it on sand, a page header (the h1) closed by a crenel edge in the colour of the panels, then the screen's panels on paper. Wide screens (orders, a table) use the full content width; forms keep a reading measure.
- Layout, phone (< 1024px): a night bar at the top (mark, «لوحة أنس») and under it the same nav as a strip that scrolls sideways (the book page's SectionNav pattern: the current link kept in view, a fade at an end with more), sticky; no menu dialog (one <nav>, always visible: the e2e specs click its links).
- Signature: the rail's inner edge is a vertical palm-weave strip (the site's `weave.svg`, repeat-y, 12 to 14px), and the current page's link is cut out of the rail as a paper tab with a crenel triangle, woven into the page it opens. Everything else stays quiet.

## 8. Reflex check
- First order: "admin dashboard" → left sidebar + KPI tiles + charts in Inter/indigo. Ours: a right rail in aubergine with palm weave, Serif Display titles, no KPI strip (counts are sentences with their numbers, as today: D21 "unavailable is unavailable"), no charts beyond what exists.
- Second order: "dashboard, but warm" → cream + terracotta + serif. Here the cream and coral ARE the brand (D39; DESIGN.md's brand exception), so the risk is the warm-SaaS look: avoided by the square corners, the 3px frames, the weave and crenel, and no shadows or rounded cards (CM-02).
- Silhouette: the rail + header + panels silhouette is the operating convention (impeccable: Operate mode keeps native expectations); the identity lives in materials and details, not structure. Accepted on purpose.
- Honesty: no number, name or status the data does not give; empty states say what will appear and the one action that fills it, only where the screen has one today.

## Hard constraints (from the e2e specs: scratchpad/admin-redesign-contract.md)
One <nav aria-label="لوحة التحكم"> with today's links only (no extra <a>), «الطلبات» right after «المتجر»; the sign-out <button> inside the nav; no new <section>, <ul> or <h2> in main; class names `listItem`, `field`, `secret`, `tableWrap` kept and no new class containing them; list groups' items stay direct div children; tables' markup and data-labels untouched; every text a spec matches stays in one element; 44px targets; no horizontal overflow at 360.
