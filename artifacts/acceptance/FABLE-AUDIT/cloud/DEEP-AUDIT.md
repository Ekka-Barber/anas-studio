# The deep audit before `main` (D48 (2)): the record

The owner's rule for this continuation (2026-10-07): `main` moves to its branch only "after independent deep audit and verfication done by another agent better than you like FABLE", and on his word. Four independent auditors, Claude Fable 5.1 at effort max, read-only, one slice each, audited everything the continuation changed: `git diff d4fa953..264360e` on `claude/amazing-planck-qv3f7a` (rounds F3, D1, S, the admin redesign, D and the plan files). None of them wrote any of that work, and none was told the earlier audits' verdicts as facts. The orchestrator (Claude Opus 5.5 at effort max) ruled on every finding against its source and made the fixes; a fresh Fable 5.1 verification of the fixes follows below.

## The four slices

| Slice | What | Verdict | Findings |
|---|---|---|---|
| A | Money, the Edge Functions, the admin's money and permission logic (F3-4, F3a, the server side of F3b) | pass | FD-A-01, FD-A-02 low; FD-A-03 to FD-A-07 info |
| B | The client: the admin's and the store's screens, the public site, the reader (F3b, D1, D49) | fail | FD-B-01 medium; FD-B-02 low; FD-B-03 info |
| C | The supply chain, the scripts, CI and the repository's tooling (S), and the whole-tree checks | fail | FD-C-01 medium; FD-C-02 to FD-C-04 info |
| D | The documents and the plan (D, the plan files, the records and runbooks) | fail | FD-D-01, FD-D-02 medium; FD-D-03, FD-D-04 low; FD-D-05 info |

No critical and no high finding in any slice.

What they confirmed, among much else, by their own reading, mutations in scratch copies and renders:
- **A:** a refund is never sent twice for one intent nor for the wrong total (the kept key, `expectedRefunded` from the screen to the SQL's STALE); «أعد الفحص» on a closed attempt reads Moyasar read-only and never marks paid, writes at Moyasar or touches another mode's attempt; a revoke rolls back only its own change; the 5xx log lines carry no message, body, token, address or name; four mutations each failed exactly the test that claims the fix. 15 unit files, 931 tests; the Deno check of all ten functions.
- **B:** the admin redesign keeps every rule of `artifacts/acceptance/ADMIN-DESIGN/contract.md`; an independent render of 15 admin screens at 320 to 1440 (90 views) settled with no overflow and one nav, and the before and after structure matched on 30 views; eleven mutations each failed their test; the specs written but never run would pass as written. 12 unit files, 311 tests.
- **C:** the dependency change adds no package name, removes exactly the Sass subtree and only upgrades the rest (integrity checked against npm for seven packages); CI's audit gate stops the job; the restore rehearsal matches the Supabase CLI 2.106.0's own sources (network, labels, stop by project id); 22 of 23 mutations killed (its report said 23 of 24; its log holds 23, m07 the survivor). The whole tree: lint 0, typecheck 0, unit 2,583 passed and 1 skipped, check:frozen 0, check:copy 0, the Deno check 10 of 10.
- **D:** the restore's store closing, the outbox's key gate, the cron names, the functions and their settings, the revoke codes and Arabic strings, the order-link reissue, the suppression recipe; the plan files' quotations of the owner, the five files that still say xhigh, the AGENTS.md manifest row, every commit id, one launch sequence; nothing the owner decides written as decided, no gate closed.

## The findings and the rulings

| Finding | Ruling | Fix |
|---|---|---|
| FD-B-01 medium: after a lost `create` reply, a buyer who corrects the address and presses again meets ACTIVE_HOLD, which hands back the order made from the earlier request; its lines match the cart, so the hold view adopted it without the warning, and the parcel would go to the old address | Accepted (STORE-UI-04's second scenario, left half open by F3b's B1) | `unseenRequest` (`src/lib/cart.ts`): the checkout remembers a request whose reply was lost or answered 5xx, until a 4xx refusal of that same request shows it made nothing or the key ends; a later press that differs from it marks a handed-back order `OTHER_REQUEST` (`heldOrder`'s `editedSince`), so the hold view says «هذا الطلب أُنشئ قبل تعديلك؛ ادفعه كما هو أو ألغه لتطلب من جديد.». A refused first press leaves nothing waiting, so the e2e journey "ACTIVE_HOLD hands the held order back ... when the tab lost it" stays warning-free. Two unit tests; each of two mutations fails exactly its test. The verification's FV-01 and FV-02 completed it (below). Residual (ISSUES I55 (8)): the memory lives as long as the tab's page, so after a reload a corrected address meets the old order by its lines alone |
| FD-B-02 low: overdue schedules left the owner home's count, and only the oldest was named | Accepted | The overdue query counts them (`count: 'exact'`) and the line says «مستندات فات موعد نشرها: N، أقدمها: …» for more than one; one keeps «موعد النشر فات: …». A unit case |
| FD-C-01 medium: no test pinned the pre-clean's `--project-id`; without it, `supabase stop --no-backup` would act on the development stack and remove its data volumes, and the suite stayed green | Accepted | `tests/unit/restore-check.test.ts`: every rehearsal run now checks that each CLI call names the scratch workdir or the rehearsal's project id, and one test pins the first call after decryption. The surviving mutation (m07) now fails 20 tests; the baseline passes 43 of 43 |
| FD-D-01 medium: the restore runbook re-revoked members only at step 17, while Auth and its users are back at step 4 and the rebuilt site reaches the project from step 11 | Accepted | Step 5 replays the whole ledger in SQL: `active = false` (what RLS and every staff function check), the ban (written directly, untried on a hosted project, so the inactive row is what to rely on), `staff_sessions_end` (after step 6 for a backup older than M1b), then the staff erasures; step 17 checks the ledger and sets `RESEND_API_KEY`. The same order in `docs/privacy-data-map.md` and `PLANS/DATA-AND-SECURITY.md` |
| FD-D-02 medium: "`worker.js` and `deploy.cjs` accept `open`" read as today's fact; today they know `soon` and `maintenance` only | Accepted | The contract, P11 and the soon README say SITE-STATE-1 teaches both the word `open`; `deploy.cjs --mode=open` is in SITE-STATE-1's paths |
| FD-D-03 low: step 16 named no tool and no upsert, though the objects' rows come back at step 4 | Accepted | Upsert with the content type, as `uploadObjects` in `scripts/restore-check.mjs` does, right after the rebuild |
| FD-D-04 low: STATE.md and the lock kept "an ultracode workflow" for the owner's words | Accepted | A dated correction in STATE.md; the lock's roles quote him |
| FD-D-05 info | Accepted | `docs/costs.md` dates the spend cap; COVERAGE C25 names the residuals round |
| FD-A-01 low, FD-A-02 low, FD-B-03 info | Recorded (ISSUES I55 (8)): two owners revoking one member at once; `expectedRefunded` optional for older tabs; the reader spec's `toBeDisabled()` | — |
| FD-A-03 to FD-A-07, FD-C-02 to FD-C-04 info | Recorded here: a 401 on the refund POST itself reads as REFUND_FAILED (money state right, tested); a completed retry's audit row lacks `alreadyRevoked`; handled 503s log one line each while the shop is closed; two `resend-webhook` 503s carry no request id line; the prompt path also clears MODE_CHANGED (the record said UNVERIFIED only); the network remedy may print after the cleanup already removed it; the graft helpers' Windows path is read harmlessly on POSIX; `.jpeg`, `.gif`, `.ico` and `.otf` are not marked binary (git's own check protects them) | — |

## The verification of the fixes (a fresh Fable 5.1 at effort max): verified, six findings, none above low

It walked FD-B-01 through every path of the checkout's press (a lost reply, a 5xx, a 4xx, a success, ACTIVE_HOLD with and without a handed-back order, two lost replies, the same request again, a corrected address, a changed cart, the key's end, a reload) and found the hold view warns exactly when a handed-back order may not be what the buyer now asks for, and blocks nothing (the pay link stays); the e2e journeys that meet ACTIVE_HOLD still pass as written; its five mutations of `cart.ts` each failed exactly the new test; the change adds about 98 B gzipped to the checkout page's code (headroom about 0.4 KiB). FD-B-02, FD-C-01 (every mutant of round S's set killed again, m07 by 20 tests) and FD-D-01 to FD-D-05 closed; the scope exact.

| Finding | Ruling and fix |
|---|---|
| FV-01 low: Turnstile's 400 on a retry of the very same request comes before the function replays the order, so it dropped the memory of a request that made one | Fixed: `refusedOutright` (`src/lib/cart.ts`) counts a 4xx as "made nothing" except `TURNSTILE`; a unit test |
| FV-02 low: no test reaches the checkout form's wiring | Fixed: two cases in `tests/e2e/cart-checkout.spec.ts` (a lost `create` reply made by `route.fetch()` then `route.abort('failed')`; then a changed name meets the warning, and the same request again does not), written for the owner's machine and not run here |
| FV-03 low: a revoke line naming the only active owner the backup holds is refused by `staff_keep_an_owner` | Fixed: step 5 says to make the current owner first, as "Removing access in a hurry" does |
| FV-04 info: step 16 needs nothing from step 11 | Fixed: do it before step 11, so the rebuilt site never shows the images broken |
| FV-05 low, FV-06 info: the counts in EXECUTION-STATUS and in this record | Fixed (22 of 23 mutations, from round S's mutation log) |

The contract's "(it accepts `--mode=open`)" now reads "(to accept `--mode=open`)", a deliverable, as the verification noted.

## Checks after the fixes

In the container (Node 24.19.0): see the commit's message for the final run (lint, typecheck, the whole unit suite, check:frozen, check:copy, verify-plan, `git diff --check`). Not run here: the two new e2e cases and every Playwright suite (the owner's machine), the build and `check:budgets` (CI).
