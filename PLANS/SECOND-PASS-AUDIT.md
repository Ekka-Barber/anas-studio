# Second-pass execution audit

Date: 2026-09-21. Assessment: **8.5/10 as a planning handoff**, a judgment rather than a measured score. Ready for P00; production feasibility is still unproved. Reviewed the planning documents and existing research conclusions, then ran the planning verifier. This review does not independently refresh provider pricing, package advisories, source-offer interpretation or the previous visual audit.

## What is already strong

The plan has 40 assigned contractual requirements, 13 bounded packages, protected source assets and explicit external gates. It correctly retains Payload, separates private manuscripts from previews, makes payment verification authoritative, handles concurrent stock/booking reservations and uncertain refunds, and distinguishes launch from training/support closure. Native CMS behavior, one writer and a separate bonus workspace substantially reduce scope drift. Do not replace this architecture or add another service on speculation.

## Changes that improve execution

**Integration status:** all seven findings below are incorporated into DECISIONS, ARCHITECTURE, DATA-AND-SECURITY, WORK-PACKAGES, COVERAGE, VERIFICATION and README. They are implementation requirements with package owners and proof, not a detached recommendation list. The descriptions below preserve the reasons for the changes. Runtime and operational acceptance remain unperformed.

1. **Prove representative runtime behavior earlier (P00, then each relevant package).** The minimal login/CRUD/upload spike in [WORK-PACKAGES.md](WORK-PACKAGES.md) is necessary but cannot establish that the later editor, native versions/jobs and scheduled financial work fit Workers Free. Add a small versioned Lexical record and a bounded scheduled-job probe, cold and warm measurements, read-after-write, and rollback through Hyperdrive. Record the actual Supabase pooler mode, driver/prepared-statement settings, connection limits and measured CPU/compressed size against current limits. Recheck the Worker after dependency-heavy packages. Local preview passing is not hosted-Free proof. Do not silently upgrade hosting when it fails.

2. **Close the P00 path/provenance gap.** P00 requires custom routes to coexist with Payload's catch-all, but its file list names no concrete custom API handler. Enumerate a minimal `src/app/api/health/route.ts` in the execution lock before that test; P06 can later extend it. Current planning edits are uncommitted. Record their hashes and Git status, so the lock's base commit is not mistaken for the entire supplied baseline. Preserve those changes and exclude them from unrelated implementation commits.

3. **Make cost and recovery promises executable (P06/E07).** Roughly $30/month is the recorded hosting/database baseline, not an all-in price. Encrypted off-site binary backups have no selected destination, capacity calculation or documented free allowance. Name the destination and encryption-key custodian; measure full/incremental backup size and restore time, including deleted-file retention. Record applicable Workers/Hyperdrive, R2, email, CI and monitoring allowances and overage behavior. Set available usage alerts and application work limits. Alerts are not hard spending caps. If the $0 staging envelope is insufficient, report it; never silently omit backup tests or incur charges.

4. **Finish email failure behavior (P06/P08).** Durable outbox handling is good, but provider acceptance is not delivery. Specify verified bounce/complaint handling, recipient suppression, bounded retries, exhausted-job visibility and safe manual replay. Reserve email capacity for password recovery and receipts before availability announcements. Treat provider idempotency expiry explicitly; never claim unlimited exactly-once email delivery.

5. **Bound unpaid reservation abuse (P07/P09).** Generic throttling is present, but checkout/booking acceptance should explicitly prove that many distinct idempotency keys cannot indefinitely monopolize scarce inventory or slots. Define bounded active holds and attempt limits before reserving resources, reclaim expired holds, and test legitimate shared-network users. Do not add paid fraud tooling or require buyer accounts.

6. **Cover disputes and settlement discrepancies (P08/P11).** Refund handling does not cover chargebacks or a difference between captured payments and bank payouts. Add a manual owner runbook first: verify the provider record, record dispute/adjustment evidence, decide fulfillment/entitlement action explicitly, and reconcile totals without rewriting history or double-counting refunds. Add automation only if the gateway's verified capabilities and actual volume require it.

7. **Turn privacy policy into an operation (P06/P11/E08).** Retention and legal gates already exist. Add a verified-identity request procedure for access/export/correction/deletion, including linked orders, contacts, subscribers, logs and backup expiry. Preserve legally required accounting records, document exceptions and keep private workspace notes out of customer exports. Test with synthetic records; no new self-service portal is needed.

These are execution clarifications and reliability work, not permission to expand the contracted product. The 7–9-week offer is not validated by package labels: re-estimate after P00 and the first end-to-end payment proof. Preserve the offered scope and seek agreement before changing commercial commitments.

## Optional additions without a new paid service

- Journal RSS/Atom feed from the existing published-content loader: portable subscriptions, with draft/future/private exclusion tests.
- Remember the approved excerpt's reading position locally: no account, backend write or manuscript access. Store only preview ID/version/page and tolerate disabled storage.
- Share/copy a public article or project link using Web Share with a clipboard fallback: accessible success/failure states; never share private token URLs.

Each still costs implementation, testing and some usage. They are suggestions, not accepted scope, and should wait until core acceptance. Existing coupons, calendar export, availability alerts, backups and owner statistics are already planned, not new free features. Avoid AI chat, SMS, bidirectional calendars and new dashboards at this stage.

## Verification

`powershell -NoProfile -ExecutionPolicy Bypass -File PLANS/verify-plan.ps1` checks the 13 required documents (including this audit and the first prompt), 13 packages, 40 unique scope owners, 360 frozen hashes and PLANS-only changes. The recorded result is in evidence/planning-checks.json. This proves planning structure and preservation, not runtime, legal compliance or actual UI quality. The previous design audit remains an execution checklist; no interface was built or visually certified in this review.

Next action: use [FIRST-GLM-PROMPT.md](FIRST-GLM-PROMPT.md). Execute P00 only and stop for its evidence-based decision.
