# Handoff

## Design session of 2026-09-28: direction B (D39)

Anas picked direction B «أنساق» (cover B, standing mockup B). The orchestrator ported it into the product alone, as the owner asked (no sub-agents, no GLM).

**State.**
- DESIGN-B is committed on branch `agent/design-b` (owner, 2026-09-28): `1ffb8a1` and `7ac94e8`, not pushed. Its lock was released.
- P02 (the book preview reader), with the audit-2 fixes, is committed on top on the owner's word (2026-09-28: "once all fixes done commit"), not pushed; its lock was released. Evidence: `artifacts/acceptance/P02/commands.txt` and `audit-2/FINDINGS.md`; how it works: `docs/book-preview.md`.
- From audit-2 on, the owner allows Opus 5.5 sub-agents (`opus-worker`, effort xhigh) for easier bounded work, one writer at a time, audited by the orchestrator. There is still no GLM for design.
- Serious pages (the cart, the checkout, the policies, and P08's payment and order screens) stay calm and official: no reveals, only the title's short fade (DESIGN.md §4 and §6).
- Evidence: `artifacts/acceptance/DESIGN-B/commands.txt`. The design reference is `DESIGN.md`; the product brief is `PRODUCT.md`.

**How to look at it.**
1. `pnpm dev`, then open `/`, `/started`, `/built`, `/passed`, `/shelf`, `/book`, `/journal`, `/scenes`, `/contact`, `/store`.
2. The local content must be the D39 import: `pnpm db:import --force`. Its fields are new: the room colour and line, band lines, the home page's words.

**Next.**
0. DONE 2026-09-28: the design audit (tasmeem, the sweep brief's primary skill) and every fix, in two rounds: `artifacts/acceptance/DESIGN-B/tasmeem-audit/after/FIXES.md`. Only row 4 (I40, a launch check), row 5 (an owner note) and row 19 (a documented exception) remain. The sweep brief's per-skill cross-checks were not run separately.
1. DONE 2026-09-28: the owner asked for the commit (`1ffb8a1`, `7ac94e8`).
2. Anas's inputs:
   - the paper edition's details and prices;
   - the book's characters;
   - the 2013 photo;
   - consent for the five films with children (they stay hidden until then).
3. DONE 2026-09-28, committed on the owner's word: P02, the book preview reader with Anas's three approved fragments (E04 range), and audit-2 (motion on the dev server, calm money pages, reader taps). The final manuscript stays open under E04.
4. P08 adds the availability sign-ups, and P09 the booking. Until then, a service's «اطلب جلسة» fills the contact form.

---

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

Steps 1 to 3 are DONE. The round 3 audit is `d10dd1d`; the battery is green (every step at `d10dd1d`, and the e2e, cut short there by a memory crash, rerun on 2026-09-28 at `45dbfa6` to 95/95); the proof map is in `artifacts/acceptance/P07/commands.txt`. **P07 is accepted** (owner, 2026-09-28: "I accept p07 for now"). No lock is held: the orchestrator released `.anasaq-execution.lock` after pushing the acceptance record.

**Design in another session.** The owner then paused this line to rebuild the full UI/UX design system in Claude Desktop (Opus). Before resuming here: read `git log` after the commit that records this acceptance, and check whether a design direction was accepted. An accepted direction needs a `PLANS/DECISIONS.md` entry (D17 and DESIGN-AUDIT still say the design is frozen, I25), and under D38 the plain store pages are then restyled to it. The owner will say when to resume; the next package here is P08 (step 4).

Before any full e2e run: check free memory. The run crashed at about 6 GB free and passed at 11.8 GB after the owner closed other sessions.

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
