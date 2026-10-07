# Follow-ups collected from the fix rounds, for the rounds still to be briefed

## For M2 (SQL)
- `public.notify_email_data` (20261002120000_order_emails.sql:137) returns no `preorder` flag; the availability renderer (F1-7) is ready for one. Add `'preorder', v.preorder` for the variant, or carry the state in the sweep's payload.
- `public.alert_email_data` answers `{alert}` alone for the three new owner alert kinds; add branches: `attempt_mode_changed` and `refund_mode_changed` with the order number from the payload's orderId, `payment_create_refused` with `'error', p_payload ->> 'error'` and the order number (F1-17).
- ARCH-13: a staff function over `cron.job_run_details` (failed runs in the last 24 h by jobname, count, last time; no command text), owner/operations only.
- VENDOR-PAY-02: a bounce brake on the visitor-triggered tier (`notify_confirm_queue`/`outbox_claim` priority 2) when recent notify_confirm rows bounced or complained; one owner alert when it engages.
- FIX-A2-04: the availability sweep's guard should use the effective checkout state (switch, seller set, policies approved), not `checkout_enabled` alone.
- FIX-A2 I48 (1) race (DB-COMMERCE-05 / GAP-G5-3): lock the settings row unconditionally in `policies_reset_approval`, or read the published policy rows FOR SHARE in `commerce_policies_approve`.
- ARCH-12: a library image's alt-text edit should request a site build.
- VENDOR-PAY-03: an Undetermined bounce must not suppress the address for good.
- VENDOR-PAY-04: a mail Resend accepted and later reports `email.failed` cannot be re-sent (`outbox_replay` refuses sent rows): allow replay of such rows.
- OPS-PRIVACY-20: sandbox (test-environment) paid orders should be erasable, not kept as accounting retention.
- OPS-PRIVACY-18: nothing closes an uncertain mail the owner found delivered: an owner action to close it.

## For F3 (functions and client)
- F1-12 (DB-OPS-01), the recipe from the F1 worker: in `paymentRecheck`, when the attempt has no `providerInvoiceId` and its status is not 'uncertain' or 'creating', run `resolveUncertain(payments, before)`; when its kind is not 'unavailable', close through the path it names so the UNVERIFIED mark clears.
- TeamView.tsx:94 comment says BAN_FAILED commits `active` first; since F1-9 the handler rolls `active` back. SESSIONS_FAILED (F1-8) leaves the member revoked: the screen must offer «حاول مرة أخرى» for the sessions step (re-run the revoke, which is idempotent) rather than only «استعادة».
- VENDOR-PLAT-01: analytics.ts reads `settings.httpRequestsAdaptiveGroups.maxDuration` once and splits the 7-day window.
- ARCH-13 UI: one owner-home line for failing scheduled jobs.
- FIX-A1-02: confirmation before an owner demotes himself (TeamView set_role on the caller's own row).
- VENDOR-PAY-08: the refund mail and the order page add the timing sentence (mada up to 3 business days, cards 7 to 14) — wording for the owner to approve; propose it.
- TEST-UNIT-07: `preorderCurrent` compares a date string against the browser's en-CA locale format.

- From F2a: SignIn.tsx masks a captcha refusal (Auth answers 400 `captcha_failed`) as «أرسلنا…». A captcha failure says nothing about the address, so show its own sentence: «تعذّر التحقق من أنك لست روبوتًا؛ حدّث الصفحة وحاول مرة أخرى.» and stay on the e-mail step (a wrong hosted secret would otherwise lock staff out silently).
- From F2a (the orchestrator's brief erred): the rich-text link rule (src/admin/richtext.ts `linkUrlSchema`, src/lib/richtext.tsx, RichTextEditor.tsx) now accepts `http://` and `mailto:`, against PLANS/DATA-AND-SECURITY.md ("HTTPS links only") and P04. Restore exactly lowercase `https://` with a host (keep the editor copy «يبدأ بـ https://»), refuse everything else in the editor and render it unlinked; update tests/unit/richtext.test.ts and richtext-editor.test.ts accordingly (the two tests that used HTTPS:// as the refused case stay).
- From F2a: the comment in supabase/functions/_shared/contact.ts still says the form checks only the message bytes; the form now measures the whole JSON body.

## For S (already in brief-S.md) plus
- F1-15 (EF-ACCESS-08): lengthen the local pepper in scripts/local-env.mjs to 32+ characters first; then a shared reader for TOKEN_HASH_PEPPER (9 call sites across admin, checkout, contact, download, notify, orders, outbox, payments) that refuses fewer than 32 characters; the hosted secret must be checked before deploying such a check (I28 line).

## Process incidents to report
- The F1-resume worker's recursive grep for TOKEN_HASH_PEPPER matched `supabase/functions/.env` and printed one line: the local placeholder pepper that `scripts/local-env.mjs` writes (a fixed, non-secret development string). No other content of that file was read or printed; later searches were limited to `*.ts`.
- `refunds-http` 'a refund that times out and lands late' failed once and passed on the rerun (the worker's guess: a keep-alive connection the in-process emulator closed after the test's wait); watch it in the after-battery.
