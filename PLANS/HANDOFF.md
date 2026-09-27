# Handoff: orchestrator session of 2026-09-27 (second) to the next session

The repository is the source of truth. Read this, then `PLANS/EXECUTION-STATUS.md`, `PLANS/ISSUES.md` (I38, I39) and `artifacts/acceptance/P07/commands.txt`.

## Start

```sh
git fetch origin
git checkout sync/local-2026-09-26
git pull --ff-only origin sync/local-2026-09-26   # the commit that adds this file, or later
```

Follow `CLAUDE.md`, `AGENTS.md` and `PLANS/README.md`. No lock is held: take `.anasaq-execution.lock` with `fs.openSync(path, 'wx')` before writing. The local stack runs with every migration applied (through `20260927180000_store_media.sql`), the content imported and the demo catalog seeded (`pnpm db:demo-catalog`, D37). Never stop it with `--no-backup`; after a reset run `pnpm db:import` then `pnpm db:demo-catalog`.

## Owner decisions this session

- P06 accepted (2026-09-27).
- D37: a labelled demo catalog with placeholder prices through a local-only seed; Anas replaces every value; E03 stays open.
- D38: keep building while the v2 design (I25) and Moyasar activation are pending; P08 is built against the local emulator; E02 stays open.
- Working mode: glm-worker builds each round from a committed brief; the orchestrator audits every file, fixes, re-proves, commits and pushes with the owner's standing go-ahead.

## Done and pushed

| Commit | What |
|---|---|
| `d12209e` | I37: the e2e dev server builds into `.next/e2e` |
| `bd8e93f` | I35: one due predicate for the email job and `outbox_kick` |
| `556e910` | Phase 2 walk-through, 14 admin fixes |
| `cae43d9` | P06 acceptance battery (all green), proof map |
| `87015fc` | P07 catalog and checkout migration (orchestrator) |
| `e1c5458` | P07 round 1: `checkout` function, demo seed, tests (unit 327, db 172) |
| `3bb68a2` | P07 round 2: store admin and owner-approved policies (db 177, e2e 16/16) |
| `9fd3925` | P07 store media migration and the round 3 brief |
| the commit adding this file | P07 round 3 as built by glm-worker, with the orchestrator's fixes so far |

## Status after the third session (2026-09-27)

Step 1 is DONE (`d10dd1d`, details in `artifacts/acceptance/P07/commands.txt`). Step 3's battery ran at `d10dd1d` and is INCOMPLETE: every step passed except e2e, where 69 tests passed and `store-admin.spec.ts` and `visual.spec.ts` were cut short when the machine ran out of memory (crashes, no assertion failure). Next: with the owner's go-ahead and memory freed, run `ACCEPTANCE_PACKAGE=P07 pnpm test:e2e` to completion, record it, then ask the owner to accept P07 (the proof map is already in `commands.txt`). The orchestrator's lock for P07 is still held on the owner's machine.

## Next work, in order

1. **Finish the P07 round 3 audit** (`artifacts/acceptance/P07/brief-r3-store-pages.md` is the contract).
   - **Read the code not yet reviewed:**
     - `src/components/store/CartView.tsx`, `CheckoutForm.tsx`, `CartProvider.tsx`, `CartLink.tsx`, `store.module.css`;
     - `src/lib/cart.ts` beyond storage;
     - `src/lib/store.ts`;
     - `src/app/(public)/policies/[slug]/page.tsx`;
     - the docs changes.
   - **Check the checkout form:**
     - the idempotency key is reused only for an identical retry;
     - `policyRevisions` sent are the quote's;
     - Turnstile renders with the test site key;
     - nothing is cleared on success;
     - the cancel uses the session token.
   - **Fix `tests/e2e/cart-checkout.spec.ts` (8 of 11 fail):**
     - scope the price assertions to the fixture's own card or line, and give the fixture prices no demo product uses;
     - for I38, find why `next dev` 404s the fixture product page mid-run, or seed the cart through localStorage in the flows that do not test the product page.
   - **Review the store screenshots** (`artifacts/acceptance/P07/screenshots/store-*.png`) at 360 and 1440.
   - Then run the full battery and commit.
2. **I39 is done** (owner approved): `pnpm build` clears `.next/cache/fetch-cache` first, so every build reads fresh data. Nothing to do.
3. **Close P07:**
   - the acceptance battery with `ACCEPTANCE_PACKAGE=P07`;
   - the proof map in `commands.txt` (WORK-PACKAGES P07 proof list);
   - ask the owner to accept P07.
4. **P08 under D38:**
   - Moyasar hosted invoices against `tests/support/moyasar-emulator.ts`;
   - the `payments` webhook with `secret_token` and an authoritative fetch;
   - `apply_verified_payment`;
   - receipts through the outbox;
   - the notify routes moved from P06 (D31);
   - refunds with owner step-up;
   - digital delivery.

   E02 stays open until the real sandbox.

## For the owner and Anas (unchanged)

E08 privacy policy wording (D35 backups, D36 90-day retention); the R2 note (D32); I33 room videos; key rotation; MCP tokens on command lines; P11 only with authorization. New: the demo catalog (D37) is local only; nothing reaches the hosted project without the owner's decision.

## Rules to keep

- **Secrets and frozen sources:** never read or print `.env`; never edit `deploy/design/`; never inspect `_archive/`.
- **Never invent:** prices, payments or E-gate closures.
- **Runs:** Playwright on `http://localhost:3000`. After every e2e run, restore the screenshots the task did not change and `next-env.d.ts`.
- **glm-worker:** its launcher cannot run `git checkout`. Check `permission_denials` in its JSON, and prove no process of its own is still running before you audit.
- **Editing files with scripts:** a replacement containing `$` followed by a backtick, `'` or `&` is a `String.replace` pattern. Use the Edit tool or a replacer function.
- **Escapes:** the command transport turns `\u` escapes into real characters, so write escapes with the Edit tool.
