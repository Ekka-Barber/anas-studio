# Facts for REPORT.md (kept as they happen)

## Runs and their cost (sub-agent tokens as the workflow tool reported them)

| Run | What | Outcome | Sub-agent tokens | Wall clock |
|---|---|---|---|---|
| wf_0489c0aa-784 (2026-10-05 22:30 to 23:30 Riyadh) | 33 Fable finders + Opus verifiers, first attempt | every finder died on the weekly quota limit after about an hour; nothing returned | 3.69M | 60 min |
| wf_2c780fb0-838 (2026-10-06 06:00 to 07:10) | same design, partial results persisted | 10 finders returned (83 raw); 23 finders and every verifier died on the session limit; resumed at 15:30 and stopped by the owner's role order at about 15:40 | 7.14M | 68 min + a few minutes |
| wf_c2a1377c-cc7 (2026-10-06 ~15:45) | 33 Opus-max finders, no verifier agents (the owner's rule) | the app process exited while it ran (machine away ~9.5 h); 0 results, 6 partial findings persisted | not reported | — |
| wf_61552b63-e15 (2026-10-07 01:15 to 03:32) | wave A: 11 money/security slices | 11/11, 141 raw | 6.77M | 137 min |
| wf_136a6d2f-6b3 (03:35 to 05:16) | wave B: 12 slices (tests, supply, arch, plan, docs, prior fixes, vendors) | 12/12, 177 raw | 8.00M | 101 min |
| wf_804f7d39-d9a (first start 05:30, killed by the owner pause at 06:40; relaunched 14:13, done 16:07) | wave C: 10 slices (admin UI, quality, store UI, design, reader, a11y, soon, perf) | 10/10, 190 raw | 5.68M (second run) | 114 min |
| wf_bbff2d77-e63 M1a | SQL payments | accepted | 0.53M | 49 min |
| wf_4e0996d2-7f2 M1b | SQL operations | accepted | 0.60M | 40 min |
| wf_a1299f2b-326 F1 (killed at the pause) + wf_2e3ecacd-4d8 F1-resume | Edge Functions | accepted | 0.39M (resume) | 31 min (resume) |
| wf_59460390-bd9 F2a | sign-in hardening, public safety | accepted | 0.46M | 70 min |
| wf_8e1b3c8e-df6 F2b | admin commerce screens, store client | accepted | 0.60M | 40 min |

Three attempts were lost to quota and a process exit (about 11M tokens of reading with no result); the lesson (persist partial results; one wave at a time; keep the app open) is recorded in STATE.md and the memory notes.

## Baseline (before) at HEAD 3a30a91, 2026-10-06

- Stack-free: lint 0 (304 s), typecheck 0 (54 s), check:frozen 0 (50 frozen files), check:copy 0 (232 files); unit `pnpm test` exit 1: 6 timeouts of 2,213 (restore-check ×5, reader-mapping ×1) while 33 agents were starting; the two files pass alone (28/28 in 26.6 s).
- Stack: `supabase db reset` 0 (72 s); db:import 7 documents; db:demo-catalog; db:env; `test:db` 31 files 814/814 (546 s); build 0 (73 s); check:export 59 required files, 372 text files, no secret; check:budgets largest 148.9 KiB of 150.
- E2E (machine loaded by 11 agents): batch 1 170/170 (21.2 min); batch 2 7 failed / 302 passed (1.3 h): the 7 are one `store-admin` «جديد» navigation that timed out under load and five tests that depend on its product, plus `cart-checkout`'s total that then read stale rates; `orders.spec` 12 passed, 8 not run (the 15-minute global timeout at 15.0 min); typecheck after e2e 0. Re-run of `store-admin.spec` alone (still loaded): 40 passed, 1 failed («تعذّر الاتصال بالخادم.» on the paid-file upload: the admin function did not answer in time).
- CI on HEAD: green, every step (`before/ci-runs.txt`), including the Deno type check this machine cannot run.

## Process incidents

- The other project's Supabase stack (`saloony-repair`) held ports 54321-54324; it was in use on 2026-10-05 and idle for 19 h by 2026-10-06 22:14, when its 10 containers were paused with `docker stop` (restored with `docker start` at the 06:40 pause; paused again at 14:09 on 2026-10-07). `before/paused-containers.txt`.
- The local Supabase stack binds every service to 0.0.0.0 (the CLI prints "Local dev security notice ... All services bind to 0.0.0.0"), the same fact SUPPLY-11 found for the restore rehearsal.
- A process listing printed part of a Supabase personal access token that an MCP server on this machine receives on its command line (outside the repository; the value is not recorded anywhere in this audit). The owner should know that any process on the machine can read it.
- The F1-resume worker's recursive grep matched `supabase/functions/.env` and printed the local placeholder pepper (the fixed development string `scripts/local-env.mjs` writes; not a secret).
- The orchestrator's F2a brief widened the rich-text link rule to `http://` and `mailto:` against the plan ("HTTPS links only"); round F3 restores it.
- Two defects were introduced by this audit's own rounds and found by wave C: M1a-5's PAYMENT_REVERSED reading of Moyasar's 'refunded' status (ADMIN-COMMERCE-04) and M1b-4's inferred shipping correction (ADMIN-COMMERCE-18); both are fixed in M2.

## Owner decisions this audit surfaces (never decided here)

- Hosted Auth: Turnstile CAPTCHA on, 8-digit code (I28).
- www.anas.studio: a zone Redirect Rule to the apex at P11, not a second host on Pages.
- Resend plan (100 a day) before launch; the floor of 5 sends for codes.
- A per-resource hold ceiling (DB-COMMERCE-02).
- Whether the Moyasar account is dedicated to anas.studio (EF-MONEY-01); SADAD off live or out-of-band refunds (VENDOR-PAY-01).
- The children's films' written consent (PLAN-GAPS-02), the certificate's speciality against books and food (PLAN-GAPS-03), food licensing, National Address field and carrier (PLAN-GAPS-11), seller disclosure (PLAN-GAPS-12), PDPL elements (OPS-PRIVACY-08), privacy policy before data collection (STORE-UI plan gap).
- Films on a host that answers Range 206 (VENDOR-PLAT-04; I33).
- Supabase Free at launch against pausing (ARCH-02); Pro's spend cap.
- The soon state after the launch (SOON-01); «المتجر» in the navigation (DSN-PAGES-08).
- A second owner account and the lost-authenticator procedure (OPS-PRIVACY-12).
- Pages against Workers static assets for P11 (Cloudflare now recommends Workers for new projects).
- The usage-alert and flood response (EF-ACCESS-14).
- The refund timing sentence (VENDOR-PAY-08) wording.
