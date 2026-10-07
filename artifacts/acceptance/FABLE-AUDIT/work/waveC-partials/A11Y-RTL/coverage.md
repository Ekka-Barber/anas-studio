# A11Y-RTL coverage (in progress, ~06:30)
Export out/ built 2026-10-07 01:30 (newer than every src file; newest src 2026-10-03 15:56), HEAD 3a30a91. Served at 127.0.0.1:4173.
Done:
- Earlier audit records read (AUDIT-1 a11y rows, AUDIT-2 a11y rows + section 9, tasmeem FINDINGS/EXCEPTIONS, ISSUES I24-I51, DESIGN-AUDIT, DESIGN.md, tokens.css).
- Source read in full: globals.css, motion.css, both layouts, global-not-found, site/* (header, footer, css), weave/* (all tsx + css + motion.ts), public: HomeView, RoomHero, Lost, Picture, rooms/Started/Built/Passed/Shelf views, story/Story, scenes/SceneGallery + css, journal/JournalList, PostView, journal pages, contact page + ContactForm + ServiceRequest, BookView; store: CartView, CheckoutForm, HoldView, OrderPage, PaymentReturn, AvailabilityForm, NotifyAction, VariantAction, AddToCart, CartLink, quote.ts; all public page.tsx files.
- Crawl (checks.js) of 26 pages x 320/360/768/1024/1440 (json/*.json); Chrome AX names (ax.mjs, json/ax-1440.json); obscured-focus walk (obscured.mjs); menu + lightbox keyboard (dialogs2.mjs); lightbox fit (lightbox.mjs, lb2.mjs); 320 header/pan (hdr320, pan320, probe320); mocked cart + checkout + hold + contact (mock.mjs, cart-flow, checkout-flow, focus-disabled, stepper).
- Findings 01-06 written to findings.jsonl.
Left: no-JS + reduced-motion crawl review, motion-on focus walk (held reveals), forced-colors, 200%/400% zoom + text spacing, book reader keyboard, RTL CSS grep (physical properties), bidi in admin, admin code (src/components/admin/*, admin.module.css).
