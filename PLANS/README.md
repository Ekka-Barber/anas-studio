# ANASAQ (anas.studio): start here

`PLANS/` is the plan of record. Revised 2026-10-03 (D47; P08 in progress). Since D29 a custom Supabase admin replaces Payload, and work stays local until P11.

Read in order: [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATA-AND-SECURITY.md](DATA-AND-SECURITY.md), [WORK-PACKAGES.md](WORK-PACKAGES.md), [VERIFICATION.md](VERIFICATION.md), then [EXECUTION-STATUS.md](EXECUTION-STATUS.md) and the open items in [ISSUES.md](ISSUES.md). Consult [COVERAGE.md](COVERAGE.md) (offer C-IDs), [DESIGN-AUDIT.md](DESIGN-AUDIT.md) (before any UI work), [research-final.md](research-final.md) (limits and package choices) and [SOURCE-NOTES.md](SOURCE-NOTES.md) (source precedence) when a task needs them. The session kickoff is [KICKOFF.md](KICKOFF.md).

Authority: the owner's current amendments; offer v3's binding scope, with its Payload requirement replaced by D29; compatible PRD detail; the frozen `deploy/design/` showcase (v1 history; the public design is D39's direction B, `DESIGN.md`); assets and brand sources; project rules. Never inspect or modify `_archive/`. Source hashes in `evidence/source-manifest.json` protect the frozen sources.

Packages run P00 to P11 in order (D38 lets P07–P09 run before P01 and P02 finish), each accepted independently. Offer phases: P00–P02 foundation, P03–P06 administration, P07–P09 store/payment, P10–P11 launch. P12 «لوحة المشاريع» is BONUS SCOPE (D22, D50), accepted separately, outside the offer C-IDs and the 7–9-week estimate.

## Single-writer orchestration

Roles are in D28 as amended by D41, D43 and D45: the orchestrator (Opus 5.5) plans, audits, fixes and designs; `sonnet-worker` (Sonnet 5.5, effort max) does long, well-specified work and `auditor` (Opus 5.5, effort xhigh) audits its diff. Token rules are in CLAUDE.md (I24).

Before any write, the writer holds `.anasaq-execution.lock`, created exclusively with Node `fs.openSync(path, 'wx')`. It records package, agent, task, base commit, start time, dirty paths at start and the expanded exact allowed paths. An existing lock blocks dispatch. Never expire a lock by clock: prove the prior writer stopped, inspect the diff, record recovery, then release. The lock stays held through integration and the orchestrator's audit. A new path is added to the allowlist before it is written.

The orchestrator alone updates `EXECUTION-STATUS.md` and `ISSUES.md`. States: not_started/building/audit_failed/accepted/blocked_external. `main` is the only long-lived branch and the single source of truth: each package is built on a short-lived `agent/<package>` branch cut from `main`, fast-forwarded into `main` on the owner's word, pushed, and deleted; unrelated edits are never staged into a package commit. No push, purchase, live charge or deploy authority is implied by this plan.

## Builder brief

> Implement Pxx from PLANS/WORK-PACKAGES.md at the lock's base commit. Read DECISIONS, ARCHITECTURE, DATA-AND-SECURITY and VERIFICATION first. Write only enumerated paths; no frozen/source/archive changes. Use the collection configs and generic admin screens; do not build second editors, version stores or media libraries. Arabic RTL, Latin digits, licensed identity, main theme tokens. No price defaults, auth shortcuts or unverified paid state. Run the package checks and return exact commands, exit codes, changed files, evidence and remaining risks. Never self-accept.

## Gate behavior

Each C-ID has exactly one accountable package in COVERAGE.md. Package acceptance does not close every C-ID it supports. Security and runtime failures block; credentials, rights, cost, legal and training inputs remain explicit E gates. Continue genuinely independent work; never invent approvals. Anas controls prices, rights, stock, tax, policies and accounts. No live orders on a pausable free database. Real owner statistics show unavailable when upstream evidence is absent.

`verify-plan.ps1` checks the required documents, P00–P12 headings, C-ID ownership, frozen source hashes, local links and whitespace.
