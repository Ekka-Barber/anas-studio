# Moyasar sandbox: what the API answered (2026-10-02)

Anas's Moyasar **test** keys arrived on 2026-10-02 and the owner approved one pass against the sandbox API from the development machine. This file records what the API answered. It closes no gate: no payment was made, nothing was refunded, no webhook was received, and E02 and E03 stay open.

- Script: `artifacts/acceptance/P08/moyasar-sandbox-probe.mjs` (run as `node --env-file=.env <script> <out.json>`; the key is read from the environment and is never printed or written).
- Run: 2026-10-02 12:04:47 to 12:05:22 UTC, 60 calls to `https://api.moyasar.com/v1`, test key (`sk_test_`).
- It created eight test invoices of 1.00 SAR, read, listed and cancelled them. One expired by itself. None is payable afterwards.
- The calls marked "client" went through the project's own `moyasarClient` (`supabase/functions/_shared/payments/moyasar.ts`) with only the base URL and the key changed: the switch from the emulator to the sandbox was configuration only for every call made here.

## Answers

| # | Question (contract section 2) | Answer from the sandbox |
|---|---|---|
| 1 | Create-invoice with `metadata` | **Accepted** (201) through the client with the production shape (`amount`, `currency`, `description`, `callback_url`, `success_url`, `back_url`, `expired_at`, `metadata {order_number, attempt_id}`). The metadata is kept as sent. `GET /invoices?metadata[attempt_id]=<id>` returned exactly the one matching invoice, 215 ms after the create's reply; a value no invoice has returned none (`total_count: 0`). An invoice made without metadata answers `metadata: null`. A numeric metadata value is kept as a number (the client reads string values only). |
| 2 | Must `callback_url` and `success_url` be HTTPS or public? | **No, not at creation**: `http://localhost…` was accepted for `callback_url`, `success_url` and `back_url` and echoed. Whether Moyasar then delivers a callback to such an address was not tested (no payment). |
| 4 | `expired_at` | `2026-10-02T12:24:48.108Z` (what `toISOString()` writes) is accepted and **echoed unchanged**. An offset form (`…+03:00`, no fraction) is accepted and echoed as UTC with `.000Z`. A time in the past answers 400 `validation_error` (`errors.expired_at: ["The value must be greater than or equal to <now> +0000."]`). An expiry 15 seconds ahead is accepted. Not sent → `expired_at: null`. An invoice read 22 seconds after such an expiry has status **`expired`**. A payment begun before the expiry was not tested. |
| 5 | The cancel reply | An `initiated` invoice: 200, the invoice with status **`canceled`**, `payments: []`. An **already canceled** invoice: **400** `invalid_request_error`, "Cancel failed. The Invoice is already canceled." An **expired** invoice: **400** `invalid_request_error`, "Cancel failed. The Invoice is already expired." A paid invoice was not tested. |
| 12 | The 429 threshold | 25 `GET /invoices/:id` in a row (5.3 s) all answered 200. No rate-limit header is sent (only `x-request-id`). The threshold itself is still unknown; the job's 25 fetches a minute are under it. |
| 13 | Apple Pay on the hosted page | The hosted page is `https://checkout.moyasar.com/invoices/<id>`, a small HTML shell (4.9 KB) whose source names `applepay`, `mada` and `samsung`; `stcpay` is not named. Whether the Apple Pay button shows needs a supported device and the account's activation: not tested. A canceled invoice's page still answers 200. |
| 14 | Does `GET /invoices/:id` list the payments? | The key `payments` is present on create, fetch and cancel replies, an empty array on an unpaid invoice. With a paid invoice (ids and statuses) it is still to be confirmed. |

Also observed:

- The invoice object's keys are exactly the documented ones: `id, status, amount, currency, description, logo_url, amount_format, url, callback_url, expired_at, created_at, updated_at, back_url, success_url, metadata, payments`. Nothing on it states live or test, as the documentation implied. `amount_format` is `"1.00 SAR"`.
- The smallest amount: 100 is accepted, 99 answers 400 `validation_error` with `errors.amount: ["The value must be greater than or equal to 100."]`.
- Error `type` strings seen: `validation_error` (a 400 for a bad field; the documentation's pages say `invalid_request_error` or `invalid_request`), `invalid_request_error` (a cancel that cannot happen), `record_not_found` (404). `errors` is a map of field to an array of strings, or null. The client classifies by HTTP status only, so none of this changes the code.
- An unknown payment id and an unknown invoice id answer 404 `record_not_found`; the client reports `not_found`, which the webhook path closes as `unknown_payment`.
- Lists answer `meta: {current_page, next_page, prev_page, total_pages, total_count}` as documented.

## What this changes

- Nothing in the product code: every answer is one the client and the handlers already treat correctly (a refused cancel is followed by a fetch of the invoice, which then says `canceled` or `expired`).
- The emulator differed from the sandbox in three answers and is aligned to what was observed: a cancel of an already canceled invoice is 400 (it answered 200 again), a past `expired_at` is 400 (it was accepted), and a validation refusal's `type` is `validation_error`.

## Still open (needs a payment, a public URL or a device)

Items 3 (what the redirect appends), 6 (the invoice after a failed payment, a refund, a second payment), 7 (`captured` and `fee` on a paid payment), 8 (refund replies and partial refunds), 9 (webhook: event ids on retry, timeout, `live`, `account_name`, event names), 10 (the invoice callback), 11 (a void or a refund from the dashboard), the rest of 4 (a 3-D Secure payment begun before the expiry), the rest of 5 (cancel of a paid invoice), 13 (Apple Pay on a device, the 3-D Secure page) and 14 with a paid invoice. These are the supervised sandbox runs of E02: they need the webhook secret token set in the Moyasar dashboard, a public functions URL for the webhook and the callback, and the sandbox access code.
