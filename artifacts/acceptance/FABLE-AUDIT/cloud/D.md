# Round D (cloud continuation): the operations documents and the P08 contract, the record

Orchestrator: Claude Opus 5.5 at effort max, the cloud continuation session under D48. Worker: Claude Sonnet 5.5 at effort max, one fresh worker, from `cloud/brief-D.md` (the item list of record: `work/briefs/brief-D.md`). Auditors: Claude Opus 5.5 at effort max, independent of the writer (an audit of the worker's diff, then a focused check of the orchestrator's fixes). Committed as `b46f174` on `claude/amazing-planck-qv3f7a` (brief `4001ee7`).

## What the round did

Documents only: no code, test or migration changed. 21 files, +1248/-273.

| Item | Status | Where |
|---|---|---|
| D-1, the restore runbook | done, then fixed (D-A1, D-A5, D-F1, D-F2) | `docs/operations.md`, "A real restore into a new hosted project" in 21 steps; "What the rehearsal guarantees about its scratch stack (round S)" |
| D-2, when something goes wrong | done, then fixed (D-A2, D-F3) | `docs/operations.md`: rotating a secret, a webhook outage or a double payment, a paused project, removing access in a hurry (the revoke outcomes), a leaked order link, lifting a suppression |
| D-3, the runbooks' payment and mail facts | done | `docs/operations.md`, `docs/payments-runbook.md` (STALE 409, the new alert kinds, "Changing the payment mode"); the refund timing (VENDOR-PAY-08) left as the owner's open decision |
| D-4, the privacy data map | done, then fixed (M2-12, D-F4) | `docs/privacy-data-map.md` |
| D-5, development | done | `docs/development.md` (pnpm 10.34.6, Next.js 16.3.8, from package.json and CI) |
| D-6, costs | done, then fixed (D-A6) | `docs/costs.md` |
| D-7, D-8, D-9, D-10 | done | `PLANS/ARCHITECTURE.md`, `DATA-AND-SECURITY.md`, `VERIFICATION.md` (the CI line after round S), `COVERAGE.md`; the P12 sections (D50) untouched |
| D-11, the P08 contract | done | `PLANS/P08-CONTRACT.md` (sections 2, 3, 6 to 9, 11, 12; section 13, items 13 to 31) |
| D-12, the design documents | done, then fixed (D-A4) | `DESIGN.md` sections 4, 6, 8 and 11 (section 10, the admin, and its lines in sections 1 to 3 untouched); `PLANS/DESIGN-AUDIT.md` |
| D-13, the reference files | done; DOCS-44 by the orchestrator | `PLANS/SOURCE-NOTES.md`, `P08-KICKOFF.md`, `SITE-STATE-CONTRACT.md`, `artifacts/acceptance/P08/tools/README.md`; `AGENTS.md`'s package order (the worker stopped it rightly: AGENTS.md is hashed in `PLANS/evidence/source-manifest.json`; the orchestrator applied the worker's sentence with the manifest row, byte-exact, CRLF kept, as `02198a6` did) |
| D-14, media rights | done | `docs/media-rights.md`: people in pictures and films (D44 (3) and the written consent owed, E05 open) |

Open decisions written as the owner's: DB-COMMERCE-02 (a ceiling on the units unpaid holds take of one variant, or on active holds per address), Resend's plan (E07), SADAD on the live account, EF-ACCESS-14 (an order-link flood), a second owner account (OPS-PRIVACY-12), the refund timing (VENDOR-PAY-08), what «قريباً» answers after launch (SOON-01), Workers Paid (SOON-08), pause or Pro (E07), the backup files' retention (E08), the five children's films until the written consent. Nothing on E02 or Moyasar moved.

## The audit (Opus 5.5 at effort max): audit_failed, one major; the orchestrator's rulings

The auditor confirmed the scope (every path in the round's list, AGENTS.md byte-identical, section 10 and the P12 sections untouched), all 111 added «…» quotations against the code, every local link and table, the worker's ten claimed deviations from the digests (all true of today's code, but one: staff mail is never held back when sent, yet a replay to a suppressed staff address is refused), and that every open decision is written as open.

| Finding | Ruling and fix |
|---|---|
| D-A1 major: the restore never closed «الشراء» on the restored project: from step 11 the site sold through it before its paid files, its webhook, its ledger and its stock were right, and step 20 "opened again" a store nothing had closed | Fixed: step 5 closes it in the SQL editor (`update finance.commerce_settings set checkout_enabled = false, version = version + 1 where id = 1;`, no audit event, the availability notices stop too); step 20 opens it again |
| D-A2 minor: "the list holds back buyer mail only" and "`outbox_claim`, the only reader" (a replay to any suppressed address is refused, staff included); the query for suppressed contact messages could not find them | Fixed: both readers named, the mail screen's refusal quoted, the query given in place |
| D-A3 minor: "they run on POSIX only and are skipped on Windows" (only the stand-in rehearsal is) | Fixed |
| D-A4 minor: "nothing in the repository repeats this scroll check" (`no-js.spec.ts` and `motion.spec.ts` do) | Fixed |
| D-A5 minor: mail could leave from step 10, before the revokes of step 17, to a member revoked after the backup | Fixed: the functions' `RESEND_API_KEY` is set at the end of step 17; without it the outbox claims nothing (`runOutbox`, `EMAIL_NOT_CONFIGURED`), and staff mail goes to active members only |
| D-A6 minor: a per-million price with no fetched source | Fixed: marked unverified, to read before E07 |
| N1 to N5 | Fixed (the cleanup's exit codes, the active attempts, the three unit tests, two commas, the gate's test list, the contracts P09 and P12 must carry, the anon-surface test named, the Q31 answer, the Email Routing decisions, the sign-in code refused by Resend, the second receipt subject) |
| Leftovers | Fixed here: the privacy map's M2-12 (a test order holds no money), EXECUTION-STATUS's close list, AGENTS.md with its manifest row; for the plan-files round: ISSUES I28's OTP length |

## The focused check of the orchestrator's fixes (a fresh Opus 5.5 at effort max): audit_failed, three minors; the rulings

Confirmed: D-A1 closed (the SQL fits the table, no trigger on it, the update is `commerce_checkout_set`'s without its audit row, and every reader of the switch stops), D-A3, D-A4, D-A6 closed; the outbox claims nothing without the key; the manifest row is AGENTS.md's bytes and hash, with only its two lines changed.

| Finding | Ruling and fix |
|---|---|
| D-F1 minor: "before resuming a paused project, remove its Vault `jobs_secret`" cannot be done (its database is down while paused) | Fixed with the check's text: unset the function secrets first (unverified while paused), resume, remove the Vault secret at once; else decide with the owner; step 21 keeps the old project paused or without its secrets |
| D-F2 minor: "nothing may send mail before the whole ledger is back" (Auth's sign-in codes go from step 15) | Fixed: the outbox's mail waits for step 17; only sign-in codes go earlier, and steps 15 to 17 run without a break |
| D-F3 minor: "(until the 90-day purge)" for messages no notice reached (the purge never takes them, D36) | Fixed, with `select distinct` |
| D-F4 to D-F9 nits | Fixed (a test order under review is kept; step 20's condition; step 9's order; the leftover check covers containers and volumes; HANDOFF's close list; `GATE_ORIGIN` among the gate's inputs; "would have refused") |

No further audit: the fixes are the check's own wording, verified in the code (`contacts_purge`, `order_erasable`, HANDOFF's list).

## Follow-ups (for the plan-files round and later rounds)

- `PLANS/ISSUES.md` I28: the OTP length is 8, with Turnstile (`supabase/config.toml`), not 6.
- From the worker, outside its paths (to check before writing up): `email.ts` has no wording for the alert kinds `policies_reset` and `confirm_mail_braked`; `supabase/config.toml`'s comment above `[functions.contact]` names 3 of the 8 public functions; `artifacts/soon/README.md` and `PLANS/WORK-PACKAGES.md` P11 need the `MODE="open"` step and the Workers Free ceiling; DECISIONS E07's "No Workers plan is needed" (SOON-08); `PLANS/DESIGN-AUDIT.md` row 56, the admin field border (4.8:1 against DESIGN.md section 10's 6.9:1, D49); the plan files' auditor effort line (xhigh) against the owner's ruling for this continuation (max).

## Checks

This container (Node 24.19.0): verify-plan (a read-only Node port of `PLANS/verify-plan.ps1`) PASS, 13 documents, 13 packages, 40 scope owners, 162 frozen hashes; `git diff --check` clean (the staged manifest's two CRLF lines are flagged by `git diff --cached --check` exactly as `02198a6`'s were); check:copy 0; unit 2,583 passed, 1 skipped (the content drift check, local-only). `pnpm lint` covers no Markdown. CI on `b46f174`: run 38468642741, green (every step).

## What only the owner can confirm

Hosted Auth (Turnstile, the eight-digit code, the JWT expiry); the hosted Storage limit and `SUPABASE_SECRET_KEYS`; Moyasar's current terms, fees, SADAD and whitelist pages; Supabase's price past the included invocations, the default spend cap, and whether a Pro project can be paused; whether Resend redelivers webhook events after a 401; a real `pnpm restore-check` on Windows (I53 (3)). The hosted restore has never been run end to end.
