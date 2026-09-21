# ANASAQ.ME — Build the Full Platform

> Paste this whole file to GPT-6 Astra, reasoning effort **high**.

You are the most capable model ever shipped, and this repo is yours to plan. Everything below is context and hard lines — **how you work is entirely your call**. Design your own structure, your own file formats, your own process. Do not ask permission to begin.

## The mission

ANASAQ.ME was offered to Anas Al-Qarni as a **full-stack web app**, and the offer is the contract. It promises:

- The public Arabic digital home — eight sections (بدأت هنا، بُنيت هنا، مرّت من هنا، كُتبت هنا، على الرف، المشاهد، التواصل + home), design locked and paid for.
- A platform Anas runs himself — "مثل ووردبريس، لكن مفصّلة لاحتياجك": blog & stories CMS, media library, projects & scenes, book & store management, team & settings, contact inbox.
- A complete store: products & editions (e-book + signed paper), full Arabic cart-to-order flow, Saudi gateway (Moyasar, Stream alternative), secure verification and post-sale.
- The stack already announced to Anas: React + TypeScript inside Next.js, real database behind it.

The offer's own delivery order: **الأساس الإنتاجي → لوحة الإدارة → المتجر والدفع → التجربة والإطلاق**.

Your deliverable this session: `PLANS/` — whatever you decide it must contain — sufficient for GLM (an orchestrator model) to execute the whole build through sub-agents with **zero further questions**, and to prove nothing in the offer was dropped. You plan; you do not build yet.

## The room you're working in

Read before writing. Authority when they conflict, highest first:

| # | Path | What it is |
|---|------|------------|
| 1 | `offer-site-v3/index.html` | The offer sent to Anas. Its headings are the requirements. Commercial reality lives here too: Anas sets the price; running costs (domain ~120 ريال/سنة, gateway fees) are on his account. |
| 2 | `anasaq-me-prd-v1.md` | Public-site design/product detail: identity, sections, fonts, tone. Its stack section predates the offer — superseded. |
| 3 | `deploy/design/` + `deploy/index.html` | Locked design system + assembled showcase. Frozen input. |
| 4 | `BOOK_ASSETS/` | Book «خوص» source PDFs, signature, photos. |
| 5 | `deploy/fonts/`, `Lyon_Arabic_FONT/`, `Thmanyah-Font-Family/` | Processed web fonts + licensed originals. |
| 6 | `anasaq-me-full-package.md`, `deliverables/*.docx` | Brand profile; offer as documents (v3 wins contradictions). |
| 7 | `AGENTS.md` | Working-style rules for every agent in this repo. |

Audit note (2026-09-21): v3 is the verified superset of all old versions — don't resurrect old copy; the one tools sentence at `index.html:1365` is deliberate; usage stats and dollar amounts were scrubbed on purpose.

## Skills you must load before planning

Read these files first. They are the user's standing working style — the plan and its execution must follow their principles (adapt the mechanics to your environment):

- `C:\Users\alazi\.agents\skills\ponytail\SKILL.md` — laziest solution that actually works; YAGNI ladder; shortest working diff
- `C:\Users\alazi\.agents\skills\caveman\SKILL.md` — terse conversational output; normal prose in anything persisted
- `C:\Users\alazi\.agents\skills\cavecrew\SKILL.md` — sub-agent delegation patterns with compressed output contracts
- `C:\Users\alazi\.agents\skills\planner\SKILL.md` — planning rigor: exact file paths, dependencies, risks, verifiable steps
- `C:\Users\alazi\.agents\skills\search-first\SKILL.md` — research existing solutions before writing custom code
- `C:\Users\alazi\.agents\skills\karpathy-guidelines\SKILL.md` — simplicity first, surgical changes, goal-driven execution with success criteria

## The bar

Two standards the plan cannot fall below. How you meet them is your call.

1. **Execution-grade detail.** Every workstream names exact files, concrete steps, dependencies, risks, and acceptance criteria checkable by running or looking. Any sub-agent must be able to execute any part of your plan with zero questions and zero access to this conversation. A plan a senior engineer could hand to a team without flinching.
2. **Real deep research for open-source choices.** Every component decision comes from actual investigation — searched, compared on maintenance activity, license, bundle size, security posture, and RTL/Arabic fit, with the evidence and the losing candidates recorded in the plan. No invented candidates, no unexamined defaults, no "popular therefore good". Where you choose to build instead of adopt, the research that justified it is in the plan.

## Hard lines

1. Everything promised in the offer gets built — or escalated to the human. No silent descoping.
2. Arabic-first, RTL-first, mobile-first. Latin digits in Arabic copy. The admin panel is Arabic too.
3. `deploy/design/` is frozen. The book page (كُتبت هنا) is visually final — its only open work is a 3D reader rendering the real PDF like a physical book.
4. Money and trust boundaries are never simplified away: payments verified server-side, data validated at every boundary, access controlled at the database. This is the one place "shortest working diff" does not apply.
5. No prices hardcoded anywhere — Anas sets them. No AI/tool mentions in user-facing copy beyond the sentence already in the offer. `_archive/` is dead; never touch it.
6. When GLM executes: no two agents may ever write the same file at the same time — you decide how that's guaranteed. GLM audits every delivered PRD itself, by running and looking, before moving on — you decide what that gate looks like.
7. Open source before from-scratch wherever it fits; license-safe only.

## Your call, entirely

Folder structure, PRD format, tracking and issue logs, orchestration mechanics, lock mechanism, sub-agent briefs, verification methods, phase splitting, tech choices within the announced stack, hosting within ~$0–low cost. If a decision is yours to make, make it and record it.

Done means: GLM can start executing from your plan alone, and you can show — your way — that every capability in the offer is covered.

Then stop. Hand off.
