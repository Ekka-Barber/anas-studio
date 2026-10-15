# P08: the acceptance record (2026-10-15)

P08 is the store's payment, order, refund and delivery package under D38 and D45, built to its contract
(`PLANS/P08-CONTRACT.md`) and proven against the local Moyasar emulator; its sandbox gate is E02. This record is the
`REPORT.md` that `PLANS/P08-KICKOFF.md` item 5 asks for. It was written by FABLE-AUDIT's local close (Claude Opus 5.5 at
effort max, on the owner's machine), whose database and e2e battery is P08's acceptance battery
(`PLANS/EXECUTION-STATUS.md`, "Next work" item 3). It closes no E-gate and does not accept P08: the acceptance is the
owner's (below).

## The rounds and their commits

Each round was built by a Sonnet 5.5 worker, audited by an Opus 5.5 auditor and ruled on by the orchestrator (the
round files are in `rounds/`; the ledger row in `PLANS/EXECUTION-STATUS.md`):

| Round | Commit | What |
|---|---|---|
| 0 and 1 | `f308c97` | the emulator and the Moyasar client |
| 2 | `69b7940` | the payment core |
| 3 | `538e716` | the `payments` function and the reconciliation job |
| 4 | `b8fbf2f` | checkout with the invoice step |
| 4b | `bdc57a0` | the hold view and the return page |
| 5 | `c04525f` | order mail |
| the sandbox evidence | `ced46d4` | the owner-approved sandbox pass and the emulator's alignment |
| 6 | `fef5119` | refunds |
| 7 | `217a74b` | delivery |
| 7b | `febd469` | order operations |
| 8 | `157d725` | availability notifications |
| 9 | `3dbe25a` | statistics, disputes, the buyer's privacy functions |
| 10a | `994deb0` | the order page and the notification link pages |
| 10b | `d8bffbe` | the product page's availability and preorder states, the sign-up form, the preorder notes, the lazy hold view |
| 11a | `a4b17f9` | the admin's orders list and order view |
| 11b | `1e85284` | refunds with the step-up, rechecks, external refunds, the reconciliation screen, disputes |
| 11c | `d27d05b` | `variant_admin_info`, the variant form's preorder fields and paid file, the sign-ups list, the commerce figures |
| 12a | `75a845f` | `tests/e2e/orders.spec.ts`: ten journeys at 360 and 1440 on the real stack and the emulator |
| 12b | `3a30a91` | the payments runbook, `docs/operations.md`, `docs/privacy-data-map.md`, `docs/development.md` |

P08 was paused after 12b on 2026-10-03. Its checkpoint (c) was made inside FABLE-AUDIT (wave A's slice P08-CKPT: no
critical or high defect in the money and delivery paths as built and tested against the emulator; one finding rated high
by the orchestrator, P08-CKPT-10, fixed in M1b-2), and what that audit confirmed was fixed in its rounds M1a, M1b, M2,
F1, F2a, F2b, T and F3, or recorded open with its ruling; its round D and plan-files round brought the plan documents up
to date (`artifacts/acceptance/FABLE-AUDIT/REPORT.md`, section 3). All of it is on `main` since 2026-10-14.

## The acceptance battery (`PLANS/P08-KICKOFF.md` item 5), as run on 2026-10-14

On the owner's machine (Windows 11, Node 24.19.0, pnpm 10.34.6, Supabase CLI 2.106.0, Docker Desktop 4.91.0), at
`5107afa` (no product code, test or migration changed since `b3fa932`, the commit CI verified on `main`), from fresh
resets on the owner's word. The evidence is in `artifacts/acceptance/FABLE-AUDIT/after/` (`RECORD.md` and the summaries
beside it); one run serves FABLE-AUDIT and P08.

| Step of item 5 | Result | Evidence |
|---|---|---|
| A fresh reset with the imports | `supabase db reset` (the 30 migrations), `pnpm db:import`, `pnpm db:demo-catalog`, `pnpm db:env`: exit 0, twice (for the database part and for the e2e part); the edge runtime restarted, exit 0, for the database part (`edge-restart.log`), and restarted with Mailpit in the e2e part's setup, which records no exit code | `summary-db.txt`, `summary-e2e.txt` |
| lint, typecheck, `check:copy`, `check:frozen` | 0 | `summary-local.txt` |
| unit | 2,562 passed, 29 skipped by design (the two suites that need a POSIX shell); the content drift check and the link suites ran | `summary-local.txt`, `local-test-skips.txt` |
| `test:db` with the edge runtime | 874 of 874 in 31 files, the eight HTTP files included | `summary-db.txt`, `test-db-files.txt` |
| build, `check:export`, `check:budgets` | 0; 59 required files, 377 text files, no secret; largest page 149.7 KiB of 150 (`checkout.html`) | `summary-db.txt` |
| `PLANS/verify-plan.ps1` | PASS | `local-verify-plan.log` |
| Free memory and leftover headless browsers before the e2e | 10.1 to 10.6 GB free before each part; no Playwright browser left | `summary-e2e.txt`, `RECORD.md` |
| The e2e, in batches | all 17 spec files: 512 passed, none failed, skipped or flaky; batch 1, 181; batch 2, 311 (`store-admin`, `cart-checkout`, `checkout-api`, `product-availability`, `order-page`, `orders-admin`, `orders-money`); `orders.spec.ts`, 20 in 6.4 minutes | `summary-e2e.txt`, `e2e-*.log` |

P08's own suites among them: `cart-checkout` 36 (the deep audit's two cases about a lost create reply among them, run
for the first time), `checkout-api` 4, `product-availability` 46, `order-page` 96, `orders-admin` 52, `orders-money` 36
and `orders` 20; and its integration files in `test:db`, the HTTP ones (`orders-http`, `refunds-http`, `payment-http`,
`checkout-http`, `order-emails`, `notify-http`, `disputes-http`) included. Every payment in them is against the local
emulator on port 54390; Moyasar was not called.

## The backup rehearsal with a paid file (ISSUES I53 (3))

Run on 2026-10-14 by `artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-backup.sh after` (`summary-backup.txt`):
one real `pnpm backup --local` with a paid file uploaded to the empty `paid-files` bucket for the run worked (exit 0;
228 files, 223 storage objects). The real `pnpm restore-check` of that file refused before restoring anything: its
scratch database was published on `0.0.0.0` and `[::]`, because Docker Desktop does not apply the Docker network option
its loopback binding rests on, and the guard stopped it, as it must. The cleanup held (nothing of the scratch stack
remained; the development stack was untouched; the paid file was removed and the backup file deleted). Two Opus
auditors classified it as a product defect in `restore-check` on the machine it is for; on the owner's word ("Record it,
fix later (Recommended)") it is ISSUES I56, with the audited fix design, for a round of its own. So the backup of a paid
file is proven on this machine, and its restore is not.

## What stays open

- **E02** (Anas: the Moyasar account's eligibility, the test and live account, the enabled methods; closed only by real
  sandbox acceptance with redacted ids and the Apple Pay device proof). Only the owner-approved pass of 2026-10-02 ran
  against the real sandbox (eight test invoices created, read, listed and cancelled, no payment:
  `moyasar-sandbox-2026-10-02.md`). What only the real sandbox can prove is the list in `docs/payments-runbook.md`,
  "When the Moyasar keys arrive": what Anas brings (the secret key of each mode, the webhook secret, the account's
  activation for live, a public HTTPS address for the functions, the hosted access code, a supported Apple device, the
  seller's details, policies and catalog for hosted runs), the nine sandbox runs E02 needs (a book purchase, a non-book
  purchase with a delivery fee, a failed then approved payment, 3-D Secure approved, rejected and late, a cancelled
  checkout, full and partial refunds, Apple Pay, the dashboard's own refund and void, a SADAD bill), and the questions
  still open there. Nothing Moyasar moves before the owner's word (D48 (3)).
- **E03** (Anas: prices, stock, city rates, services and policies; no tax, D34): no sandbox run closes it; the live
  checkout needs his configured, approved values and policy revision.
- **The restore rehearsal** on the owner's machine: ISSUES I56.
- **The residuals:** ISSUES I50 (the variant form's paid-file key, the checkout budget, `create`'s `OUT_OF_STOCK`
  wording, a review payment with no order) and I51 (the privacy export's gaps, a refused cart line's generic name, the
  journeys spec's run rule; it ran in 6.4 minutes here); FABLE-AUDIT's recorded-open entries (`REPORT.md`, Appendix B),
  P08-CKPT-04, -07 and -09 among them; and the visual findings on the store and the admin's money screens (ISSUES I55 (2),
  `artifacts/acceptance/FABLE-AUDIT/after/visual/visual-pass.md`), whose fixes are the owner's to approve.

## The owner's answer

Asked at the end of FABLE-AUDIT's local close, with the facts above (its acceptance battery is this run: green, except
the restore rehearsal, which is red on Docker Desktop, ISSUES I56; E02 and E03 stay open): recorded below once given.
