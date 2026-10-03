# Payments runbook (P08)

**Status.** P08, the verified gateway and the post-sale operations, is built and proven against the local Moyasar emulator (`tests/support/moyasar-emulator.ts`). The E02 and E03 gates are open. The only calls ever made to Moyasar from this repository are one owner-approved sandbox pass of 2026-10-02 that created, read, listed and cancelled eight test invoices (no payment; see "What the sandbox answered"). No real payment, refund or webhook has happened, and nothing below claims otherwise.

How the file is laid out: the sources the code relies on and the local emulator come first; then how a payment settles, refunds, disputes and payouts, and the switch from the emulator to the real sandbox and then to live; the last section, [When the Moyasar keys arrive](#when-the-moyasar-keys-arrive), lists what Anas brings and the supervised sandbox runs that are still owed. The owner's daily routine is in [operations](operations.md), the local stack in [development](development.md), and what the system keeps about a buyer in [privacy-data-map](privacy-data-map.md).

## Sources

Everything the code assumes about Moyasar comes from the pages below, which the orchestrator read on **2026-10-02**. `D` is `https://docs.moyasar.com`. The same tables are in `PLANS/P08-CONTRACT.md`, section 2. Nothing else about Moyasar may be assumed: if a round needs a shape that is not here, it stops and reports it.

### The documented shapes the code relies on

| Fact | Source |
|---|---|
| Base URL `https://api.moyasar.com/v1`. "The mode for the request is determined by the API Key used for authentication." | `D/docs/api/api-introduction.md` |
| HTTP Basic auth: username the API key, password empty. Test keys `pk_test_`, `sk_test_`; live keys `pk_live_`, `sk_live_`. All calls over HTTPS. | `D/docs/api/authentication.md` |
| Errors: body `{ "type", "message", "errors" }`; types `invalid_request_error`, `authentication_error`, `rate_limit_error`, `api_connection_error`, `account_inactive_error`, `api_error`, `3ds_auth_error`; statuses 400, 401, 403, 404, 405 (entity not activated for live), 429, 500, 503. 401 example: `{"type":"authentication_error","message":"Invalid authorization credentials","errors":null}`. | `D/docs/api/errors.md` |
| Lists return 40 objects per page, newest first, with `meta: { current_page, next_page, prev_page, total_pages, total_count }`. | `D/docs/api/pagination.md` |
| Metadata: on payments, invoices, payouts, tokens; up to 30 keys, key ≤ 40 chars, value ≤ 500 chars; list payments and list invoices filter by `metadata[key]=value`. | `D/docs/api/metadata.md` |
| Idempotency exists only for payment creation (`given_id`). Nothing is documented for invoice creation or refunds. | `D/docs/api/idempotency.md` |
| Create invoice: `POST /invoices`, JSON. `amount` integer required, `>= 100` (smallest unit); `currency` required; `description` required; optional `callback_url` ("will get a POST request with the invoice object when the invoice is paid … not used to redirect the user, this is only used to send a notification"), `success_url` ("the payer will be redirected to when the invoice is paid"), `back_url` ("redirect when the user clicks on the back button"), `expired_at` (ISO 8601; "User will be prevented from paying the invoice once expired"). The guide also lists `metadata`. Replies 201, 400, 401, 403. | `D/api/invoices/01-create-invoice`, `D/docs/guides/invoices/creating-invoices.md` |
| Invoice object: `id` (uuid), `status` one of `initiated, paid, failed, refunded, canceled, on_hold, expired, voided`, `amount`, `currency`, `description`, `logo_url`, `amount_format`, `url` (the hosted checkout page), `callback_url`, `expired_at`, `created_at`, `updated_at`, `back_url`, `success_url`, `payments[]` (payment objects), `metadata`. | same |
| Fetch invoice `GET /invoices/:id` (200, 401, 403, 404). List invoices `GET /invoices` with `page`, `id`, `status`, `created[gt]`, `created[lt]`, `metadata[key]`; reply `{ invoices: [...], meta }`. Update `PUT /invoices/:id` (metadata). Cancel `PUT /invoices/:id/cancel` ("so it can no longer be paid"), reply the invoice. | `D/api/invoices/03-list-invoice`, `04-show-invoice`, `05-update-invoice`, `06-cancel-invoice` |
| Payment object: `id` (uuid), `status` one of `initiated, paid, authorized, failed, refunded, captured, voided, verified, expired`, `amount`, `fee` ("Estimated payment fee (including VAT)"), `currency`, `refunded` ("Refunded amount. Less than or equal to the payment amount"), `refunded_at`, `captured`, `captured_at`, `voided_at`, `description`, `amount_format`, `fee_format`, `refunded_format`, `captured_format`, `invoice_id`, `ip`, `callback_url`, `created_at`, `updated_at`, `metadata`, `source` (`type` one of `creditcard, applepay, samsungpay, stcpay, sadadbill`; `company` one of `mada, visa, master, amex, unionpay`; masked `number`; `message`; `transaction_url`; `gateway_id`; `reference_number`; more). No documented field states live or test on a payment or an invoice. | `D/api/payments/02-fetch-payment` |
| Payment statuses: `initiated` "created but the cardholder did not pay yet"; `paid` "when the cardholder pays successfully"; `failed`; `authorized` "the cardholder is not charged yet"; `captured`; `refunded` "when the merchant refunds a paid or captured payment successfully"; `voided`; `verified` (tokenization). | `D/docs/api/payments/payment-status-reference.md` |
| Fetch payment `GET /payments/:id`. List payments `GET /payments` with `page`, `id`, `status`, `created[gt\|lt]`, `updated[gt\|lt]`, `metadata[key]`, `card_last_digits`, `receipt_no`; reply `{ payments: [...], meta }`. | `D/api/payments/02-fetch-payment`, `03-list-payments` |
| Refund `POST /payments/:id/refund`, optional JSON `amount` ("less than or equal to the payment amount (or captured). If this field is missing, then the full amount will be refunded"); applies to `paid` or `captured`; "Refund amount cannot exceed the charged amount"; reply the payment object (200) or 400, 401, 403, 404. No refund object and no refund id is documented: the evidence of a refund is the payment's `refunded` total. | `D/api/payments/05-refund-payment`, `D/docs/guides/payment-operations/index.md` |
| Webhook object: `id` "The event's unique ID", `type`, `created_at`, `secret_token` "assigned by the consumer to secure the webhook", `account_name`, `live` "True if the payment is in live mode or false if it is in test mode", `data` (a payment for `payment_*` events). Event names as documented: `payment_paid`, `payment_faild` (spelled so), `payment_refunded`, `payment_voided`, `payment_authorized`, `payment_captured`, `payment_verified`. "Your endpoint must quickly return a successful status code (2xx)". Retries: 5 more times after the first, waits of 1 minute, 10 minutes, 30 minutes, 1 hour, 2 hours, then dropped. | `D/docs/api/other/webhooks/webhook-reference.md` |
| Registering a webhook in the dashboard: Endpoint (must be HTTPS), Secret Token ("a password you need to validate on your server"), HTTP Method, Events. | `D/docs/guides/dashboard/setting-up-webhooks.md` |

### What the wider research added or corrected

A read-only workflow (`wf_bdcb3007-35c`: five Sonnet researchers, each re-verified by an Opus agent against the raw pages) covered the same pages and the rest of the documentation, on the same date.

| Fact | Source |
|---|---|
| The failed-payment event is spelled `payment_faild` in the webhook reference and the dashboard guide and `payment_failed` in the API pages (`GET /v1/webhooks/available_events`, the create-webhook example), which also list `payment_abandoned`; the SADAD guide adds `payment_expired`; settlements add `balance_transferred` (aggregation accounts). | `D/docs/api/other/webhooks/available-webhooks.md`, `D/docs/guides/settlements/settlement-notification.md` |
| "Your `payment_paid` handler fulfils the order and is idempotent (webhooks can repeat)." Order between events is not documented. | `D/docs/guides/sadad-bill/testing.md` |
| The webhook secret is set as `shared_secret` (API) or «Secret Token» (dashboard) and delivered as `secret_token`. No header, no HMAC. | `D/docs/api/other/webhooks/create-webhook.md` |
| The invoice callback is documented only for the change from `initiated` to `paid`, and carries no `secret_token`: it is unauthenticated. No retry policy is documented for it. | `D/docs/guides/invoices/creating-invoices.md` |
| The API reference's create-invoice request schema omits `metadata`; the guide and the metadata page include it. A documentation conflict, to confirm in the sandbox. | `D/api/invoices/01-create-invoice`, `D/docs/api/metadata.md` |
| Error `type` strings differ between pages (`invalid_request_error` on the errors page; `invalid_request` and `record_not_found` in the endpoint schemas; 403 `api_error` "User not authorized"). `errors` is a map of field to a string or to an array of strings. | `D/docs/api/errors.md`, `D/api/payments/05-refund-payment` |
| Refund: "The payment status changes to `refunded`." Allowed from `paid` or `captured`. The reference marks the JSON body required while the guide says a full refund needs none. Whether a partial refund also sets `refunded`, and whether a second refund is accepted afterwards, is not documented. On a failed refund the guide says: fetch the payment; `refunded` means it already succeeded. | `D/docs/guides/payment-operations/index.md` |
| The go-live checklist: verify server-side before fulfilment, validating `status`, `amount` and `currency`. | `D/docs/getting-started/go-live-checklist.md` |
| No dispute or chargeback object, endpoint, webhook or payment status is documented. A chargeback shows only as settlement line types `chargeback` and `chargeback_penalty` (and in the settlement CSV); settlements come with an email carrying a CSV, a PDF and an invoice. | `D/api/settlements/03-list-settlement-lines`, `D/docs/guides/settlements/settlement-introduction.md` |

The full record of that research, with the accounts, keys and go-live notes, the sandbox test cards, Apple Pay, settlements and fees, and the list of what is **not** documented, is `artifacts/acceptance/P08/moyasar-docs-2026-10-02.md`.

### What the sandbox answered (2026-10-02)

Anas's test keys arrived on 2026-10-02 and one approved pass was run against the sandbox API: eight test invoices of 1.00 SAR were created, read, listed and cancelled (one expired by itself, and none is payable now); no payment was made. The full record is `artifacts/acceptance/P08/moyasar-sandbox-2026-10-02.md` and the script beside it. In short:

- The project's own client worked against `https://api.moyasar.com/v1` with only the base URL and the key changed.
- `metadata` on an invoice is accepted and kept, and the list filter returns only the matches, at once.
- `expired_at` as `toISOString()` writes it is accepted and echoed unchanged; a past time is refused (400); an invoice reads `expired` once the time has passed.
- A cancel of an `initiated` invoice answers 200 `canceled`; of a canceled or expired one, 400 `invalid_request_error`.
- A refused field answers 400 `validation_error` with `errors` as a map of field to messages; an unknown id answers 404 `record_not_found`.
- 100 halalas is accepted and 99 refused. The invoice object has exactly the documented keys, and nothing on it says live or test.
- `callback_url` and `success_url` on `http://localhost` are accepted at creation.
- 25 fetches in a row were all answered; no rate-limit header is sent.

The emulator was aligned to these answers. Everything that needs a payment, a public URL or a device is still open (E02).

## The local emulator

`tests/support/moyasar-emulator.ts` is a local stand-in for Moyasar. **It is a test harness that implements only the documented shapes above.** It proves how our code behaves against those shapes; it says nothing about how Moyasar really behaves where the documentation is silent. Those questions are answered only by the real sandbox run (E02), and no payment, refund or webhook it produces is real.

### Running it

```
pnpm emulator
```

- It is a plain Node HTTP server with no dependency, in memory (a restart, or `POST /__emulator/reset`, forgets everything). It needs Node 24, which runs the TypeScript file directly.
- It listens on `127.0.0.1:54390`, the port `pnpm db:env` writes into `supabase/functions/.env`. The Edge Functions reach it as `http://host.docker.internal:54390/v1` (`MOYASAR_API_BASE_URL`); a browser opens an invoice's `url`, `http://127.0.0.1:54390/invoices/<id>`. Every invoice `url` is built on that address, never on the `Host` header of the request.
- The secret key is `sk_test_local_emulator_key_not_for_production` and the webhook secret is `local-moyasar-webhook-secret-not-for-production`. Both are fixed local test values, not credentials, and `paymentsConfig()` refuses them on a hosted site.
- The webhook goes to `http://127.0.0.1:54321/functions/v1/payments/webhook`, the local stack's `payments` function.
- It refuses to start when `SITE_URL` in its environment names a hosted site.
- Tests start their own copies with `startEmulator(options)` (port `0` takes any free port) and call `close()` when they finish. Its tests are `tests/unit/moyasar-emulator.test.ts`; the client's, which run against it, are `tests/unit/moyasar-client.test.ts`.

### The Moyasar routes

Behind HTTP Basic auth: the secret key as the user name and an empty password; anything else answers 401 `authentication_error`. Replies and errors follow the tables above and what the sandbox answered on 2026-10-02 (`validation_error` with an `errors` map for a refused field, `invalid_request_error` with a sentence for an operation the object's state refuses, `record_not_found` for a 404).

| Route | Behaviour |
|---|---|
| `POST /v1/invoices` | Needs `amount` (an integer, at least 100), `currency` and `description`. Stores `metadata` and echoes `expired_at`; an `expired_at` that has already passed answers 400. `callback_url`, `success_url` and `back_url` must be on a local host. Answers 201. |
| `GET /v1/invoices/:id` | The invoice with its payments nested. An invoice past its `expired_at` reports `expired` and refuses payment. |
| `GET /v1/invoices` | 40 to a page, newest first, with `meta`. Filters `page`, `id`, `status` and `metadata[key]`. |
| `PUT /v1/invoices/:id/cancel` | An `initiated` invoice becomes `canceled`; a `canceled`, `expired` or `paid` one answers 400 "Cancel failed. The Invoice is already …" (see `cancelPaidReturns200` for a paid one). |
| `GET /v1/payments/:id`, `GET /v1/payments` | The documented payment object; the list has the same paging and the filters `page`, `id`, `status` and `metadata[key]`. |
| `POST /v1/payments/:id/refund` | Optional integer `amount` (none means the full amount). More than what is left answers 400. The status becomes `refunded` and `refunded` holds the running total (see the two refund switches). |

### The stand-in invoice page

`GET /invoices/:id` is the stand-in for the hosted checkout page: Arabic, right to left, and labelled «محاكي الدفع المحلي: لا يُخصم أي مبلغ». Its buttons are real form buttons named `action`:

- `pay` («دفع ناجح»): a `paid` payment, the webhook `payment_paid`, the invoice callback, then a redirect to the invoice's `success_url`.
- `fail` («دفع مرفوض»): a `failed` payment and the webhook `payment_failed`. The page stays, and the invoice can still be paid.
- `3ds` («دفع بتحقق 3-D Secure»): an `initiated` payment whose `source.transaction_url` is the challenge page, a second step with `approve` («موافقة», which pays like `pay`) and `reject` («رفض», which fails like `fail`).
- `back` («رجوع»): a redirect to the invoice's `back_url`.

An expired, canceled or paid invoice shows its state, offers only `back`, and answers 409 to any payment step. The webhook and the callback are delivered before the page answers, each with an 8 second timeout; a failed delivery is recorded and never retried (the emulator does not model Moyasar's retries).

### The control routes

Not Moyasar: the test harness. They and the stand-in page answer only loopback and private-network peers (others get 403), and only a request whose `Host` header names a local host (`localhost`, `127.0.0.1`, `[::1]` or `host.docker.internal`) and whose `Origin` header, when it has one, does too (others get 403), so a web page open in a browser, or a rebound DNS name, cannot drive them. Every POST to a control route must be sent with `content-type: application/json`, an empty body included (send `{}`); any other type, or none, answers 415, which also stops a cross-origin form post.

| Route | What it does |
|---|---|
| `POST /__emulator/pay` `{invoiceId, status, amount?, currency?, force?}` | Creates a payment with any documented status, as the page's buttons would, and sends the webhook and callback as configured. Like the page, it refuses (409, nothing created, nothing sent) an invoice that is not `initiated`, such as an expired, a canceled or an already paid one. `force: true` pays it anyway, for the late-payment and second-payment tests. |
| `POST /__emulator/payment` `{paymentId, status?, refunded?}` | Changes a payment as the dashboard would: a refund (a running total) or a void. Sends nothing. |
| `POST /__emulator/invoice` `{invoiceId, status?, expiredAt?}` | Sets an invoice's status and, or, its expiry. Sends nothing. |
| `POST /__emulator/webhook` `{paymentId?, type, secretToken?, live?, eventId?, times?}` | Sends one webhook event `times` times with the same event id. The payment may be one the emulator does not hold; then only its id is sent. |
| `POST /__emulator/fault` `{route, mode, times?, delayMs?}` | Makes the next `times` calls to a route fail in a chosen way (below). |
| `POST /__emulator/config` `{...}` | Sets switches (below) and answers the whole config; `{}` just reads it. A bad value changes nothing. |
| `GET /__emulator/state` | The invoices, the payments, the calls received, the deliveries made and the faults still pending, for assertions such as "one invoice per attempt". A call is recorded without any header, so never with the key. |
| `POST /__emulator/reset` | Forgets all of it and returns the config to what the emulator started with. |

### The switches

Where the documentation is silent or disagrees with itself, a switch picks the reading, so both can be tested. All are off unless said.

| Setting | Effect |
|---|---|
| `refuseSecondRefund` | A refund of a payment that is already `refunded` answers 400. |
| `partialRefundKeepsPaid` | A partial refund leaves the status as it was; only a refund of the whole amount makes it `refunded`. |
| `dropInvoiceMetadata` | An invoice keeps no metadata. |
| `ignoreMetadataFilter` | The invoice list ignores `metadata[key]` and returns every invoice. |
| `cancelPaidReturns200` | A cancel of a paid invoice answers 200 with status `paid` instead of 400. |
| `dropExpiredAt` | Invoice replies carry no `expired_at`; the invoice still expires. |
| `webhookUrl`, `webhookSecret` | Where the webhook goes (a local host only, or `null` for none) and the `secret_token` it carries. |
| `autoWebhook`, `autoCallback` | Whether a new payment sends the webhook and the invoice callback (both on by default; each still needs its URL). The callback goes only when the payment makes the invoice `paid`. |
| `live` | The webhook's `live` flag (false by default). |

### The faults

A fault names a route as it is written in the call log (`POST /v1/invoices`, `GET /v1/invoices`, `GET /v1/invoices/:id`, `PUT /v1/invoices/:id/cancel`, `GET /v1/payments`, `GET /v1/payments/:id`, `POST /v1/payments/:id/refund`) and a mode, and applies to the next `times` calls (one by default). A call with a wrong key is answered 401 and uses none up.

| Mode | What the caller sees | The change |
|---|---|---|
| `500` | 500 `api_error` | not made |
| `429` | 429 `rate_limit_error` | not made |
| `timeout` | no answer, until the caller gives up (or after a long delay) | not made |
| `drop_after_commit` | the connection is cut before the reply | made |
| `commit_after_delay` (`delayMs`) | the connection is cut at once | made `delayMs` later |

### What the emulator chooses where the documentation says nothing

These are harness choices, not facts about Moyasar; the runbook's sandbox list will say which of them the real sandbox confirmed.

- The invoice follows its payments in one case only, the one the callback page documents: a `paid` payment pays a payable invoice. What a failed payment or a refund makes of the invoice is not documented (E02 open item 6), so both leave it as it was: payable after a failure, `paid` after a refund. Anything else is set with `/__emulator/invoice`.
- A payment made through an invoice carries a copy of the invoice's metadata. `fee` and `captured` are 0, except that a `captured` payment is captured in full. `ip` is null.
- The webhook is sent only when a payment is created (the page, or `/__emulator/pay`) and by `/__emulator/webhook`; refunds, voids and the other control routes send none. The failed event is spelled `payment_failed`.
- An invoice that has `expired_at` in the past at creation is accepted and is `expired` at once.

The runs listed in [When the Moyasar keys arrive](#when-the-moyasar-keys-arrive) say which of these choices the real sandbox must confirm or refute.

## How a payment settles

An order is paid by one decision and one only: the SQL function `apply_verified_payment` (`supabase/migrations/20261002100000_payment_core.sql`). The Edge Functions call it with a payment and its invoice that they fetched themselves from Moyasar with the secret key. The webhook, the invoice callback and the buyer's return to the site are prompts to go and ask; none of them is believed. A forged redirect, a webhook with a wrong `secret_token`, a payment of another invoice, another amount or another currency, the other mode's key, a payment our key cannot fetch (another account's) and the statuses `initiated`, `authorized`, `verified`, `failed`, `voided` and `expired` all leave the order unpaid. Money is integer halalas throughout, with no tax (D34).

### The invoice step

`checkout`'s `create` (and `pay`, which the hold view calls for a retry or a reload) runs `startPayment` (`supabase/functions/_shared/payments.ts`):

1. `payment_attempt_begin` writes the attempt as `creating` before any network call, with the end of the order's 20-minute hold as the invoice's expiry. One attempt per order may be active (`creating`, `pending` or `uncertain`). It refuses a sixth attempt (`TOO_MANY_ATTEMPTS`), an order with less than 60 seconds of hold left (`HOLD_EXPIRED`), a total under 100 halalas, which is Moyasar's smallest amount (`TOTAL_BELOW_MINIMUM`), and an order that has an open review payment (`ORDER_NOT_PAYABLE` with the reason `UNDER_REVIEW`).
2. The function creates the invoice (`POST /invoices`): the amount, `SAR`, the description `طلب <order number>`, `callback_url` = `<FUNCTIONS_PUBLIC_URL>/payments/callback`, `success_url` and `back_url` = `<SITE_URL>/checkout/return?order=<order number>`, `expired_at` = the hold's end, and `metadata` = the order number and the attempt id. Nothing about the buyer goes to Moyasar. No SQL lock is held across the call, and it has one 10 second timeout (`MOYASAR_TIMEOUT_MS`).
3. A 201 makes the attempt `pending` (`payment_attempt_created`), and the hold view's «ادفع الآن» is a plain link to the invoice's hosted page. A 4xx or a 429 means nothing was created: the attempt is `failed`. A timeout, a 5xx or an unreadable 2xx may have created one: the attempt is `uncertain`, and the call is never repeated blindly (Moyasar documents no idempotency for invoices).
4. An `uncertain` attempt is resolved by listing Moyasar's invoices with `metadata[attempt_id]` (at most five pages) and checking each returned invoice's own metadata, amount and currency, because the filter itself is not trusted. Exactly one match is adopted and becomes `pending`. More than one raises the owner alert `attempt_duplicate_invoices` and waits for a person. None, once the attempt is older than 60 seconds, makes it `abandoned`, and the step begins again once. The reconciliation job does the same for an uncertain attempt nobody is waiting on. A late 201 for an attempt that has been closed meanwhile is cancelled at Moyasar and never shown to the buyer.

### The four prompts

- **The webhook**, `POST <FUNCTIONS_PUBLIC_URL>/payments/webhook`, sent by Moyasar. It is authenticated only by `secret_token` in the JSON body, compared in constant time with `MOYASAR_WEBHOOK_SECRET`: there is no header and no signature to verify, and none is invented. A wrong token answers 401 and a body without one answers 422; neither stores anything. Otherwise `payment_event_record` stores the event (`finance.payment_events`: its id, type, `live` flag, payment id and the sha256 of the body, never the body) before anything else, and if that fails the answer is 500 so that Moyasar retries. A repeated event id answers 200 and does nothing more (the job owns an event that was recorded and not finished). The type is stored and never trusted: a type that does not start with `payment_` closes the event as `ignored`, a missing or non-UUID payment id as `no_payment_id`, a `live` flag that is not the configured mode as `mode_mismatch`. Otherwise the payment is fetched and settled inline. A payment our key cannot see (404) closes the event as `unknown_payment`, a payment with no invoice as `no_invoice`. The answer is 200 whatever the settle did, and a settle that could not finish (a failed fetch) leaves the event for the job (`retry`). While payments are not configured the endpoint does not exist (404).
- **The invoice callback**, `POST <FUNCTIONS_PUBLIC_URL>/payments/callback`. Moyasar documents it only for the change to `paid`, with no secret and no retry policy, so it is unauthenticated. The function reads only the invoice `id` (a UUID, or nothing happens), takes 60 calls an hour per caller, always answers 200, and settles that invoice's attempt only when it is worth asking about and was not fetched in the last 5 seconds.
- **The return page**, `/checkout/return`, calls the `payments` function's `verify` at 0, 2, 4, 8, 15 and 30 seconds and then offers «تحديث» (120 calls an hour per caller). It reads the order number from the `order` query value (or from the tab's stored order) and nothing else from the address, and the answer is one of `paid`, `needs_resolution`, `refunded`, `pending`, `review`, `expired`, `cancelled` or `unknown`. An order already settled is never shown as `pending` because another attempt of it is still open.
- **The reconciliation job.** pg_cron runs `payments-reconcile` every minute (`public.payments_kick()`), which calls the `outbox` function with `{"job":"payments_reconcile"}` only when an attempt, a webhook event or an in-flight refund is due, and only when Vault holds `functions_url` and `jobs_secret` (the same two secrets as the email job). Without them nothing reconciles on its own: the webhook, the callback and the return page still settle what they are asked about. Locally the Vault values are unset, so the job is run by hand ([development](development.md#payments-locally-p08)).

`runPaymentsReconcile` leases what is due with `for update skip locked`: at most 10 attempts, 10 events and 5 in-flight refunds a run, each pushed two minutes ahead so that an overlapping run does not take it again. It first parks due work of the other mode (see "Mode checks"). It stops calling Moyasar for the rest of a run after one 429, stops taking rows after 60 seconds (the rest keep their lease), and records one `payments_reconcile` run in `finance.job_runs` with counts only (`attempts`, `events`, `refunds`, `settled`, `cancelled`, `errors`, `skipped`). For an attempt it adopts or abandons an uncertain creation, cancels a still-pending invoice of an order that another attempt already paid, or fetches the invoice and settles every charged payment it lists, oldest first. A row that throws is given a failed check, so it backs off and reaches the terminal rule.

Back-off and the end of the road: an attempt that was checked and answered is asked again after 1, 2, 4 … at most 30 minutes (`least(2^check_count, 30)`), one whose fetch failed after 1, 2, 4 … at most 60 minutes (`least(2^error_count, 60)`), an event after `least(2^attempts, 60)` minutes. At the tenth failed try an event is closed `exhausted` with the owner alert `event_exhausted`. A `pending` attempt whose invoice Moyasar calls `expired` or `canceled` more than 10 minutes after its expiry is closed as `expired` or `cancelled`. Twenty-four hours after its invoice expired nothing more is asked about an attempt, and one whose last check failed is marked `UNVERIFIED` with the owner alert `attempt_unverified`. An invoice Moyasar calls paid that nothing could settle (it lists no settleable payment) is a failed check, `INVOICE_PAID_UNSETTLED`, never a good one and never filed as expired.

### What the decision checks

`apply_verified_payment` decides in this order and answers one outcome:

| Outcome | When | What changes |
| --- | --- | --- |
| `rejected` | the payment's or the invoice's id is not the invoice asked about, or the payment's id already belongs to another attempt (`INVOICE_MISMATCH`), or the attempt's mode is not the configured one, or the webhook's `live` disagrees with it (`MODE_MISMATCH`) | nothing |
| `unknown_invoice` | no attempt has this invoice id | nothing, except that a charged payment becomes a review payment `UNMAPPED_INVOICE` and the owners are alerted |
| `not_paid` | the status is not charged (anything but `paid` and `refunded`) | the attempt's last fetched status and refunded total are noted |
| `already_paid` | the payment that already paid the attempt, again | nothing |
| `review` | a charged payment that cannot settle the order (see "Review payments") | one review payment row, one owner alert, the order untouched |
| `paid` | the first verified payment, every line deliverable | in one transaction: reservations committed, stock taken from physical and signed lines, the coupon use committed, the order and the attempt `paid`, one entitlement per digital item, one fulfilment (`preparing`) per physical or signed item, a receipt, and an alert for each variant that crossed its low-stock threshold |
| `paid_needs_resolution` | the first verified payment, but a line can no longer be delivered (the owner lowered the stock, or the hold expired and the copy went) | the money is recorded and nothing is committed, granted or taken; the owner alert `needs_resolution` and a receipt that says the payment arrived and the order is under review |

A payment is charged when its status is `paid`, or `refunded` (which Moyasar defines as a refund of a paid payment), for the attempt's full amount in `SAR`, on the invoice mapped to the attempt, and the invoice's own amount agrees. The captured amount is always the payment's `amount`, never its `captured` field; a payment whose status is `captured` is unexpected on a hosted invoice and goes to review. Calling the function again with the same facts changes nothing beyond noting the provider's status and refunded total.

### Late payments

A payment can reach an order after its hold ended, after the buyer cancelled, or after its attempt was closed, because a buyer can still complete a payment begun just before. An attempt that is `expired`, `cancelled`, `failed` or `abandoned` and has an invoice id still becomes `paid` when a verified payment arrives for that invoice, and an order that is `expired` or `cancelled` becomes `paid` or `paid_needs_resolution` the same way. A line whose own hold is still held needs only the units to exist; a line whose hold was released or has expired is acquired again by the full availability rule. So money that arrives when the copy is gone is `paid_needs_resolution`: never failed, never relabelled, and the owner decides («إكمال الطلب» or a refund). An attempt stays `pending` until the job closes it, at least 10 minutes after its invoice expired, so a payment made in the hold's last minute is never shown as expired; a closed attempt with an invoice id gets one last check after that.

### Review payments

Every charged payment that cannot settle an order is one row of `finance.payment_reviews`, keyed by Moyasar's payment id, with one reason: `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `UNEXPECTED_STATUS` (for instance `captured`), `SECOND_PAYMENT` (a second payment on an invoice already paid, or on an attempt already in review), `ORDER_ALREADY_PAID` (another attempt paid the order) or `UNMAPPED_INVOICE` (no attempt maps the invoice). It is never fulfilled and never counted in gross, and the owners get the alert `payment_review`. The order is not touched, and while a review payment is open its order cannot start a new invoice (`UNDER_REVIEW`). A review payment stays open until its confirmed refunds equal its amount or the owner closes it with a reason; either way it can still be refunded by its own payment id, and a refund of a review payment never moves its order or its entitlements.

### Mode checks

Test and live never mix. `paymentsConfig()` ties the key's prefix to `PAYMENTS_MODE`; every order and attempt carries the mode it was made in (`environment`); and every SQL entry point takes the configured mode and refuses work on an order or an attempt of the other one. The webhook's `live` must equal `PAYMENTS_MODE === 'live'`. A payment of the other mode should answer 404 to our key (to be confirmed with both keys: item 15 below). The buyer functions treat an order of the other mode as not found, so a sandbox order's link shows nothing, issues no download, files no return and is never mailed a link once the site is live. The reconciliation claim parks due rows of the other mode (`MODE_CHANGED`): an active attempt becomes `expired`, an in-flight refund stays for a person to settle at Moyasar, and its events are closed `mode_mismatch`. The staff functions take no mode: orders of both modes are listed, and a test order is labelled «تجريبي», so a leftover sandbox order is never hidden from the owner (see "Before live").

### Who may move what

| What moves | Who may move it | By |
| --- | --- | --- |
| An order becomes `pending_payment` | the buyer's `create` | `checkout_create` |
| `pending_payment` becomes `cancelled` | the buyer, with the order's token: at once when no attempt is active, and when the attempt is `pending` once the function has cancelled its invoice at Moyasar and found no charged payment on it (`paid`, `refunded` or `captured`; a charged payment found is settled instead) | `checkout_cancel`, after `cancelInvoice` and `payment_attempt_close` |
| `pending_payment` becomes `expired` | the clock | `finance.checkout_expire`, every minute |
| `pending_payment`, `expired` or `cancelled` becomes `paid` or `paid_needs_resolution` | a fetched, verified payment, reached from any of the four prompts or the owner's «أعد الفحص» | `apply_verified_payment`, only |
| `paid_needs_resolution` becomes `paid` | the owner, «إكمال الطلب» | `order_resolve` |
| `paid` or `paid_needs_resolution` becomes `refunded` | a refund that Moyasar's refunded total confirms | `refund_result`, `refund_settle`, `refund_record_external` |
| An attempt's status | the invoice step, the buyer's cancel, the job and `apply_verified_payment`; nothing moves an attempt out of `paid` or `review` | `payment_attempt_*`, `payment_attempt_checked` |
| A fulfilment: `preparing`, `shipped`, `delivered` | the owner or operations, one step at a time | `fulfillment_update` |
| A return: approved, rejected, received | the owner or operations (only the owner puts stock back); `refunded` follows a successful linked refund | `return_decide`, `return_receive` |
| A refund or a dispute row | the owner, with a TOTP verified in the last five minutes | `refund-create`, `refund-record-external`, `dispute-record` |

The buyer's browser, the webhook, the callback and the return page move nothing themselves: they only prompt a fetch.

## Refunds

A refund is the owner's act and is built around one fact: Moyasar documents no refund id, so the only evidence of a refund is the payment's own `refunded` total, which rises by the amount refunded. Everything below follows from that.

1. In the order view the owner presses «إعادة المبلغ», enters an amount for each line and for the shipping (each at most what is left of it), a reason and, optionally, «ربط بطلب الإرجاع» to link a received return, and confirms with «تأكيد الاسترداد» (the screen repeats the total and says it cannot be undone). The `admin` function needs a TOTP verification from the last five minutes (`STEP_UP_REQUIRED`, and the screen opens its step-up dialog and sends the same request again). The request carries one idempotency key, kept for the same body across the step-up and across a retry after an answer the screen could not read.
2. `refund-create` fetches the payment from Moyasar first. If that fails it answers 503 `PROVIDER_UNAVAILABLE` and writes nothing.
3. `refund_request` takes the locks and reserves the balance in one step. It checks that the target is a `paid` attempt (or a review payment not closed as refunded) and that no refund of it is in flight (`REFUND_IN_FLIGHT`: a unique index allows one in flight per payment). It checks that the fetched total equals the ledger's confirmed refunds (`PROVIDER_AHEAD` when Moyasar holds a refund the ledger does not, so the owner records that first; `PROVIDER_BEHIND` when it holds less), that confirmed plus the new amount does not exceed what was captured (`EXCEEDS_BALANCE`), and that the allocation is valid (`INVALID_ALLOCATION`: the items plus the shipping equal the amount, none above its line or its shipping; `{}` for a review payment). It then writes the refund as `submitting` with the fetched total as `provider_refunded_before`. The same key with the same body answers the stored refund and never reaches Moyasar again; the same key with another body is `IDEMPOTENCY_CONFLICT`.
4. Only a new refund goes on: `POST /payments/<id>/refund` with `{"amount": <halalas>}`. The amount is always sent, because a refund with none would refund everything. No SQL lock is held across the call.
5. `refund_result` records what came back. `succeeded` is accepted only when the reply's `refunded` equals `provider_refunded_before` plus the amount; any other total makes the refund `uncertain`. A 4xx is `failed`: nothing moved and the balance is free again. A timeout, a 5xx, a 429 or an unreadable reply is `uncertain`: it may have happened.
6. A success revokes the entitlements of every item whose refunded total is above zero and equals what the item cost (and of all items when the attempt is fully refunded), releases the preorder reservations of those items, makes the order `refunded` when the confirmed refunds equal the captured amount (a partial refund leaves the status as it is), marks a linked return `refunded` and queues the `order_refunded` mail. **A refund never touches stock.** Goods come back on sale only through a received return or by the owner editing the stock (see "Returns" in [operations](operations.md#returns-and-the-restock-rule)).

### How an unfinished refund ends

The job (the first check is due one minute after the request) and the owner's «أعد الفحص» fetch the payment again and call `refund_settle`. It compares the fetched total with `provider_refunded_before` plus the amount (the target), and with `provider_refunded_origin`, the total the payment had when the refund was requested, which never changes:

| The fetched total | What happens |
| --- | --- |
| at least the target | the refund succeeded (step 6); any surplus above the target is recorded in the same transaction as one more `succeeded` refund with `source = 'provider_dashboard'`, unallocated |
| from `before` up to the target | the refund has not landed yet. Anything above `before` is a refund made in Moyasar's dashboard while ours was in flight: it is recorded as a dashboard refund and `before` moves up to the fetched total. Then the 15-minute rule: younger than 15 minutes, the refund only backs off (1, 2, 4, 8 minutes, never past the 15th); older, it becomes `failed` with `NOT_APPLIED` |
| below `before`, not below the origin | a read made before a dashboard refund that has since been recorded: it decides nothing, and the refund is looked at again in a minute |
| below the origin | the provider's total went down, which the documentation does not allow: the refund is `failed` (`PROVIDER_TOTAL_DECREASED`) and the owners get the alert `refund_total_decreased` |

The 15 minutes run from the refund's creation, because our own call is made within seconds of it and bounded by the 10 second timeout, and a dashboard refund in between says nothing about that call. So every fresh read ends the refund within 15 minutes of its creation. A fetch that fails is `refund_checked`: it backs off 1, 2, 4 … 60 minutes, and a refund in flight for more than 24 hours stops being scheduled, raises the owner alert `refund_unverified` and waits for the owner's «أعد الفحص». A refund closed `NOT_APPLIED` that lands at Moyasar later is caught by the next `refund_request` (`PROVIDER_AHEAD`) and adopted by «تسجيل استرداد خارجي». If our own call reports success for a refund the ledger had already closed as failed, the owners get the alert `refund_mismatch`.

### Refunds and voids made in Moyasar's dashboard

The ledger must equal the provider. When a payment's total at Moyasar is above the ledger's confirmed plus in-flight refunds, a webhook or a check raises the owner alert `external_refund`, and a status that is neither `paid` nor `refunded` (a void, for instance) raises `provider_status`. The owner records either with «تسجيل استرداد خارجي» (`refund-record-external`: owner, fresh TOTP, a reason). The function fetches the payment and records the difference as one `succeeded` refund with `source = 'provider_dashboard'`; a void records the whole unrefunded amount. It needs no refund of the target in flight and a positive difference (`NO_DELTA` otherwise). A difference equal to the amount of the target's latest `NOT_APPLIED` refund reopens that refund as `succeeded` with its own allocation, as long as the allocation still fits; otherwise the refund is unallocated, because the ledger cannot know which item a refund made outside the admin was for, and a full unallocated refund revokes every entitlement. The audit rows are `refund.external` (and `refund.late_applied` for a reopened one).

## Disputes and payouts

Moyasar's API shows no dispute, chargeback or payout difference: no object, endpoint, webhook or payment status (read 2026-10-02). A chargeback appears only in the emails Moyasar sends and in its settlement files (a CSV, a PDF and an invoice for each settlement; the settlement line types `chargeback` and `chargeback_penalty`). So the owner records them by hand from those files, in the order view or on the reconciliation screen, and nothing in the system reads or guesses them.

- «تسجيل اعتراض» records a dispute about one payment (a chargeback or another kind) on a paid attempt or a review payment. «تسجيل فرق» records a payout or a fee difference, which needs no payment. «إضافة متابعة» adds the next row of an existing reference, such as the outcome, later. `dispute-record` needs the owner and a TOTP verified in the last five minutes.
- A row holds the kind (`chargeback`, `payout_difference`, `fee_difference` or `other`), Moyasar's reference as typed from the email or the file, an amount in halalas, the direction (`against_seller` or `for_seller`), the day it happened (not in the future, Riyadh time), the reason, an optional resolution and a decision: `none`, `entitlement_revoked` (the named items' downloads stop, through the same function a refund uses), `entitlement_kept`, or `fulfillment_stopped` (named items still being prepared; recorded only).
- Rows are append-only per reference. `(kind, provider_ref, seq)` is unique and a trigger (`disputes_immutable`) refuses any update or delete by anyone; the latest row of a reference is its current state, and a correction is a new row. Recording the same row again answers the stored one (200, `duplicate: true`) and changes nothing, so a repeated reconciliation never double-counts.
- It never creates a refund, never changes the attempt or the order and never calls Moyasar. If money is to be returned, refund it separately.
- Refusals: `NOT_FOUND` (an unknown target, or one of the other mode), `NOT_DISPUTABLE` (an attempt that is not `paid`), `NO_PREDECESSOR`, `TARGET_MISMATCH` (a follow-up must name the payment its first row named), `INVALID_ITEMS`, and `REFERENCE_IN_USE` (the reference exists in the other mode).
- The statistics screen shows the latest row of each reference whose day falls in the range, with the amounts against and for the seller, beside the money figures: disputes are in neither the total paid nor the net.

## Switching from the emulator to the real sandbox, then to live

It is configuration only. Nothing in the code changes between the emulator, the sandbox and live: the same client runs with another base address, another key and a public address Moyasar can reach.

### The settings (names only)

The Edge Function secrets are set with `supabase secrets set` on the hosted project and live in `supabase/functions/.env` locally. A value never goes into a document, a chat, a commit or a log.

| Name | Meaning |
| --- | --- |
| `MOYASAR_API_BASE_URL` | The API base without a trailing slash: `https://api.moyasar.com/v1` for the sandbox and for live; the local emulator is `http://host.docker.internal:54390/v1`. No default. |
| `MOYASAR_SECRET_KEY` | The secret API key, `sk_test_…` or `sk_live_…`, sent as the HTTP Basic user name with an empty password. |
| `MOYASAR_WEBHOOK_SECRET` | The Secret Token typed on the webhook in Moyasar's dashboard, which comes back as `secret_token` in every webhook body. At least 32 characters. |
| `PAYMENTS_MODE` | `test` or `live`. |
| `FUNCTIONS_PUBLIC_URL` | The Edge Functions' public base as Moyasar and the browser reach it, with no trailing slash: `https://<project-ref>.supabase.co/functions/v1` (locally `http://127.0.0.1:54321/functions/v1`). Every address handed to Moyasar or to a browser is built on it. |
| `PAYMENTS_TEST_ACCESS_CODE` | Only for a hosted site in test mode: at least 16 characters (the sandbox fence, below). |

`SITE_URL`, `TOKEN_HASH_PEPPER`, `JOBS_SECRET`, `TURNSTILE_SECRET_KEY` and the `EMAIL_*` values are the ones the earlier packages use, and payments reuse them. `.env.example` lists every name with a comment.

`paymentsConfig()` (`supabase/functions/_shared/payments/moyasar.ts`) is the only reader of these. It never throws and never logs a value; a bad combination is a reason code, and every payment endpoint, the checkout switch and the settings screen follow it:

- the first five unset is `NOT_CONFIGURED`; a mode that is not `test` or `live` is `BAD_MODE`; a key whose prefix is not the mode's (`sk_test_` for `test`, `sk_live_` for `live`) is `KEY_MODE_MISMATCH`; a webhook secret under 32 characters is `WEAK_WEBHOOK_SECRET`; an address that does not parse or ends with a slash is `BAD_BASE_URL` or `BAD_CALLBACK_BASE`;
- on a local site `live` is refused (`LIVE_ON_LOCAL`), and the base is either a local host over http (the emulator) or exactly `https://api.moyasar.com/v1`, in which case `FUNCTIONS_PUBLIC_URL` must be a public `https:` address (a tunnel);
- on a hosted site the base must be exactly `https://api.moyasar.com/v1` (the key is never sent anywhere else), `FUNCTIONS_PUBLIC_URL` must be a public `https:` address, the two local emulator strings are refused (`EMULATOR_ON_HOSTED`), and in test mode `PAYMENTS_TEST_ACCESS_CODE` must be set (`TEST_CODE_REQUIRED`).

While `paymentsConfig()` is not ok, `quote` offers no checkout, `create` refuses (503 `CHECKOUT_DISABLED`), the webhook and the callback do not exist (404), the return page's verify answers 503, the owner cannot switch checkout on, and the reconciliation job records itself `skipped` with `PAYMENTS_NOT_CONFIGURED`. The «الشراء» box of the settings screen says which state it is in: «الدفع غير مضبوط», «الدفع مضبوط: وضع تجريبي، محاكٍ محلي», «الدفع مضبوط: وضع تجريبي» or «الدفع مضبوط: وضع حي».

### The three steps

1. **The emulator, the default locally.** `pnpm db:env` writes the five local values ([development](development.md#payments-locally-p08)). Nothing leaves the machine.
2. **The real sandbox.** `MOYASAR_API_BASE_URL=https://api.moyasar.com/v1`, the sandbox `sk_test_…` key, the webhook secret, `PAYMENTS_MODE=test` and a public HTTPS `FUNCTIONS_PUBLIC_URL`: the hosted functions, or a tunnel to the local ones for a run from a local stack. On a hosted site add `PAYMENTS_TEST_ACCESS_CODE`. In Moyasar's dashboard register a webhook: Endpoint `<FUNCTIONS_PUBLIC_URL>/payments/webhook` (it must be HTTPS), Secret Token the same value as `MOYASAR_WEBHOOK_SECRET`, HTTP Method POST, every payment event. The code accepts any event type and never branches on its spelling, which matters because Moyasar's own pages spell the failed event both `payment_faild` and `payment_failed`. Whether the dashboard keeps separate webhook lists for the test and the live account is not in the pages read: record what it shows at the first run.
3. **Live.** `sk_live_…`, `PAYMENTS_MODE=live` on the hosted site only, the live webhook registered the same way, and `PAYMENTS_TEST_ACCESS_CODE` removed (it exists for test mode only). A live key on an account that is not activated answers 405 `account_inactive_error`.

`pnpm check:export` fails a built export that holds any `sk_test_` or `sk_live_` key shape or either of the two local emulator strings, so a build can never carry them.

### The sandbox fence

Moyasar's test cards are public, so a hosted site in test mode would hand real files and real stock to anyone who found a card number. In that configuration (a hosted `SITE_URL` and `PAYMENTS_MODE=test`) `quote` answers `checkoutEnabled: false` unless the request carries `testAccess` equal to `PAYMENTS_TEST_ACCESS_CODE` (compared in constant time), and `create` and `pay` refuse without it (`CHECKOUT_DISABLED`). A tester opens any store page with `#test=<code>` at the end of the address: the page reads the fragment once into the tab's `sessionStorage`, removes it from the address bar and sends it with `quote`, `create` and `pay` (a fragment never reaches a server log). Every quote carries `testMode`, and then the hold view, the return page and the order page show «وضع تجريبي: لا يُخصم أي مبلغ حقيقي»; mail about a test order has «(تجريبي)» in its subject. In live mode there is no fence: the checkout switch decides.

### The switch

`finance.commerce_settings.checkout_enabled` is false on every database the migrations create. The owner turns it on in the settings screen («افتح الشراء», with a fresh TOTP). The `admin` function refuses while `paymentsConfig()` is not ok (`PAYMENTS_NOT_CONFIGURED`) and the SQL refuses while the seller is not named or the policies are not approved (`NOT_READY`), so it cannot be turned on for a project without working keys. It gates new orders only: an order that already exists can still be paid, cancelled and settled after the switch is turned off or the policy approval is reset. See [operations](operations.md#the-checkout-switch).

### Before live

Going live needs Anas's word and the account's activation; nothing in this file authorizes a live charge.

- Settle or ignore every sandbox order, and read the stock. The staff functions take no mode, so on a live site a leftover sandbox order can still be shipped (a real mail to the tester) or resolved (real stock).
- The availability sweep tells confirmed subscribers when an item is back, but only while checkout is switched on. During sandbox runs on a hosted site the switch is on while only holders of the access code can buy, so a restock then would tell real subscribers: restock after the sandbox runs, or leave that variant unpublished or disabled until then (which also hides it from the shop).
- E03 must be closed first: Anas's own prices, stock, city rates, services and approved policies, entered in the admin in place of the demo catalog (D37). The sandbox runs do not close it.
- Remove `PAYMENTS_TEST_ACCESS_CODE`, set the live secrets and register the live webhook, as in step 3.

## When the Moyasar keys arrive

**Where things stand.** Anas's test keys arrived on 2026-10-02 and are held in the git-ignored `.env`; one owner-approved sandbox pass was run with them (it created, read, listed and cancelled eight test invoices, no payment: "What the sandbox answered"). No live key exists, and E02 and E03 are open. Everything the system does with a payment has been proven only against the emulator, which is a harness that implements the documented shapes and says nothing about how Moyasar behaves where the documentation is silent. The runs below are those questions put to the real sandbox. They are supervised: they need the webhook secret set in the dashboard, a public functions URL for the webhook and the callback, and, on a hosted site, the sandbox access code.

### What Anas brings

1. **The secret key of each mode.** `sk_test_…` is already here; `sk_live_…` appears only after activation. A secret key is shown once in the dashboard (a lost one is regenerated), and it reaches the functions only through the secret named `MOYASAR_SECRET_KEY`, never through a document or a chat.
2. **The webhook secret.** A password he chooses, at least 32 characters, typed as the Secret Token of the webhook in the dashboard. The identical value is set as `MOYASAR_WEBHOOK_SECRET`.
3. **The account's activation for live.** Moyasar's FAQ (read 2026-10-02: `https://moyasar.com/en/resources/faqs/`) says activation needs a Saudi commercial registration or a freelance licence and a linked Saudi bank account, that it can start before the site is live, and that Moyasar reviews what is sold, the pricing, the refund policy and the contact channels. Until it is done a live key answers 405 `account_inactive_error`. Whether the account is activated is known only from the dashboard; nothing here claims it.
4. **A public HTTPS address for the functions** while the runs last: the hosted `<project-ref>.supabase.co/functions/v1`, or a tunnel to the local stack. It is both `FUNCTIONS_PUBLIC_URL` and the webhook's address.
5. **On a hosted site, the access code** (`PAYMENTS_TEST_ACCESS_CODE`, 16 characters or more) that he or the developer chooses and gives only to the testers.
6. **The publishable key (`pk_test_…`, `pk_live_…`): not needed.** Nothing in this repository uses it: an invoice is paid on Moyasar's hosted page, and the site loads no Moyasar script. Only a later page that embeds Moyasar's own payment form would need it, and that would be new work and a new decision.
7. **For Apple Pay, a supported Apple device** (Moyasar's page says it needs the T1 security chip) with a real card in its wallet: the sandbox has no Apple Pay test cards, and the amount decides the outcome (approved between 20,000 and 30,000 halalas, other ranges decline with specific codes, any other amount fails; `D/docs/guides/apple-pay/testing.md`). The test cards for the other runs are in `artifacts/acceptance/P08/moyasar-docs-2026-10-02.md`, from Moyasar's own page.

### The sandbox runs E02 needs

Each run goes through the real pages and the real functions of a site whose functions Moyasar can reach. After each, read the order in `/admin/orders` (the attempt's evidence is on the order view) and record what is asked. The record is a dated file under `artifacts/acceptance/P08/` in the style of `moyasar-sandbox-2026-10-02.md`, with the script or the steps beside it. That folder is committed, so a record holds the fields named here and nothing else:

- **Record fields, never whole objects.** Of a payment: `status`, `amount`, `currency`, `captured`, `fee`, `refunded`, whether `invoice_id` is present, `source.type`, `source.company` and the object's key names. Of an invoice: `status`, `amount`, `currency`, the format of `expired_at` when it is echoed, the key names and the `status` of each entry of `payments`. Of a webhook event: `type`, `live`, whether `account_name` is present, the time it arrived and the body's key names. Of the callback: its time and the body's key names. Of the redirect: the address's parameter names and whether our own `order` is still among them. A test card may be named when it is one of the public cards on Moyasar's own page.
- **Never copy** `ip`, `source.number` (masked or not), a cardholder name, `source.message`, `source.transaction_url`, `source.gateway_id`, `source.reference_number`, any name, email, phone or address of a person, or any key or secret; and never a screenshot that shows a card number, a card in a wallet or a payer's name. Where a message matters (a declined card), record whether it was present and what the buyer saw, in words.
- **Write every id redacted**, as E02 requires: payment, invoice, event and any refund id become `payment-1`, `invoice-1`, `event-1`, `refund-1`, the same label for the same id within a record, never the value Moyasar returned. A question that needs two ids compared (item 9: does a retry reuse the event id) is answered by whether they are equal, yes or no.

| Run | What to do | What to record |
| --- | --- | --- |
| 1. A book purchase | Buy a digital book with an approved test card. Check the return page, the receipt mail, the order page and the download. | The payment's and the invoice's fields as listed above (for the payment `status`, `amount`, `currency`, `captured`, `fee`, `refunded`, whether `invoice_id` is present, `source.type`, `source.company`, the key names), each webhook event's `type`, `live`, whether `account_name` is present and arrival time, the callback's time and body key names, the redirect address's parameter names and whether our own `order` survives in it, and whether the fetched invoice lists the payment, with its status. Answers items 3, 7, 9, 10, 14. |
| 2. A non-book purchase | Buy a paper or signed edition with a delivery fee. | The same, and that the invoice amount equals the order total including the fee, that stock fell by the quantity and that a fulfilment exists. |
| 3. A failed payment | Pay with a declined test card, then, on the same invoice, with an approved one. | The payment's `status`, whether `source.message` is present (never its text), the webhook's `type` and spelling, the invoice's `status` after the failure, whether the invoice page still takes a card, what the buyer sees, in words. Answers item 6 and the failed event's name (item 9). |
| 4. 3-D Secure | Pay with a 3-D Secure card and approve; again and reject; once more, begin the challenge, wait past the hold's end (20 minutes), then approve. | The challenge page in words (no screenshot that shows a card number), the payment's statuses along the way, the events' `type`, and the last case's final payment and invoice statuses (the rest of item 4): a payment that completes after the hold must land as `paid` or `paid_needs_resolution`, never be lost. |
| 5. A cancelled checkout | Press «إلغاء الطلب» on a pending invoice; separately press the hosted page's back button. | The cancel reply's status code and the invoice's `status`, and the parameter names of the address `back_url` redirected to (item 3). For the rest of item 5, the status code and invoice `status` of the cancel reply for an invoice that is already paid, sent with the sandbox key outside the site (the probe script's client). |
| 6. A refund | Refund a paid order in full; on another, refund part, then part again. | Every refund reply (status code, `status`, `refunded`), the payment's `status` after each, whether a second partial refund is accepted and whether a body is required (item 8), the `payment_refunded` webhook's `type`, and that the ledger equals the payment's `refunded`. |
| 7. Apple Pay | On a supported device, open an invoice and pay with Apple Pay. | Whether the hosted page offers it, whether Moyasar asks for anything from our domain, the payment's `source.type` and `source.company` (item 13). Nothing of the card in the wallet goes in the record, not even its last digits. The page's source names `applepay`, `mada` and `samsung`, not `stcpay`. |
| 8. The dashboard | Refund one paid test payment from Moyasar's dashboard and void another. | The resulting payment and invoice statuses and the events' `type` (item 11); that the `external_refund` and `provider_status` alerts arrive and that «تسجيل استرداد خارجي» records each. |

### The questions still open

Contract section 2 lists the open items; each is named here with the question it answers. Items 1, 2 and most of 4, 5, 12 and 14 were answered by the pass of 2026-10-02 and are in "What the sandbox answered".

| Item | The question | Run | Why it matters |
| --- | --- | --- | --- |
| 3 | What does Moyasar append to `success_url` and `back_url`, and does our own `?order=<number>` survive? | 1, 5 | The return page reads only `order`, and works from the tab's stored order when it is lost; the answer says how often it is there. |
| 4, rest | Can a 3-D Secure payment begun before `expired_at` (or before a cancel) still complete afterwards, and what does the invoice read then? | 4 | A late completion is a late payment: the rules above handle it, the sandbox says whether it happens. |
| 5, rest | What does a cancel answer for a paid invoice, and for one whose payment is in 3-D Secure? | 5 | `checkout_cancel` and the job settle a payment listed in a `canceled` reply instead of closing the order on it. The emulator's `cancelPaidReturns200` is the other reading. |
| 6 | What is an invoice's status after a failed payment (payable again?), after a refund and after a partial one; what do `failed`, `on_hold` and `voided` mean on an invoice; does a paid invoice take a second payment? | 3, 6 | The emulator leaves it payable after a failure and `paid` after a refund (harness choices). The review reason `SECOND_PAYMENT` assumes a second payment is possible. |
| 7 | What are `captured` and `fee` on an ordinary paid payment? | 1, 2 | The ledger keeps `fee` (an estimate) and uses `amount` as the captured amount; a `captured` status goes to review. The emulator sends 0 for both. |
| 8 | Does the refund reply already carry the new `refunded` total? What is the status after a partial refund? Is a second partial refund accepted? Is a body required? | 6 | `refund_result` accepts success only when `refunded` rose by exactly the amount; `partialRefundKeepsPaid` and `refuseSecondRefund` are the two readings. |
| 9 | Does a webhook retry reuse the event id? What is the delivery timeout? What are `live` and `account_name` in test? Which events fire, and how is the failed one spelled? | 1 to 6; one run with the endpoint unreachable | Idempotency is on the event id; record only whether the ids of the first delivery and of the retry are equal, never the ids. To see a retry, an untested plan: stop the endpoint (the tunnel) during a payment and watch for the retry after about a minute, the documented first wait. Nothing here has tried it, so adapt it when the run starts. The emulator sends `live` false and `payment_failed`, and no retries. |
| 10 | When does the invoice callback arrive, with what body, and is it retried? | 1, 3 | It is only a prompt: the webhook, the return page and the job settle without it. |
| 11 | What do a void and a refund made in the dashboard do to the payment, the invoice and the events? | 8 | They drive the alerts `external_refund` and `provider_status` and the recording of a void as the whole unrefunded amount. |
| 12 | At what rate does Moyasar answer 429? | every run | 25 fetches in a row were all answered and no rate-limit header exists. The job takes at most 25 rows a minute, each needing one to a few fetches. Record any 429 and the rate that caused it. |
| 13 | Does the hosted page offer Apple Pay on a supported device, and what does the 3-D Secure page look like? | 7, 4 | Not stated by any page read. |
| 14, rest | With a paid invoice, does `GET /invoices/:id` list its payments with their ids and statuses? | 1 | The callback, the return page and the job settle from that list; only the webhook settles by payment id. If it is empty on a paid invoice, those three cannot settle and each paid invoice ends as the failed check `INVOICE_PAID_UNSETTLED` unless the webhook arrives. This is the most consequential open answer. |
| 15 | Does a payment id of one mode answer 404 to the other mode's key? | at go-live, with both keys | A review payment's refund and the owner's recheck of a refund rely on the key's scope for the mode. Needs the live key, so it is a go-live check, not a sandbox run. The contract's "still open" sentence leaves it out. |

Nothing here closes E02 or E03, and passing tests against the emulator never closes either. E02 stays open until these runs are recorded together with the rest of the evidence E02 names in `PLANS/DECISIONS.md`: the account's test and live state, its enabled methods, the redacted transaction and refund ids, and the Apple Pay proof on a supported device. E03 is a separate gate, Anas's own values: his prices, stock, city rates, services and approved policies replace the demo catalog (D37). No sandbox run closes it.
