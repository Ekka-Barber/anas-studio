# ANASAQ.ME execution handoff

Planning completed for the mission in `PROMPT-FOR-ASTRA.md`, dated 2026-09-21. This folder is the deliverable. It does not implement or launch the application.

## Start here, GLM

1. Read this file, `DECISIONS.md`, `ARCHITECTURE.md`, `DATA-AND-SECURITY.md`, and `WORK-PACKAGES.md` completely. Read `VERIFICATION.md` before dispatching a builder.
2. Read `COVERAGE.md` and `DESIGN-AUDIT.md`. Read the research files for the component being implemented. Evidence lives in `evidence/`; fetch scripts reproduce public research without credentials.
3. Execute packages P00 through P11 in order. The four contractual phases are P00–P02, P03–P06, P07–P09, P10–P11. A phase is not accepted until every package in it passes GLM's own audit.
4. Start with P00. Do not ask architectural or product questions already settled here. Record a new assumption in `DECISIONS.md` if a small ambiguity remains. Follow the escalation procedure for missing rights, credentials, money decisions or an actual contract conflict.
5. Keep every offered capability. A blocked launch requirement remains open and visible; it is never relabelled optional, completed or future scope.

The public site has eight existing destinations plus the newly promised blog. The complete platform also includes services and appointment booking, a full store, and an Arabic administration area. The old PRD's Astro stack, no-CMS scope and commerce-V2 split are superseded. English, subscriptions, a marketplace, ERP, carrier label purchasing, print production and a visual page-builder are not requested.

## Authority and current state

The offer's headings and promises in `offer-site-v3/index.html` govern scope; the mission governs this assignment and its hard lines. Use `anasaq-me-prd-v1.md` for compatible product detail and `deploy/design/` plus `deploy/index.html` for frozen design. Assets and brand documents are supporting sources. Never read or modify `_archive/`.

The repository already has Git. Planning began at `06119445d732d5e8b5124c6b03b6be6752e8ca88` on `main` with a clean tracked worktree. The offer's historical statement that no Git repository existed is now obsolete. Do not initialize or replace Git. There is no application package manifest; the showcase is HTML with a design-component runtime. Graft indexes only `deploy/design/support.js`; product HTML and documents are outside that index. CodeGraph was consulted, but there is no production application to extend.

Read-only browser inspection of the current showcase and book reader confirmed the supplied visual language and the reader integration boundary. The `.dc.html` boards are reference artifacts, not production runtime code. Do not ship `support.js`, its dynamic evaluation, prototype customization controls, style-board pages, inline mock form handlers or fixed demo prices.

## One-writer execution rule

Use **one active builder at a time**. This is the smallest reliable lock scheme for this repo. A read-only reviewer may run alongside it. There is no parallel writing, including tests, generated types, migrations, manifests or lockfiles. No subagent may spawn another writer.

Before a builder starts, GLM acquires an exclusive local lock using Node `fs.openSync('.anasaq-execution.lock', 'wx')`. Write task ID, agent ID, package ID, UTC start, base commit and allowed paths to that file. The lock is an execution artifact, ignored by Git. Only GLM may create, edit or release it. A pre-existing lock blocks dispatch. Never expire it by elapsed time: first prove its agent is stopped, inspect the working diff, then record recovery and release it. Atomic exclusive creation prevents two orchestrators from claiming the same checkout.

The lock is held through integration and audit. A builder writes only its package's listed files and returns control. GLM checks `git diff --name-only` against that set; an unexpected file fails the delivery. Adding a necessary file requires GLM to amend the package's ownership list before work resumes. Shared files can change only during the current serial package. No speculative reservation system, wildcard write grants to a second builder, or concurrent lockfile installation.

GLM owns `PLANS/EXECUTION-STATUS.md`, `PLANS/ISSUES.md` and acceptance records. Create these at execution start, not as false completed records in this planning handoff. Record each package as `not_started`, `building`, `audit_failed`, `accepted` or `blocked_external`; record base/head commits and evidence paths. A clean commit per accepted package preserves the contractual ability to stop and hand over at any phase. Use `codex/` branches. Do not push, deploy or purchase anything just because a plan exists; follow the executor's actual authorization.

## Builder brief, copied in full for every dispatch

> Implement package Pxx from PLANS/WORK-PACKAGES.md. Read PLANS/README.md, DECISIONS.md, ARCHITECTURE.md, DATA-AND-SECURITY.md, VERIFICATION.md and that package's research references. Your base commit and permitted paths are in the exclusive execution lock. No other write paths, no subagents that write, no changes to deploy/design/, deploy/index.html, offer-site-v3/, BOOK_ASSETS/, original fonts or _archive/. Implement all listed states and acceptance criteria. Use Arabic RTL and Latin digits; preserve the locked public design. Do not hardcode a product/service price. Never bypass validation, database authorization or gateway verification. Run your package checks and report exact commands, exit codes, changed files, remaining risks and evidence paths in normal persisted prose; return a terse conversational summary. Do not mark the package accepted. GLM will independently run and inspect it.

## Stop conditions and external inputs

All code can be built and tested locally with synthetic data, local Supabase and a gateway emulator. Provider sandbox verification and live launch require actual accounts. `DECISIONS.md` lists these gates with safe defaults and who supplies them. Never fabricate an approved manuscript, merchant account, stock count, selling price, VAT status, shipping promise, testimonial, metric or content right.

The final handoff must distinguish implementation complete, sandbox verified and live launched. Include client-owned repository/account inventory, Arabic owner guide, training record, restore drill, operational checklist and the month-of-support record. Do not claim that a month of support or a training session happened because their documentation exists.

Planning verification and its limits are recorded in `PLAN-AUDIT.md`. Build verification is prescribed in `VERIFICATION.md`; it has not run yet.
