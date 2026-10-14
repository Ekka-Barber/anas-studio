# The local ratification of the cloud branch (e800fc5): the record

Verification only. By ZCode (GLM-5.3), owner-dispatched, 2026-10-08 afternoon (Riyadh), on the
owner's Windows machine — the machine the standing division (2026-09-26) names as the runner of
the database, e2e and screenshot work. No product file was written; the only writes are the logs
beside this record, this file, one appended Update in `../STATE.md`, and the lock file's RATIFY
round. The lock was held for the duration (`allowedPaths`: this folder only).

Branch: `cloud-ratify` at `e800fc5` (= `origin/claude/amazing-planck-qv3f7a`, the cloud
continuation's last push, 2026-10-08 06:38 Riyadh). Environment: Node 24.19.0, pnpm 10.33.0
(`package.json` still pins it; round S has not run), Supabase CLI 2.106.0, the ANASAQ stack
restarted from scratch by the battery itself. The saloony / saloony-repair containers were
never touched.

## What ran, and what it proved

| Check | Result |
|---|---|
| From-scratch stack (`battery-db.sh`): db reset, content import (7 docs), demo catalog (3 products, 5 variants, 7 rates, 1 coupon, 3 policies), db:env, edge runtime restart | all exit 0 |
| `test:db` — the whole integration suite | **874/874 in 31 files (258 s)** |
| lint / typecheck | 0 / 0 |
| unit suite | **2,536/2,536 in 69 files** — including the content drift check, which the cloud container had to skip (local-only) |
| build / check:export / check:budgets | exit 0; 59 required files; 377 text files scanned, no secrets; **largest page 149.4 KiB of 150.0** (CI had 149.5 on the same commit) |
| e2e, the seven never-run specs (below) | **185 passed, 0 failed, 0 flaky** |
| `pnpm audit --prod` | RED, as expected before round S: 1 critical / 4 high / 4 moderate / 1 low — the next 16.3.5 advisories round S exists to fix |
| secret scan (git grep of key shapes over tracked files, values never printed) | clean — every hit is a 6–15 character test placeholder or prose fragment; no key-shaped string anywhere |

The eight edge-runtime HTTP integration files CI cannot run all ran and passed inside the 874:
`orders-http`, `refunds-http` (the four F3a tests), `payment-http`, `checkout-http`,
`staff-admin`, `email-delivery`, `notify-http`, `disputes-http`.

## The never-run e2e set, now run

The cloud round records (`../cloud/F3.md`, `../cloud/D1.md`) marked these "written, not run".
All green on this machine:

| Spec | Tests | What it proves |
|---|---|---|
| `no-js.spec.ts` | 18 passed | D1-2: the brand link's accessible name «أنس anas.studio، الرئيسية»; the inline header |
| `reader.spec.ts` | 18 passed | D1-8 (c): end-of-pages buttons stay focusable (`aria-disabled`); the turn/focus order |
| `cms.spec.ts` | 7 passed | F3b: the «أرشفة» archive confirmation question |
| `orders-money.spec.ts` | 36 passed | F3a audit A1: the two `REFUND_KEPT_REPLY` bodies and the kept-key sentences |
| `orders-admin.spec.ts` | 52 passed | F3b: the press focus; F3-4's shipped/correction sentences in `orders-admin` |
| `cart-checkout.spec.ts` | 34 passed | D1-12: «بتوقيت الرياض» at lines 612/865/1186; B1: no warning for the same cart; the one-copy sentence |
| `orders.spec.ts` | 20 passed | D1-12: the hold view's «بتوقيت الرياض» at line 495 |

`orders.spec` completed in 6.2 minutes — the baseline's 15-minute global timeout was
machine load, not the spec.

## Verdict

**RATIFIED.** Every check the cloud continuation deferred to "the owner's machine" or "CI
decides" is now proven locally, green, end to end: the from-scratch database, the full
integration suite including the eight HTTP files, the unit suite including the local-only
drift check, the build, the export and its secret scan, the budgets, and all seven never-run
Playwright specs. Nothing the cloud session committed failed anywhere it had never run.

## What this record does NOT close

- The HELD visual items (D1's screenshot round: D1-1 lightbox fit, D1-2's 320 px header,
  D1-3/4/5, D1-6 (b)(c)(d), D1-7, D1-8 (a), D1-9, D1-10, STORE-UI-02/06/07/15,
  DSN-HOME-12/17/25/26/27, DSN-PAGES-02/15, and D1-8 (b)'s Chrome accessibility-tree check).
- F3b's visual once-over of its changed screens (AdminHome, OrderView, CommerceSettingsForm,
  DisputeForm, PublishBar, CollectionList, FieldInput, MediaPicker, EmailView, SignIn,
  MfaEnroll, StepUp, HoldView, CheckoutForm, CartView, ContactForm, PaymentReturn).
- F3-16 (g), the refund-timing sentence — the owner's open decision (VENDOR-PAY-08).
- F1-15, the pepper length check — deferred to P11's hosted setup.
- The audit's own remaining rounds: S (brief written at this very commit, never dispatched),
  D, the plan files, the after-battery, REPORT.md, and the merge to `main`.
- The supply-chain reds (round S's reason) stand, recorded in `secrets-and-audit.txt`.
