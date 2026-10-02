# Payments runbook (P08)

**Status.** P08, the verified gateway and the post-sale operations, is being built against the local Moyasar emulator (`tests/support/moyasar-emulator.ts`). The E02 and E03 gates are open. No call has been made to Moyasar from this repository, and no real payment, refund or webhook has happened; nothing below claims otherwise. Later rounds of P08 extend this file with the keys, the go-live steps, refunds, reconciliation and what to do when something sticks. This first part holds the sources and the local emulator.

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

Anas's test keys arrived on 2026-10-02 and one approved pass was run against the sandbox API: test invoices were created, read, listed and cancelled; no payment was made. The full record is `artifacts/acceptance/P08/moyasar-sandbox-2026-10-02.md` and the script beside it. In short:

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
