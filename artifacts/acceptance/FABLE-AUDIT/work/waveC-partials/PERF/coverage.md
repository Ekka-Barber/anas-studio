# PERF coverage (in progress, 06:35)
out/ rebuilt 2026-10-07 01:30; src/ = HEAD 3a30a91 (dirty only in supabase/ and tests/), so the export matches today's public source.
Read in full: scripts/check-budgets.mjs, scripts/check-export.mjs, scripts/prepare-media.mjs, next.config.ts, public/_headers, src/app/(public)/layout.tsx, src/styles/{globals,tokens,motion}.css, docs/costs.md, VERIFICATION.md perf part, ISSUES.md, Picture.tsx, images.ts, VideoTile.tsx, turnstile.ts, OrderPage main, BookPreview, orders/page.tsx, store/[slug] and journal/[slug] params, ShelfRoomView top, Figure.tsx, motion.ts head, quote.ts.
Measured: static inventory (static.json), chunk map, CSS chunk composition, lazy chunk sizes, refs.mjs (297 same-origin refs all present), desktop 1440 run (m-desk.json), mobile 360 4x CPU slow-4G run (m-mob.json), A/B experiments (exp-a.log, exp-b.log): shelf eager, lazy posters, reduced motion, no font preload, low-priority preload.
Recorded findings PERF-01..05; prior-fix checks (7); doc claims (8).
Pending: font preload finding (waiting text-page A/B), checkout/cart CLS with mocked quote, reader idle CPU, INP probe, plan gaps.
