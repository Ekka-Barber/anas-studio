# ANASAQ.ME: start here, GLM

Planning-only handoff, revised 2026-09-21 to retain Payload and incorporate the user's complete resume attachment. Do not interpret these documents as evidence the app was built. No P00 spike, installation, scaffold or deployment has been performed.

Read in order: DECISIONS.md, ARCHITECTURE.md, DATA-AND-SECURITY.md, WORK-PACKAGES.md, COVERAGE.md, VERIFICATION.md, DESIGN-AUDIT.md, research-final.md, SOURCE-NOTES.md, PLAN-AUDIT.md. All live in PLANS/. Research evidence and frozen hashes are under evidence/. Required working skills were loaded: ponytail, caveman, cavecrew, planner, search-first, karpathy-guidelines. Persisted work uses normal prose; conversations stay terse. The PDF skill supported read-only source inspection.

Authority: current user amendments and mission; offer v3's binding scope, including printed Payload requirement; compatible public PRD detail; frozen deploy design/showcase; assets/brand/source documents; project rules. Never inspect or modify _archive/. The old Astro/no-CMS/commerce-V2 split and demo prices are superseded. Payload replacement in the earlier draft was a mistake, explicitly reversed. There is one native CMS, not a custom Supabase admin beside it.

Start P00 FIRST with the exact Workers runtime spike. Only after it passes, execute P01–P11 in order and accept each package independently. Four offer phases: P00–P02 foundation, P03–P06 administration, P07–P09 store/payment, P10–P11 launch. P12 لوحة أنس is BONUS SCOPE, separately accepted, outside offer C-IDs and offered 7–9-week estimate. It may run after P10 when P11 is blocked only on external launch inputs; it does not bypass launch gates. Then hand off and stop.

The seven findings in the [execution audit](SECOND-PASS-AUDIT.md) are now incorporated into the decisions, architecture, data contract, accountable packages, coverage and verification gates. Use [the first GLM prompt](FIRST-GLM-PROMPT.md) for a bounded P00 run. Only the audit's three optional product additions remain recommendations outside accepted scope.

Current repository already has Git. Planning started at 06119445d732d5e8b5124c6b03b6be6752e8ca88; existing drafts/evidence were committed at 0e3c09d. Preserve user work; do not reinitialize Git. There is no production package manifest yet. Graft indexes only design support.js; HTML/documents were read directly after graph orientation. Source manifest hashes protect 360 source files. Reference .dc.html canvases are not production runtime or mobile acceptance targets.

## Single-writer orchestration

Before scaffolding, run `PLANS/verify-plan.ps1`; its PLANS-only assertion is for planning acceptance and does not apply after implementation starts. Record the current commit, pre-existing dirty paths and hashes of supplied planning documents in acceptance evidence. The lock's base commit alone does not capture uncommitted inputs. Preserve those inputs, compare package changes against that recorded baseline, and never stage unrelated edits into a package commit. Lock/status/issues and redacted acceptance artifacts are shared execution paths whose exact destinations must also be enumerated before writing.

GLM uses one active builder; a read-only reviewer may run concurrently. No writer may spawn another writer. Choose Sol for bounded implementation/review and Terra for small mechanical work; reserve higher effort for money/auth/runtime reasoning. Do not duplicate investigations already captured in evidence.

Before dispatch, GLM exclusively creates `.anasaq-execution.lock` using Node fs.openSync(path,'wx'). Record package/agent/task/base commit/start time and expanded exact allowed paths. Existing lock blocks dispatch. Never expire by clock: prove prior agent stopped, inspect diff, record recovery, then release. Lock remains held through integration and GLM audit. Shared manifests/migrations/generated types have the same single owner. New path required? GLM adds it to allowlist BEFORE writing.

GLM alone creates/updates PLANS/EXECUTION-STATUS.md and PLANS/ISSUES.md during execution. States: not_started/building/audit_failed/accepted/blocked_external. Log command results, commit/evidence and unresolved gates. Compare actual changed paths with lock. Every accepted package gets a clean commit on a codex/ branch, preserving phase handover. No push/purchase/live charge/deploy authority is implied merely by this plan.

## Builder brief

Copy this and include the package text plus active lock:

> Implement Pxx from PLANS/WORK-PACKAGES.md at the lock's base commit. Read final decisions/architecture/data/verification/design/research documents first. Write only enumerated paths, no concurrent writers, no frozen/source/archive changes. Use native Payload facilities for content/catalog; do not rebuild editors/media/versions/drafts/taxonomies. Arabic RTL, Latin digits, licensed identity; book visuals final outside reader/data wiring. No price defaults, auth shortcuts or unverified paid state. Run package checks and return exact commands/exit codes, changed files, evidence and remaining risks. Never self-accept; GLM runs and inspects independently.

## Gate behavior

Each C-ID has exactly one accountable owner in COVERAGE.md, with supporting packages where necessary. Package acceptance is not a claim all its eventual contract C-IDs are closed; e.g. catalog can pass P07 while C20 awaits P08 fulfillment. GLM audits every PRD before next dependent work. Security/runtime failures block; credentials/rights/cost/legal/training inputs remain explicit E gates. Continue genuinely independent work, never invent approvals.

Anas controls prices/rights/stock/tax/policies/accounts. Build/staging $0, local Docker primary plus one synthetic free preview DB. No live orders on pausable free DB; E07 approves always-on production costs first. Reader uses approved excerpt, not full paid file. Private board records may remain private indefinitely; linking does not publish. Real owner statistics show unavailable when upstream evidence is absent.

Done for this planning session: complete consistent documents plus evidence and planning audit. Done for later implementation: verified application, actual sandbox proof, launch gates, owner training and separately tracked 30-day support. Never claim training/support/live launch merely because checklists exist.
