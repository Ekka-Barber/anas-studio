# P08 kickoff prompt

Paste everything below the line into a new session opened in this repository. It is written as the owner's message. The session needs the Workflow tool, so keep the word "ultracode" in it.

---

ultracode

You are the orchestrator for ANASAQ (anas.studio). Start as `PLANS/KICKOFF.md` says, then do **P08 in full**: build, test and document everything P08 owns, up to the point where the only thing left is the proof that needs Anas's real Moyasar account.

## What "done" means here

- Anas has not brought the Moyasar account yet. There is **no test API key and no real sandbox**. Build and prove P08 against a local Moyasar emulator (D38). Make no network call to Moyasar and ask me for no key.
- Take every Moyasar API shape (hosted invoices, the webhook and its `secret_token`, fetching a payment and an invoice, refunds, statuses, minimum amount, test and live mode) from Moyasar's own documentation, fetched in this session, and record each source in `docs/payments-runbook.md`. A remembered shape is not evidence. The emulator implements those documented shapes and nothing else.
- Moving from the emulator to the real sandbox must be a configuration change only: a base URL, the keys and the webhook secret, all read from environment variables. No code change.
- E02 and E03 stay open. Nothing claims a real payment, a real refund or a closed gate. Checkout stays off outside the local stack.
- When P08 is finished, write "When the Moyasar keys arrive" in `docs/payments-runbook.md`: the exact things Anas must bring, and the short list of sandbox runs that close E02 (book purchase, non-book purchase, failed, 3-D Secure, cancelled, refund, Apple Pay on a supported device), each with what to record.

## Scope

The whole P08 section of `PLANS/WORK-PACKAGES.md`, with `PLANS/DATA-AND-SECURITY.md` (the checkout and payment protocol, refunds, delivery, disputes), `PLANS/VERIFICATION.md` (payment, refund, stats and dispute proofs) and `PLANS/ARCHITECTURE.md` (the planned functions). In short:

1. The emulator (`tests/support/moyasar-emulator.ts`) and the Moyasar client (`supabase/functions/_shared/payments/moyasar.ts`).
2. Finance migrations: payment attempts written before any network call, webhook events stored before the reply, `apply_verified_payment`, refunds with a reserved balance, fulfilments, return requests, entitlements, download tokens, the dispute and payout audit trail, availability notifications, preorder.
3. Edge Functions: `payments` (webhook and return verification), `orders` (access by token), `download` (a short-lived signed Storage URL from a private bucket), `notify` (opt in, confirm, unsubscribe), refunds in `admin` with a fresh owner TOTP, and the every-minute reconciliation of pending and uncertain attempts.
4. Checkout: the invoice step after `checkout_create`, and every item of I48 in `PLANS/ISSUES.md`.
5. Preorder (moved here by D42): the variant flag, capacity, date and delivery description; never sold beyond capacity.
6. Public pages: the payment return page («جارٍ التحقق من الدفع», a redirect is never proof of payment), the order page with its token in the URL fragment, downloads, the availability sign-up, preorder on the product page. Money pages stay calm and official (D38): no reveals.
7. Admin: orders with verified evidence, fulfilment, tracking, signed dedication, returns, refunds, reconciliation, disputes, low-stock and unresolved-paid alerts.
8. Receipts and notices through the outbox; statistics that reconcile with the ledger.
9. Tests: the integration and e2e files P08 names, covering every negative, duplicate, out-of-order, retry, crash and late-payment case in VERIFICATION, a synthetic dispute, and a repeated reconciliation that does not double-count.
10. Documents: the payments runbook, `docs/operations.md`, `docs/privacy-data-map.md`, COVERAGE (C20, C26, C28, C29, C30), ISSUES, EXECUTION-STATUS and HANDOFF.

If the plan and the code disagree, the code is the fact: read what P07 really left (`supabase/functions/_shared/checkout.ts`, `20260927160000_catalog_and_checkout.sql` and the later migrations) before you design.

## Roles (D45), no exceptions

- **You, Opus 5.5:** plan, design, rule on audits, fix small things, and write the contract yourself.
- **Workers: Sonnet 5.5 at effort max.** `sonnet-worker`, one at a time, a fresh one per round, under `.anasaq-execution.lock`.
- **Auditors: Opus 5.5 at effort xhigh**, in workflows too. Sonnet never audits Sonnet work (D43).
- Name the model and effort on **every** dispatch. A dispatch without them is a mistake:
  - workflow worker: `agent(brief, { agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' })`
  - workflow auditor: `agent(brief, { agentType: 'auditor', model: 'opus', effort: 'xhigh' })`
  - Agent tool auditor: `subagent_type: 'auditor'`, `model: 'opus'`
- Do not turn on agent teams and do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. No parallel writers, no worktrees: one writer at a time.

## How to run it

1. **Contract first.** Before any worker starts, write the P08 contract yourself: the tables, the order and payment states and who may move them, every SQL function's signature and grants, every Edge Function's request and response, the emulator's routes, the environment variable names, and the invariants (money settles once; a refund never exceeds what was captured; stock and capacity never go negative; no token or secret is stored in clear). Have an Opus auditor attack it (checkpoint 1) and settle its findings before round 1.
2. **Rounds.** Sequential workflow rounds in dependency order (roughly: emulator and client; payment migrations; `payments` and reconciliation; checkout wiring and I48; receipts; refunds; delivery; notify; preorder; order pages; admin screens; statistics and disputes; documents). Each round: one Sonnet worker with a short brief listing exact files and checks, then an Opus auditor on that round's diff, then at most two re-fix rounds with fresh workers. Give every worker and auditor the contract.
3. **The auditor's three checkpoints.** Call an Opus auditor (a) before a contract between layers is fixed: does every caller's payload match the function's schema and the SQL signature, field by field? (b) when a check has failed twice: is the fix removing the cause or hiding the symptom? (c) before the package is called done: which attack, replay, race or edge case does no test cover?
4. **Your own part of the audit.** Rule on every auditor finding. Read every migration, every money path and every token or file path yourself before acceptance. Use every changed control in the browser at 360 and 1440 (`PLANS/DESIGN-AUDIT.md`).
5. **Acceptance battery**, from a fresh `pnpm db:reset` with the imports: lint, typecheck, unit, check:copy, check:frozen, test:db with the edge runtime, build, check:export, check:budgets, `PLANS/verify-plan.ps1`, then the e2e in two batches. Before the e2e: check free memory, and stop any headless Chrome left over from earlier scripts. Evidence goes to `artifacts/acceptance/P08/` with a `REPORT.md`.
6. **Token rules** (CLAUDE.md, I24): no polling, a fresh worker per round, never `/compact` while a workflow runs. If the session gets long, write the state into `PLANS/HANDOFF.md` and `PLANS/EXECUTION-STATUS.md`, commit what is accepted, and tell me to continue in a new session.

## Decisions

Decide every technical question yourself and tell me afterwards. Ask me only for an owner's decision: money, a promise to a buyer, a legal text, or anything Anas must supply. Never invent a price, a policy, a payment or a gate closure. Do not deploy and do not touch the hosted project.

I authorize commits and pushes to `main` for P08, one accepted piece at a time, once its checks are green. Leave uncommitted changes that are not yours alone.

## Report

When you stop, tell me in plain words: what was built, what you found and fixed in audit, the battery results, the overall progress percentage with the per-phase table, what is left that needs Anas (the list from the runbook), and anything you could not prove without the real sandbox.
