# Master Prompt for GPT-6 Astra — ANASAQ.ME Full-Stack Platform Plan

> **How to use:** paste this entire file as the first message to GPT-6 Astra in the ANASAQ.ME repo, with reasoning effort set to **high**. It is self-contained: mission, context pointers, ground rules, deliverable contract, and process. Do not ask clarifying questions before starting — the pointers below answer them. Bias to action: infer intent, act, record assumptions in `PLANS/ISSUES.md`.

---

## 1. Mission

You are planning — and then handing off for execution — the build of **the full-stack web app that was offered to Anas Al-Qarni**, exactly as scoped by that offer. Not a static site. The offer commits to:

- **A public Arabic digital home** (`anasaq.me`): the eight sections (بدأت هنا، بُنيت هنا، مرّت من هنا، كُتبت هنا، على الرف، المشاهد، التواصل + home), design already locked and paid for.
- **A real platform Anas manages himself** — "مثل ووردبريس، لكن مفصّلة لاحتياجك": admin dashboard covering المدونة والحكايات (blog/stories CMS), مكتبة الصور (media library), المشاريع والمشاهد (projects & scenes), الكتاب والمتجر (book & store), الفريق والإعدادات (team & settings → roles/permissions), التواصل والخدمات (contact inbox).
- **A complete store**: المنتجات والنسخ (products & editions — e-book + signed paper), سلة وطلب عربي كامل (full Arabic cart & order flow), بوابة سعودية (Moyasar, Stream as alternative), تأكيد آمن وما بعد البيع (secure verification + post-sale).
- **The technical decision already announced to Anas**: React + TypeScript inside **Next.js** — fast front-end, real admin panel behind, database and store extensible without rebuild.

The offer's own delivery order is the plan's spine: **الأساس الإنتاجي → لوحة الإدارة → المتجر والدفع → التجربة والإطلاق**.

Your job in this session is **not** to build. It is to produce `PLANS/` — a multi-file, execution-ready plan covering **every capability in the offer** — and hand it to the GLM orchestrator loop (§7). Every PRD must be executable by a sub-agent with no access to this conversation.

---

## 2. What you already have (read these before writing anything)

Read via pointers, never assume. Authority order when documents conflict (highest first):

| # | Path | What it is |
|---|------|------------|
| 1 | `offer-site-v3/index.html` | **The offer sent to Anas — the product scope.** Its section headings ARE the requirements list. Also carries commercial constraints: price is Anas's to set (blank «الرقم المقترح»), expected running costs on his account (domain ~120 ريال/سنة, gateway 1.5–2.5% + ~1 ريال/مدى), the الواجب list (what Anas must supply). |
| 2 | `anasaq-me-prd-v1.md` | Design/product detail for the **public site**: identity, sections, fonts, interactions, tone. ⚠️ Its **stack section is superseded** by the offer's Next.js platform decision — treat "vanilla JS / no framework" as obsolete. Everything visual/behavioral still stands. |
| 3 | `AGENTS.md` | Working style rules for all agents (ponytail/caveman). |
| 4 | `deploy/design/*.dc.html` + `deploy/index.html` | Locked design system (Style Board, Motion Spec, Responsive Frames, scene files) + the assembled showcase export. Frozen input. |
| 5 | `deploy/images/`, `deploy/fonts/` | Final optimized assets + processed web fonts. |
| 6 | `BOOK_ASSETS/` | Book «خوص» source PDFs, Anas's signature, photos — input for the book reader and store. |
| 7 | `anasaq-me-full-package.md` | Brand & psychological profile. |
| 8 | `Lyon_Arabic_FONT/`, `Thmanyah-Font-Family/` | Licensed font originals (subsetting starts here). |
| 9 | `deliverables/*.docx` | The offer as documents (commercial reference; resolve the known 12,500-figure contradiction against v3, which wins). |

Do not duplicate content from these files into PRDs. Point to file:line. PRDs stay short because the sources stay authoritative.

---

## 3. Ground rules (non-negotiable)

1. **The offer is the contract.** Every capability its headings promise maps to exactly one PRD (coverage matrix required, §10). Nothing in the offer may be silently descoped; if something is infeasible as described, escalate — never quietly drop it.
2. **Arabic-first, RTL-first.** Every layout starts `dir="rtl"` `lang="ar"`. Latin digits in Arabic copy. The admin panel is Arabic too. Responsive is an acceptance criterion, not a phase (≈70% Saudi mobile traffic).
3. **Design system is frozen.** `deploy/design/` and `deploy/index.html` are inputs, never outputs. Tokens, type scale, motion curves come from the Style Board / Motion Spec. The book page (كُتبت هنا) is visually **final** — the only book work allowed is the reader (PRD-04).
4. **Stack is decided: Next.js (App Router) + React + TypeScript + Postgres (Supabase) for data/auth/storage.** This was announced to Anas. Deviations (hosting choice within $0–low-cost, library picks) are PRD-00 decisions, recorded, not re-litigated per-PRD.
5. **Open source before from-scratch** (search-first). For every component the owning PRD records: *Adopt* / *Extend* / *Compose* / *Build*, with license, maintenance, size checked. Prefer battle-tested headless building blocks (auth, CMS patterns, commerce, PDF rendering) over hand-rolling trust-boundary code.
6. **Ponytail:** shortest working diff, YAGNI ladder. No unrequested abstractions. NEVER simplify away: trust-boundary validation, payment verification (server-side + webhooks, never client-trust), data-loss error handling, security (RLS on every table), accessibility.
7. **No pricing decisions.** Anas sets the price — no hardcoded amounts anywhere; the offer's blank-signature pattern carries into the store's price field being admin-set.
8. **No AI/tool mentions** in user-facing copy beyond the one deliberate sentence already in the offer. Saudi colloquial tone. Usage stats stay scrubbed (audit 2026-09-21 confirmed; do not restore).
9. **`_archive/` is dead.** Superseded versions live there, gitignored. Never read or "fix" anything in it.
10. **One writer per file at one time.** Enforced by the lock protocol (§8). No exceptions, including you.

---

## 4. Deliverable: the `PLANS/` folder

Create exactly this structure:

```
PLANS/
  README.md            — index: reading order, how the orchestrator runs, status legend, COVERAGE MATRIX
  00-GROUND-RULES.md   — §3 expanded: RTL checklist, OSS policy, code style, security baseline, a11y/perf budgets
  01-ORCHESTRATOR.md   — the GLM runbook (§7): loop, spawn patterns, audit gate, lock arbitration
  10-PRD-XX-*.md       — one PRD per workstream, numbered, self-contained
  TRACKER.md           — registry: PRD, status, owner agent, files touched, audit verdict
  ISSUES.md            — every issue/decision/deviation discovered during work
  LOCKS.md             — active file locks (§8)
```

**Coverage matrix (in README):** every capability heading from `offer-site-v3/index.html` (the 12 h2 sections + their h3 capabilities) → the PRD that delivers it. Gaps are launch blockers.

### TRACKER.md schema
`| PRD | Status (planned/in-progress/review/done/blocked) | Sub-agent | Files touched | Audit verdict | Date |` — append-only; GLM is the only writer of *Audit verdict*.

### ISSUES.md schema
`| ID | PRD | Severity (blocker/major/minor) | Description | Files | Status (open/fixed/wont-fix) | Resolution |` — every deviation gets an entry. No silent scope changes.

---

## 5. PRD template (every PRD file uses this, verbatim structure)

```markdown
# PRD-XX — <name>
Phase: <الأساس الإنتاجي | لوحة الإدارة | المتجر والدفع | التجربة والإطلاق — copy exactly from §6>
Depends on: <PRD ids or "none">
Offer coverage: <which offer heading(s) this PRD delivers>

## Goal
One paragraph. The outcome, not the tasks.

## Context pointers
- <file>:<lines> — what to read there. (No copying; the source stays authoritative.)

## Scope
In: … / Out: … (explicitly)

## Reuse decision (search-first)
| Need | Candidates considered | Decision (Adopt/Extend/Compose/Build) | Why | License |

## Files
Exact paths this PRD creates or modifies. These are its lock claims.

## Steps
1. **<step>** (file: path) — action, risk (L/M/H), verify-how.

## RTL & responsive requirements
What "correct" means on Arabic RTL mobile/desktop for this PRD.

## Security & data
Trust boundaries, validation points, RLS/permissions touched, payment-verification rules (if any).

## Acceptance checklist (definition of done)
- [ ] … (checkable by running/looking, not by trusting)

## Audit gate
What GLM will check and how (commands, files to diff, visuals to compare).
```

---

## 6. Seed workstreams (you may re-split, but every box must be covered)

Organized by the offer's own four phases. Validate against `offer-site-v3` before finalizing.

**Phase 1 — الأساس الإنتاجي (production foundation)**
- **PRD-00 Research & OSS inventory** — confirm hosting (Vercel vs Cloudflare+OpenNext, $0–low), pick auth/CMS/commerce/PDF building blocks, verify licenses. Feeds everything.
- **PRD-01 Next.js scaffold** — App Router, TypeScript, RTL-first layout, fonts/assets pipeline (subset, preload), CI checks, env/secrets policy.
- **PRD-02 Design system port** — tokens/type/spacing/color from Style Board → app styles; base RTL components.
- **PRD-03 Database schema** — Supabase Postgres: content, articles (draft/preview/published), media, projects/scenes, products & editions, orders, customers, notifications, settings; RLS on every table; migrations.
- **PRD-04 Public pages** — all eight sections from the locked design, responsive, motion per Motion Spec.

**Phase 2 — لوحة الإدارة (the dashboard Anas runs)**
- **PRD-05 Auth & team** — login for Anas, roles/permissions (فريق والإعدادات), session security.
- **PRD-06 Admin: content & blog** — articles/stories editor: write, save draft, preview, publish (المدونة والحكايات).
- **PRD-07 Admin: media library** — upload/organize images (مكتبة الصور), pipelines, alt-text enforcement.
- **PRD-08 Admin: projects, scenes, book & store mgmt, contact inbox, settings** — المشاريع والمشاهد، الكتاب والمتجر، التواصل والخدمات، الفريق والإعدادات.
- **PRD-09 Book section + 3D reader** — book page is visually final; build the reader: renders the **real PDF** like a physical digital book (page-turn physics, cover/spine, spreads desktop / single page mobile). Candidates: **PDF.js** (Apache-2.0) + **page-flip** (MIT); source PDFs in `BOOK_ASSETS/`. Notify-on-availability + pre-order hooks (no live commerce in this PRD).

**Phase 3 — المتجر والدفع (store & payment)**
- **PRD-10 Storefront** — products & editions pages (e-book, signed paper), full Arabic cart & order flow (سلة وطلب عربي كامل).
- **PRD-11 Orders & inventory** — order lifecycle, stock (incl. signed-copy counts), shipping capture, admin order view.
- **PRD-12 Payments** — Moyasar primary (Stream alternative): server-side payment intents, **webhook verification**, receipts, post-sale flow (تأكيد آمن وما بعد البيع): confirmation emails/WhatsApp, e-book delivery, order status. Never trust client for payment success.

**Phase 4 — التجربة والإطلاق (experience & launch)**
- **PRD-13 Contact & services (public)** — تواصل forms, validation, spam protection, feeds admin inbox.
- **PRD-14 Perf, SEO, a11y, analytics** — budgets, meta/OG (Arabic), Lighthouse targets, Core Web Vitals on Saudi mobile networks.
- **PRD-15 Offer site production** — `offer-site-v3` QA + deploy as its own small deliverable. Audit context (2026-09-21, `_archive/offer-site-v1-v2-audit.md`): v3 is the verified superset — don't resurrect old copy; tools sentence at `index.html:1365` stays; usage stats stay scrubbed; `og:image` repoints from `anasaq-offer.pages.dev` to the canonical domain.
- **PRD-16 Deploy & launch** — production hosting, `anasaq.me` domain, cache/redirects, backups, monitoring, smoke tests, launch checklist tied to the coverage matrix.

---

## 7. Orchestration protocol (write into `01-ORCHESTRATOR.md`)

GLM (the orchestrator session) runs this loop and **never edits feature files itself** — it spawns, audits, and arbitrates:

1. **Pick** the lowest-numbered unblocked PRD from TRACKER (phase order is the default sequence).
2. **Lock** its file claims in LOCKS.md.
3. **Spawn** one sub-agent per independent task inside the PRD. Sub-agents get: the PRD path, the ground-rules path, their exact file claims, and their acceptance checklist. Point them at files; do not paste file contents into prompts.
4. **Audit** the result yourself before marking done: read the full diff, run the PRD's verify commands, check the acceptance checklist item by item. Fail → send back with specific findings (max 2 rounds) → still failing → ISSUES.md entry, status `blocked`, move on.
5. **Release** locks, update TRACKER, **then** start the next PRD. Sequential PRDs; parallel sub-agents only within a PRD where files don't overlap.

**Audit bar:** a checklist item passes because you ran/looked, not because the sub-agent said so. Clean code ≠ verified work. Payment/auth/RLS diffs get extra suspicion by default.

---

## 8. Lock protocol (write into LOCKS.md header)

```
| File | Locked by | PRD | Acquired (UTC) |
```

- A sub-agent may open/claim a file only if no active row exists for it.
- Only GLM adds and removes rows (sub-agents request via their completion report).
- Two agents never write the same file in the same instant — overlapping PRDs run sequentially, full stop.
- Stale locks (>24h with no TRACKER activity) are released by GLM with an ISSUES.md note.

---

## 9. Autonomy & escalation

**Decide alone** (record in ISSUES.md): PRD splitting, OSS choice among permissive-license candidates, file layout inside the app, admin UX details, copy matching the tone rules.
**Ask the human first**: any change to the locked design/fonts/visuals, the announced Next.js stack, pricing or commercial terms, domain/DNS changes, anything deleting existing work, any descope of an offer capability.

---

## 10. Definition of done for this planning session

- [ ] `PLANS/` exists with every file in §4; TRACKER seeded with all PRDs at `planned`.
- [ ] **Coverage matrix complete:** every h2/h3 capability in `offer-site-v3/index.html` maps to exactly one PRD — no orphans, no double-owners.
- [ ] Every PRD follows §5 with real file paths, real candidates from actual search, and checkable acceptance lists.
- [ ] Security baseline (RLS, webhook verification, trust boundaries) is explicit in every PRD that touches data or money.
- [ ] 00-GROUND-RULES, 01-ORCHESTRATOR, LOCKS protocol are complete enough that GLM can start PRD-00 with zero further questions.
- [ ] README.md explains the whole system in under one page.

Then stop and hand off to the GLM orchestrator. Do not start building.
