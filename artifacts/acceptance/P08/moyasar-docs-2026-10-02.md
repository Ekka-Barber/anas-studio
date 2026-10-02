# Moyasar documentation, as fetched on 2026-10-02

The source record for P08. Nothing here comes from memory: the orchestrator read the pages named in `PLANS/P08-CONTRACT.md` section 2 itself (raw markdown where the site serves it, the tag-stripped HTML of the API reference pages otherwise), and a read-only workflow (`wf_bdcb3007-35c`) had five researchers cover the rest of the site, each re-verified by an independent Opus agent that re-fetched every cited page and refuted what the page did not say. No call was made to `api.moyasar.com`. `D` is `https://docs.moyasar.com`.

The API shapes the code and the emulator use are in the contract's section 2. This file holds what the runbook also needs.

## Where the pages are

- Guides and general API pages serve raw markdown under `D/docs/…/*.md`; the index is `D/llms.txt`.
- The API reference pages are HTML only: `D/api/invoices/01-create-invoice`, `03-list-invoice`, `04-show-invoice`, `05-update-invoice`, `06-cancel-invoice`, `03-bulk-invoice`; `D/api/payments/01-create-payment`, `02-fetch-payment`, `03-list-payments`, `04-update-payment`, `05-refund-payment`, `06-capture-payment`, `07-void-payment`.

## Accounts, keys and going live

| Fact | Source |
|---|---|
| An account has a test pair and a live pair of keys; the live pair appears after activation. A secret key is shown once; only its id (`sk_test_…` or `sk_live_…`) stays visible, and a lost key is regenerated. | `D/docs/getting-started/create-account-and-api-keys.md`, `D/docs/api/authentication.md` |
| A live key on an account that is not activated answers 405, `account_inactive_error`. | `D/docs/api/errors.md` |
| Switching to live: replace the test keys with the live keys, point `callback_url` at the production HTTPS domain, re-test the whole payment lifecycle, enable logs and alerts for payment and webhook failures. | `D/docs/getting-started/test-vs-live-environments.md` |
| Go-live checklist: verify the payment server-side before fulfilment, validating `status`, `amount` and `currency`; confirm the callback and webhook endpoints are reachable. | `D/docs/getting-started/go-live-checklist.md` |
| A webhook endpoint registered in the dashboard must be HTTPS. Fields: Endpoint, Secret Token, HTTP Method, Events. | `D/docs/guides/dashboard/setting-up-webhooks.md` |
| Activation (not on the docs site, Moyasar's FAQ): a Saudi commercial registration or freelance licence and a linked Saudi bank account; activation can start before the site is live, and Moyasar reviews what is sold, the pricing and refund policy and the contact channels. | `https://moyasar.com/en/resources/faqs/` |
| Rate limits: a 429 status and `rate_limit_error` exist; no number is documented. No maximum amount is documented. | `D/docs/api/errors.md` |

## Sandbox test cards

"Using any card that is not listed below will result in a failed payment." Source: `D/docs/guides/card-payments/test-cards.md`. The result is the payment status `paid` with message `APPROVED`, or `failed` with the message shown (response code in brackets).

| Scheme | Approved | Declined |
|---|---|---|
| mada | 4201320111111010 | 4201320000013020 UNSPECIFIED FAILURE (99); 4201320000311101 INSUFFICIENT FUNDS (51); 4201320131000508 DECLINED: LOST CARD (41); 4201321234411220 DECLINED (05); 4201322267774310 DECLINED: EXPIRED CARD (54); 4201326324640570 DECLINED: EXCEEDS WITHDRAWAL LIMIT (61); 4201321144311528 DECLINED: STOLEN CARD (43) |
| Visa | 4111111111111111; 4111114005765430 (frictionless authentication) | 3-D Secure failures: 4111118250252531, 4111113343111067, 4111116611600661, 4111112205628150, 4111115784228433, 4111115620358287 |
| Mastercard | 5421080101000000 | 5105105105105100 (99); 5457210001000092 (51); 5204010101000000 (41); 5204730000002514 (05); 5105107550274126 (54); 5105106475101067 (61); 5105107304607225 (43) |

No sandbox OTP or ACS password is documented for the 3-D Secure step; what the challenge page looks like is recorded at the sandbox run.

## Apple Pay

| Fact | Source |
|---|---|
| Works only on Apple devices with the T1 security chip. | `D/docs/guides/apple-pay/basic-integration.md` |
| On the web the domain is registered in the dashboard (Settings, Apple Pay Domains) with its exact hostname; the association file is hosted at `/.well-known/apple-developer-merchantid-domain-association`; no Apple Developer account is needed for the web. | `D/docs/guides/apple-pay/web-registration.md` |
| The sandbox has no Apple Pay test cards: a real card in the wallet is used and the amount decides the outcome (approved between 20,000 and 30,000 halalas; other ranges decline with specific codes; any other amount fails). | `D/docs/guides/apple-pay/testing.md` |
| The invoice's payments list Apple Pay as a possible source type, but no page states that the hosted invoice page offers Apple Pay or on which devices. To observe at the sandbox run. | `D/api/invoices/01-create-invoice` |

## Settlements, fees, chargebacks

| Fact | Source |
|---|---|
| The payment's `fee` is "Estimated payment fee (including VAT)". How it is computed is not documented; fee rates are not published (sales team). | `D/api/payments/02-fetch-payment` |
| Settlements apply to aggregation merchants; they run twice a week (Monday and Thursday, or as the merchant's agreement says). Each comes with an email carrying a CSV, a PDF and an invoice. | `D/docs/guides/settlements/settlement-introduction.md` |
| A settlement line's `amount` is the net amount settled and can be negative; line types: `payment`, `refund`, `void`, `fee`, `platform_duties`, `other_duties`, `chargeback`, `chargeback_penalty`, `installment`. Lines carry the payment id, the RRN and the authorization code. | `D/api/settlements/03-list-settlement-lines` |
| A `balance_transferred` webhook is sent when a settlement is created (aggregation accounts, set up in the live dashboard). | `D/docs/guides/settlements/settlement-notification.md` |
| No dispute or chargeback object, endpoint, webhook event or payment status is documented. The only trace is the settlement line types above. Moyasar's platform terms (not the docs site) say the merchant is notified by email and bears 200 SAR for each lost chargeback. | `D/api/settlements/03-list-settlement-lines`, `https://moyasar.com/en/resources/platform-terms-and-conditions/` |
| Refund timing is not documented in the API pages; a live aggregation account's balance must cover a refund. Void is the alternative within about two hours of the payment; the pages disagree on its scope, so P08 does not use it. | `D/docs/guides/payment-operations/index.md` |

## Not documented (so not assumed)

- The query string Moyasar appends to an invoice's `success_url` or `back_url`.
- The meaning of each invoice status and their transitions (only `expired` is explained).
- Any idempotency for invoice creation or refunds.
- Whether a partial refund sets the payment's status to `refunded`, and whether a second refund is then accepted.
- The headers, timeout, order and duplicate rules of webhook delivery (beyond "webhooks can repeat").
- Retries or authentication of the invoice `callback_url` POST.
- Whether the hosted invoice page offers Apple Pay.
- A `live` or mode field on payments and invoices (only the webhook has `live`).
