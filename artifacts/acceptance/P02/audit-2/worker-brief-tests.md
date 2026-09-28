# Brief: audit-2 end-to-end tests (opus-worker, one round)

You work under the orchestrator's P02 lock (`.anasaq-execution.lock`). You are the only writer while you run. The orchestrator audits your diff, runs the export battery, and commits. Do not commit or start other work.

## Context

Read `artifacts/acceptance/P02/audit-2/FINDINGS.md` first. The orchestrator has already fixed the product code:
- `src/components/weave/MotionLayer.tsx`:
  - React's development double run no longer counts as a return;
  - a return visit skips only the page-open entrances (`<html data-seen>`), and its scroll reveals still play;
  - the calm routes `/cart`, `/checkout` and `/policies/*` mount no reveals.
- `src/components/weave/motion.ts`: `calmEnter` gives a calm page's `<h1>` a short fade (`data-enter`, `data-fx="fade"`, `--enter-dur: var(--dur-ui)`, 280ms).
- The cart, checkout and policy pages:
  - have a plain head;
  - the checkout's order summary now comes first in the form, as a bordered panel;
  - the coupon field is inside that summary.
- The store list, a product and the scenes grid now have entrances and reveals.
- `src/components/book/PdfBookReader.tsx`:
  - one page at a time (below 800px), a click on the page turns by the half it is on: the left half is the next page, the right half the previous one;
  - a drag or swipe that stops on a blank back or an endpaper carries on to the next page with text;
  - a corner click that closes or opens the book sets `data-at` while the turn runs;
  - the leaf that turns back carries `data-corner-back`, and the next one `data-corner`.

## Write exactly these files

1. `tests/e2e/motion.spec.ts` (new).
2. `tests/e2e/reader.spec.ts`: add tests, and keep every existing one.
3. `tests/e2e/cart-checkout.spec.ts`: only if an existing test fails because of the moved checkout markup, and then only the locator or order. Never weaken an assertion; never touch product code.

Nothing else. If a test shows a product bug, stop and report it with the failing output; do not fix product code.

## motion.spec.ts

Count the scroll reveals through `page.addInitScript`: wrap `Element.prototype.animate`.
- A hold is a call with `duration: 1`.
- A play is a call with a duration over 1.

This is what `src/components/weave/motion.ts` does.

Each test gets a fresh context with `reducedMotion: 'no-preference'` at 1440×900 unless stated.

1. **Story pages, first visit.** For each of:
   - `/`, `/book`, `/built`, `/started`, `/passed`, `/shelf`, `/scenes`, `/contact`, `/store`, `/store/demo-khous`;

   after load:
   - `<html>` has no `data-seen`;
   - holds > 0.

   Then scroll to the end in steps of about 0.6 of the viewport, about 200ms apart, and wait. Every held element was played: plays ≥ holds.
   - `/store/demo-khous` exists only in the local seed. If the page is the not-found page, skip it with a reason rather than fail.
   - A page whose reveals all sit in the first screen at 1440 may have 0 holds. Pick the pages from a probe run first, and state the list you settled on.
2. **Calm pages.** On `/cart`, `/checkout` and `/policies/privacy`:
   - no hold and no play at all, after a full scroll;
   - the `<h1>` has `data-enter` and `data-fx="fade"`;
   - its computed `animation-duration` is at most 0.3s.
3. **Return visit.**
   - Open `/started` and scroll to the end.
   - Follow a real in-page link to another page (client navigation, not `page.goto`).
   - Then `page.goBack()`.
   - Expect:
     - `<html data-seen>`;
     - every `[data-enter]` has computed `animation-name` `none`;
     - after scrolling to the end, plays > 0.
4. **Reduced motion.** With `reducedMotion: 'reduce'` on `/started`:
   - no holds and no plays;
   - `[data-enter]` has `animation-name` `none`.
5. **Dev and export.** The spec must pass against `next dev` (the default `baseURL`, `http://localhost:3000`; a server may already be running and is reused). It must also pass against the static export (`PLAYWRIGHT_BASE_URL=http://localhost:4010`). Do not build or serve the export yourself; the orchestrator runs it. On dev, test 1 is exactly what failed before the fix (every page came back with `data-seen`), so it must fail if `MotionLayer`'s double-run guard is removed. Check that by reading the code, not by editing it.

## reader.spec.ts additions

Use the existing helpers: `openBook`, `where`.
- `page.mouse` for clicks and drags.
- The shown leaves are `.stf__item` whose computed `display` is not `none`.

1. **At 390×794.** Open the book at «الإهداء 1 / 5».
   - Click the left half of the shown page five times:
     - the label goes 1 → 2 → 3 → 4 → 5;
     - the label is never empty after any turn;
     - the shown leaf is never `data-kind` `blank` or `endpaper`.
   - Then click the right half back to 1.
   - Clicks at 45% and 55% of the page width turn next and previous.
2. **At 390, a drag from page 1.** A mouse drag from the page's bottom-left corner across to its right edge lands on «المقدمة 2 / 5», never on the blank. The label is never empty, sampled every 150ms for 2.5s after release.
3. **At 390, on page 2.** The shown leaf has both `data-corner` and `data-corner-back`. On page 1 it has `data-corner` and not `data-corner-back`.
4. **At 1440×900.**
   - A click near the bottom-left corner of the left page turns to the next spread.
   - A click near the bottom-right corner of the right page turns back.
   - At the first spread, a click on the endpaper's bottom-right corner closes the book. About 150ms after the click, the `.stf__parent` has `data-turning` and `data-at="front"`. After the turn, the label is «الغلاف».

Keep the tests deterministic: wait for the label, not fixed sleeps, where possible. Scroll the page so the book's bottom is on screen before clicking corners.

## Before you start

- Check free RAM (`Get-CimInstance Win32_OperatingSystem`, FreePhysicalMemory). Under 6 GB, stop and report.
- Run with one worker, as the config does. No polling loops or sleeps outside tests.

## Commands to run

- `pnpm exec playwright test tests/e2e/motion.spec.ts tests/e2e/reader.spec.ts`: all pass on dev.
- `pnpm exec playwright test tests/e2e/cart-checkout.spec.ts`: report the result. If these need the local Supabase stack and it is not running, say so; do not start or reset it.
- `npx eslint tests/e2e` and `pnpm -s typecheck`: clean.

## Report

Return:
- the files changed;
- each test's name;
- the exact commands, with pass/fail counts and exit codes;
- the list of pages used in motion test 1, and why any were left out;
- anything flaky, with its evidence;
- any product bug found.
