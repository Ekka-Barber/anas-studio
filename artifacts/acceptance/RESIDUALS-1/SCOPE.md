# RESIDUALS-1: the scope and its rounds

`PLANS/EXECUTION-STATUS.md`, "Next work" item 5: the residuals no package names. Started on the owner's word
(2026-10-15: "Start the residuals round (Next work item 5): one fresh worker, Opus audit, under the lock."), on
`agent/residuals-1`, cut from `main` at `2937c75`.

## Why it runs as rounds

Item 5 names ten ISSUES entries and the entries FABLE-AUDIT's REPORT.md records open (Appendix B). Routed below,
about 90 of them are this package's code, across the database, the Edge Functions, the admin, the store, the public
site, the reader, the tests and the scripts. That is more than one worker can take in one brief and still be audited
well, so the orchestrator splits the package into rounds by area, each with a fresh `sonnet-worker` (Sonnet 5.5,
effort max) and a fresh `auditor` (Opus 5.5, effort max, the owner's latest word: `PLANS/HANDOFF.md`, "How sessions
run"), ruled by the orchestrator, under one lock. Round R1 is the one the owner's word starts; each later round is
reported before it starts. R1's writer reached the end of its run before its checks did (14 items, 434 tool calls), so
R2's 25 entries are split in two by layer (2026-10-15). R3's 20 entries are split the same way, by
screen family: R3a the content screens, R3b the commerce screens, which R2b also changes (2026-10-15).

## The rounds

| Round | Area | Entries |
|---|---|---|
| R1 | the named ISSUES entries and the medium findings in this lane | I44 (1); I45 (3); I50 (3) and (4); I51 (2); I55 (3), (4) (= VENDOR-PLAT-03), (5) (= SOON-09), (8) FD-A-01 and FD-A-02, (9) (= ADMIN-CMS-20 = QUALITY-20); ADMIN-CMS-01; ADMIN-CMS-02; TEST-DB-02; QUALITY-09; STORE-UI-12 (= QUALITY-08) |
| R2a | the database (one migration, its tests, the runbooks) | CONTRACT-03 (= DB-POST-06), CONTRACT-10 (= EF-MONEY-10), CONTRACT-13 with DB-POST-08, DB-COMMERCE-04, -06, -08, -09, DB-CORE-04, DB-CORE-07, DB-OPS-03 (= EF-ACCESS-05), DB-OPS-04, -06, -07, DB-POST-09, EF-ADMIN-13, P08-CKPT-04, P08-CKPT-07, TEST-E2E-03 |
| R2b | what crosses the database, the functions and the screens | CONTRACT-04 with ADMIN-COMMERCE-08 and ADMIN-COMMERCE-17 (the other payment mode after the switch), EF-ACCESS-04, EF-ACCESS-10, EF-ADMIN-05 with ADMIN-CMS-15, EF-ADMIN-06, EF-ADMIN-09, P08-CKPT-09 |
| R3a | the admin's content screens, the owner home and the email screen (no SQL) | ADMIN-CMS-05, -06, -10, -12, -13, -14, -16, -18, -23; QUALITY-12 |
| R3b | the admin's commerce screens | ADMIN-COMMERCE-03, -06, -09, -11, -12, -14, -15; QUALITY-18, -24, -26; the closed review card's «تسجيل اعتراض» (R1's record); the other mode's «إعادة إرسال رابط الطلب» (R2b's audit) |
| R4 | the store, the public site, the reader, the tests and the scripts | STORE-UI-03, -08, -09, -10, -11, -13, -16, -18; QUALITY-06, -07, -13 (= READER-07), -14, -21, -22, -23, -25; DSN-PAGES-13, -14; DSN-HOME-18; READER-14, -17; SUPPLY-04; TEST-DB-04 (with TEST-UNIT-12), TEST-DB-05; TEST-E2E-04, -07, -09, -13, -16; TEST-UNIT-02, -04, -07, -10, -13, -14; VENDOR-PAY-09; I55 (8)'s FD-B-01 residual (the checkout's memory across a reload), with I50 (2) if the budget needs it |
| Browser round | screenshots, a person's eye | REPORT.md Appendix A (38); round D1's held items; ISSUES I55 (2) (the local close's visual pass: 32 defects, 4 states, the spelling of «المَشاهد», the room preview's menu names, the reader's reading order); FD-B-03; FIX-A2-01 (the soon page, deployed only on the owner's word); DSN-HOME-06 to -11, -13, -14, -22, -23, -24; DSN-PAGES-03, -04, -19; READER-03, -05, -13, -16 |

## Not this package

- **P10's passes** (security, accessibility, performance), as item 5 routes them: CLIENT-SEC-02 (with the
  correction of P03's proof, `PLANS/WORK-PACKAGES.md:47`), CLIENT-SEC-09, DB-CORE-05, DB-CORE-06, DB-OPS-09,
  EF-ACCESS-02, EF-ADMIN-04, ARCH-14, FIX-A2-02, ADMIN-CMS-07, ADMIN-CMS-19, TEST-DB-09, TEST-E2E-01, -02, -08,
  A11Y-RTL-14, ADMIN-COMMERCE-16, PERF-02, -03, -06, -07, -08, -09, -11, -12, -14, -17, DSN-HOME-05; PLAN-GAPS-04 is
  the owner's decision before P10 ("Next work" item 9); ISSUES I46, I47, I49 (1), (2), (4) to (6), I50 (1).
- **P11 and the privacy pass with E08:** DB-COMMERCE-07, DB-CORE-09, OPS-PRIVACY-07, ISSUES I51 (1); ARCH-05 (a P11
  step for the Pages deployments' own addresses); EF-ACCESS-08 (F1-15, deferred to P11's hosted setup).
- **E02, untouched until the owner's word (D48 (3)):** EF-MONEY-04, EF-MONEY-12.
- **The owner's decisions:** `PLANS/DECISIONS.md`, "Owner decisions FABLE-AUDIT and its continuation leave open".
