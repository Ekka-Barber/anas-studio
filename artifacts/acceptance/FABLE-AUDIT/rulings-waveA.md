# Orchestrator rulings on wave A (money and security slices), 2026-10-07

Finder: Opus 5.5 at effort max, one slice each (`find:*` in workflow `wf_61552b63-e15`). Verifier: the orchestrator (Claude Fable 5.1), by reading the cited code itself; every confirmed finding below was re-read at the cited lines before a fix was dispatched. Severity is the orchestrator's. Disposition names the fix round (M1a, M1b: SQL; F1: Edge Functions; F2a, F2b: client) or the reason nothing was changed.

| Id (duplicates) | Verdict | Sev | Disposition |
|---|---|---|---|
| CLIENT-SEC-01 | confirmed (no CAPTCHA on /auth/v1/otp; config.toml `[auth.captcha]` off; SignIn.tsx:36 passes no captchaToken) | high | F2a-1: Turnstile on the sign-in form, `[auth.captcha]` turnstile locally; hosted switch recorded for I28 (owner at P11) |
| CLIENT-SEC-06 | confirmed (6-digit code, 30 verifications per 5 min per IP, no lockout; vendor facts checked by the finder) | high | F2a-2: 8-digit code (config, UI, tests); hosted setting for I28 |
| EF-ACCESS-03 (lead EF-ACCESS-02) | confirmed (single origin, http.ts:38; the plan attaches www to Pages with no redirect; Cloudflare `_redirects` cannot redirect across hosts: checked in the current docs) | high | plan: P11 attaches www only as a zone Redirect Rule to the apex; I32 hosted check; no function change |
| EF-ADMIN-01 | confirmed (db.ts:30 legacy key only; Supabase docs list SUPABASE_SECRET_KEYS and call the service_role key legacy: checked) | high | F1-1: prefer SUPABASE_SECRET_KEYS.default, fall back to the legacy key; I28 line |
| CLIENT-SEC-02 | confirmed as vendor behaviour (422 otp_disabled for a non-staff address); the page masks, the API does not | medium | docs: P03 proof wording corrected; mitigated by F2a-1 |
| CONTRACT-01 = EF-ACCESS-07 = P08-CKPT-01 | confirmed (token renewed only at payment, recovery, resolve, file attach; shipped and refund mails carry it) | medium | M1b-3 |
| CONTRACT-02 = P08-CKPT-03 = EF-ADMIN-20 | confirmed (AdminHome KNOWN_JOBS lacks payments_reconcile) | medium | M1a-7 (`payments_due_since`), F2b-1 (the screen) |
| DB-COMMERCE-01 | confirmed (checkout_price accepts quantity 1-20 for a digital line; one entitlement per item) | medium | M1b-6 (SQL), F2b-8 (UI) |
| DB-COMMERCE-02 | confirmed arithmetic; the accepted residual in contract 13.1 understates it | medium | needs owner (a per-resource hold ceiling is a business choice); docs corrected with the real numbers |
| DB-COMMERCE-03 = DB-PAY-03 = DB-OPS-05 = P08-CKPT-12 | confirmed (order_try_commit judges by the reservation flag; the form nulls the capacity) | medium | M1a-1 (with the reservation flag set to how the unit was committed; contract wording to follow) |
| DB-CORE-01 | confirmed (commerce_settings_get returns the raw switch; policies_reset_approval alerts nobody) | medium | M1b-7 (SQL), F2b-2 (screen) |
| DB-CORE-02 = EF-ADMIN-08 | confirmed (outbox_claim suppresses staff kinds too; nothing lifts a suppression; replay refuses 'suppressed') | medium | M1b-8a (staff kinds never auto-suppressed); docs: recipe to lift a suppression |
| DB-OPS-02 = P08-CKPT-10 (lead DB-OPS-01) | confirmed (fulfillment_stopped only recorded; fulfillment_update, to_ship and order_detail for operations ignore it) | high (goods shipped after a chargeback) | M1b-2 |
| DB-PAY-01 = P08-CKPT-06 = DB-POST-07 | confirmed (MODE_CHANGED parking silent; not listed, not counted, purgeable) | medium | M1a-3; M1b-13 (the mark clears after a provider answer) |
| DB-POST-01 = DB-OPS-13 | confirmed (fulfillment_update has no REFUND_IN_FLIGHT guard; order_resolve has one) | medium | M1b-1 |
| DB-POST-02 | confirmed (refund_request ignores finance.disputes) | medium | M1b-5 (refuse CHARGEBACK_RECORDED while the latest chargeback row is against the seller; an external refund can still be recorded); the policy itself flagged for the owner |
| DB-POST-03 = EF-ACCESS-13 | confirmed (recovery renews the same token; nothing revokes) | medium | M1b-11 + F1-10 + F2b-5 (`order_link_reissue`) |
| DB-POST-04 | confirmed (priority 0 may spend the whole Resend day) | medium | M1b-8b (a floor of 5 sends for codes); the Resend plan is the owner's decision |
| DB-POST-05 = EF-ACCESS-06 | confirmed (no way to re-address or re-send a link; recovery lists the 5 newest) | medium | M1b-11 + F1-10 + F2b-5 |
| DB-PAY-04 = P08-CKPT-02 | confirmed (v_charged includes 'refunded'; commit, then alert) | medium | M1a-2 |
| EF-ACCESS-14 | confirmed as a platform fact (invocations billed whatever the status; Fair Use restrictions) | medium | needs owner: a usage alert and a flood procedure before launch (plan gap) |
| EF-ADMIN-02 | confirmed (ban only; sessions survive a restore; DATA-AND-SECURITY.md:99 claims otherwise) | medium | M1b-10 + F1-8 |
| EF-ADMIN-18 | confirmed (401/403 are permanent, so every queued mail exhausts at once) | medium | M1b-9 + F1-4 |
| EF-MONEY-01 | confirmed behaviour; whether the Moyasar account is dedicated is the owner's | medium | needs owner; runbook line |
| EF-MONEY-02 | confirmed (no trace of a refused webhook) | medium | F1-2 (a fixed-code log line); runbook: the first live webhook must be seen to arrive |
| EF-MONEY-08 | confirmed (CREATE_REFUSED silent, HTTP status dropped) | medium | M1a-4 |
| EF-MONEY-12 | plausible; depends on how Moyasar treats an invoice after a failed payment (open sandbox item 6) | medium | open: E02 run 3 decides; code and emulator readiness listed as a plan gap |
| DB-PAY-05 | confirmed | low | M1a-5a |
| DB-PAY-06 | confirmed | low | M1a-5b (PAYMENT_REVERSED) |
| DB-PAY-02 = EF-MONEY-03 = P08-CKPT-08 | confirmed (callback throttle keyed on Moyasar's IP) | low | M1a-6 (per-invoice throttle) |
| DB-POST-10 | confirmed | low | M1b-4 |
| DB-POST-11 | confirmed | low | F1-5 |
| DB-OPS-08 | confirmed | low | F1-7 |
| DB-OPS-10 = P08-CKPT-11 | confirmed | low | M1b-12 |
| EF-ADMIN-16 | confirmed | low | F1-9 |
| EF-MONEY-09 | confirmed | low | F1-3 |
| EF-MONEY-15, P08-CKPT-05 | confirmed | low | F1-11 |
| DB-OPS-01 | confirmed | low | F1-12 |
| EF-ADMIN-03, EF-ADMIN-17 | confirmed | low | F1-13, F1-14 |
| EF-ACCESS-08 | confirmed | low | F1-15 (guarded by the local writer's pepper length) |
| EF-ACCESS-12 | confirmed | low | F1-16 |
| EF-ADMIN-11 | confirmed | low | F1-6 |
| CLIENT-SEC-03, -04, -05, -07, -08, -10, -11, -12, -13; DB-CORE-08; EF-ACCESS-09 | confirmed from the finder's evidence | low | F2a-3 to F2a-13 |
| CONTRACT-05, -06, -07, -08, -09; EF-ADMIN-10, -12, -19 | confirmed from the finder's evidence | low | F2b |
| EF-MONEY-04 | confirmed as a vendor rule (2xx before complex logic); the event is durably recorded first and the job retries | low | open: decide answer-then-settle (EdgeRuntime.waitUntil) with E02 run 1; not changed blind |
| EF-MONEY-05, EF-MONEY-06, EF-ADMIN-07, EF-ACCESS-01, DB-OPS-11, DB-OPS-12 | confirmed documentation staleness | low | docs round (orchestrator) |
| EF-MONEY-07, -13, -14 | confirmed emulator differences | low / info | docs: listed under the E02 items; emulator left as it is |
| CONTRACT-03 = DB-POST-06, CONTRACT-04, CONTRACT-13, DB-POST-08 (partly in M1a-3c), DB-POST-09, DB-OPS-03, -04, -06, -07, -09, DB-CORE-03, -04, -05, -06, -07, -09, DB-COMMERCE-04 to -09, EF-ACCESS-02, -04, -05, -10, EF-ADMIN-04, -05, -06, -09, -13, P08-CKPT-04, -07, -09, CLIENT-SEC-09, EF-MONEY-10 = CONTRACT-10 | confirmed from the finder's evidence; not re-proved line by line by the orchestrator | low | open, in the report with the finder's evidence and proposed fix; candidates for the P08 close or P10 |
| EF-MONEY-11, DB-POST-12, DB-POST-13, CONTRACT-11, CONTRACT-12, DB-CORE-10, -11, -12, DB-COMMERCE-10, EF-ACCESS-11, EF-ADMIN-14, -15 | observations | info | recorded |
