# Master Prompt for GPT-6 Astra — ANASAQ.ME Production Plan

> **How to use:** paste this entire file as the first message to GPT-6 Astra in the ANASAQ.ME repo, with reasoning effort set to **high**. It is self-contained: mission, context pointers, ground rules, deliverable contract, and process. Do not ask clarifying questions before starting — the pointers below answer them. Bias to action: infer intent, act, record assumptions in `PLANS/ISSUES.md`.

---

## 1. Mission

You are planning and then orchestrating the build-out of **ANASAQ.ME** to production. The repo contains two shippable surfaces:

1. **The Digital Home** (`anasaq.me`) — Anas Abdullah Al-Qarni's Arabic-only, fully-RTL personal site. Design is **locked** (Claude Design handoff), stack is **locked**. PRD v1 exists.
2. **The Offer Site** (`offer-site-v3/`) — the commercial offer page (Saudi colloquial copy, Moyasar + Stream payment copy, print-only contract document).

Your job in this session is **not** to build. It is to produce `PLANS/` — a multi-file, execution-ready plan — and then hand it to the GLM orchestrator loop described in §7. Every PRD must be executable by a sub-agent with no access to this conversation.

---

## 2. What you already have (read these before writing anything)

Read via pointers, never assume. Authority order when documents conflict (highest first):

| # | Path | What it is |
|---|------|------------|
| 1 | `anasaq-me-prd-v1.md` | **Single source of truth**: product, stack, fonts, interactions, open questions (§18) |
| 2 | `AGENTS.md` | Working style rules for all agents (ponytail/caveman) |
| 3 | `deploy/design/*.dc.html` + `deploy/design/support.js` | Locked design system: Style Board, Motion Spec, Responsive Frames, scene files (المشاهد، بدأت هنا، بُنيت هنا، مرّت من هنا، كُتبت هنا، على الرف، تواصل) |
| 4 | `deploy/images/` | Final optimized webp/svg assets (khous series, world series, signature) |
| 5 | `anasaq-me-full-package.md` | Brand & psychological profile, design brief |
| 6 | `offer-site-v3/index.html` | Latest offer-page build (audited; Latin digits, no pricing, print contract doc) |
| 7 | `Lyon_Arabic_FONT/`, `Thmanyah-Font-Family/`, `offer-site-v3/assets/fonts/` | Licensed fonts already in use |
| 8 | `BOOK_ASSETS/` | Book «خوص» source PDFs, Anas's signature, photos — input for PRD-04's PDF reader |

Also skim `graft/INDEX.md` and run `graft map` if available; it indexes the repo.

**Do not duplicate content from these files into PRDs.** Point to file:line. PRDs stay short because the sources stay authoritative.

---

## 3. Ground rules (non-negotiable)

1. **Arabic-first, RTL-first.** Every layout decision starts `dir="rtl"` `lang="ar"`. Latin digits in Arabic copy. LTR only where technically required (code, URLs). Responsive is an acceptance criterion, not a phase: mobile ≈70% of Saudi traffic.
2. **Design system is frozen.** `deploy/design/` is an input, never an output. No agent edits it. Tokens, type scale, motion curves come from the Style Board / Motion Spec — reference them, don't reinvent them.
3. **Open source before from-scratch** (search-first policy). For every component, the owning PRD must record the decision: *Adopt* (use as-is) / *Extend* (wrap) / *Compose* (combine small libs) / *Build* (only if nothing suitable). License, maintenance, and bundle-size must be checked. The stack is deliberately light (vanilla JS + CSS + IntersectionObserver) — do not introduce React or a framework without flagging it as a deviation in `PLANS/ISSUES.md` first.
4. **Ponytail:** shortest working diff, YAGNI ladder (skip unneeded → stdlib → native platform → existing dep → minimal code). No unrequested abstractions. Never simplify away: trust-boundary validation, data-loss handling, security, accessibility.
5. **No pricing decisions.** Anas sets prices — pages never hardcode them.
6. **No AI/tool mentions** anywhere in user-facing copy. Saudi colloquial tone, no filler.
7. **One writer per file at one time.** Enforced by the lock protocol (§8). No exceptions, including you.
8. **Deployed design = visual baseline.** `deploy/` is deployed only to show Anas and collect his confirmation; its photos, copy, and layout are near-final. Do not restyle them. The book page (كُتبت هنا) is visually **final** — the only book work allowed is the reader itself (PRD-04).
9. **`_archive/` is dead.** Superseded versions (old offer sites, original handoff) live there, gitignored. Never read, reference, or "fix" anything in it.

---

## 4. Deliverable: the `PLANS/` folder

Create exactly this structure:

```
PLANS/
  README.md            — index: reading order, how the orchestrator runs, status legend
  00-GROUND-RULES.md   — §3 above expanded: RTL checklist, OSS policy, code style, a11y/perf budgets
  01-ORCHESTRATOR.md   — the GLM runbook (see §7): the loop, spawn patterns, audit gate, lock arbitration
  10-PRD-XX-*.md       — one PRD per workstream, numbered, self-contained
  TRACKER.md           — registry of every PRD: status, owner agent, files touched, audit verdict
  ISSUES.md            — every issue/decision/deviation discovered during work
  LOCKS.md             — active file locks (§8)
```

### TRACKER.md schema

`| PRD | Status (planned/in-progress/review/done/blocked) | Sub-agent | Files touched | Audit verdict | Date |`

Append-only during a run; GLM is the only writer of *Audit verdict*.

### ISSUES.md schema

`| ID | PRD | Severity (blocker/major/minor) | Description | Files | Status (open/fixed/wont-fix) | Resolution |`

Every deviation from a PRD or ground rule gets an entry. No silent scope changes.

---

## 5. PRD template (every PRD file uses this, verbatim structure)

```markdown
# PRD-XX — <name>
Depends on: <PRD ids or "none">

## Goal
One paragraph. The outcome, not the tasks.

## Context pointers
- <file>:<lines> — what to read there. (No copying; the source stays authoritative.)

## Scope
In: …
Out: … (explicitly)

## Reuse decision (search-first)
| Need | Candidates considered | Decision (Adopt/Extend/Compose/Build) | Why | License |

## Files
Exact paths this PRD creates or modifies. These are its lock claims.

## Steps
1. **<step>** (file: path) — action, risk (L/M/H), verify-how.

## RTL & responsive requirements
What "correct" means on Arabic RTL mobile/desktop for this PRD.

## Acceptance checklist (definition of done)
- [ ] … (must be checkable by running/looking, not by trusting)

## Audit gate
What GLM will check and how (commands, files to diff, visuals to compare).
```

---

## 6. Seed workstreams (you may re-split, but every box must be covered)

Validate against PRD v1 before finalizing; merge/split as evidence dictates:

- **PRD-00 Research & OSS inventory** — confirm stack, list adopt/extend candidates per component, verify licenses. Feeds all later PRDs.
- **PRD-01 Build scaffold & pipeline** — repo layout for the digital-home build, fonts/assets pipeline (subset, preload, `font-display`), CI checks.
- **PRD-02 Design tokens → CSS** — variables, type scale, spacing, color from Style Board; base RTL stylesheet.
- **PRD-03 Structure & navigation** — sections بدأت هنا / بُنيت هنا / مرّت من هنا / كُتبت هنا / على الرف / المشاهد / تواصل, header, footer, scroll behavior.
- **PRD-04 Book reader & notify-me** — the book page (كُتبت هنا، «خوص | حكايات شارع 4») is visually final in the deployed design: keep its photos, copy, and layout untouched. The only visual/UX work is the reader: replace it with a 3D reader that renders the **real PDF** like a physical digital book (page-turn physics, cover + spine feel, spread on desktop / single page on mobile). Reuse-first candidates: **PDF.js** (render actual PDF pages, Apache-2.0) + **page-flip** (3D flip engine, MIT); source PDFs live in `BOOK_ASSETS/`. Plus notify capture (Supabase) and V2 pre-order hooks (UI only, no live commerce).
- **PRD-05 Scenes gallery** — المشاهد, image pipeline, lazy loading.
- **PRD-06 Contact** — تواصل, form + validation + spam protection, Supabase backend.
- **PRD-07 Motion** — fade-and-rise reveals per Motion Spec, IntersectionObserver, `prefers-reduced-motion`.
- **PRD-08 Offer site production** — `offer-site-v3` final QA, og:image fix, docx contradiction check (12,500 figure), deploy. Audit context (2026-09-21, see `_archive/offer-site-v1-v2-audit.md`): v3 is a verified superset of v1/v2 — do not resurrect old copy. The tools sentence at `index.html:1365` (Claude/Codex/Higgsfield one-liner) is a deliberate keep; usage stats and dollar amounts were scrubbed on purpose — restore neither. `og:image` points at the `anasaq-offer.pages.dev` preview deployment; repoint to the canonical domain at deploy.
- **PRD-09 Perf, SEO, a11y, analytics** — budgets, meta/OG, Arabic SEO, Lighthouse targets.
- **PRD-10 Deploy** — Cloudflare Pages + R2 + Supabase free tier, domain, redirects, cache headers, smoke test.

---

## 7. Orchestration protocol (write into `01-ORCHESTRATOR.md`)

GLM (the orchestrator session) runs this loop and **never edits feature files itself** — it spawns, audits, and arbitrates:

1. **Pick** the lowest-numbered unblocked PRD from TRACKER.
2. **Lock** its file claims in LOCKS.md.
3. **Spawn** one sub-agent per independent task inside the PRD. Sub-agents get: the PRD path, the ground-rules path, their exact file claims, and their acceptance checklist. Point them at files; do not paste file contents into prompts.
4. **Audit** the result yourself before marking done: read the full diff, run the PRD's verify commands, check the acceptance checklist item by item. Fail → send back with specific findings (max 2 rounds) → still failing → ISSUES.md entry, status `blocked`, move on.
5. **Release** locks, update TRACKER, **then** start the next PRD. Sequential PRDs; parallel sub-agents only within a PRD where files don't overlap.

**Audit bar:** a checklist item passes because you ran/looked, not because the sub-agent said so. Clean code ≠ verified work.

---

## 8. Lock protocol (write into LOCKS.md header)

```
| File | Locked by | PRD | Acquired (UTC) |
```

- A sub-agent may open/claim a file only if no active row exists for it.
- Only GLM adds and removes rows (sub-agents request via their completion report).
- Two agents never write the same file in the same instant — if a PRD's file set overlaps another active PRD, the PRDs run sequentially, full stop.
- Stale locks (>24h with no activity in TRACKER) are released by GLM with an ISSUES.md note.

---

## 9. Autonomy & escalation

**Decide alone** (record in ISSUES.md): PRD splitting, OSS choice among permissive-license candidates, file layout inside the build target, copy edits matching the tone rules.
**Ask the human first**: any change to locked stack/design/fonts, new framework, pricing or commercial terms, domain/DNS changes, anything deleting existing work.

---

## 10. Definition of done for this planning session

- [ ] `PLANS/` exists with every file in §4, schemas populated (TRACKER seeded with all PRDs at `planned`).
- [ ] Every seed workstream from §6 is covered by exactly one PRD (merged/split is fine; gaps are not).
- [ ] Every PRD follows §5, has real file paths, real candidates from actual search, and a checkable acceptance list.
- [ ] 00-GROUND-RULES, 01-ORCHESTRATOR, LOCKS protocol are complete enough that GLM can start PRD-00 with zero further questions.
- [ ] README.md explains the whole system in under one page.

Then stop and hand off to the GLM orchestrator. Do not start building.
