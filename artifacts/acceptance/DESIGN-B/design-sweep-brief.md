# Design sweep: brief for the fresh session

Written 2026-09-28 after the design-skill audit. This is the contract for a full, deep audit of everything related to styles and design on branch `agent/design-b` (DESIGN-B, D39).

**Primary skill: tasmeem** (github.com/Ekka-Barber/tasmeem, installed at `~/.claude/skills/tasmeem`). The owner commissioned it for this sweep; it merges the skills listed below into one catalog. Start only once the owner calls it ready. Then:
- run `tasmeem.mjs context --target .`, then `/tasmeem audit`, with brand exceptions in `DESIGN.md` for D39's palette and Thmanyah fonts;
- use the per-skill phases below only as cross-checks where tasmeem marks a tell as judged (`eye`).

## Who does the work

The orchestrator (Opus) does all of it: no sub-agents, no workflows, no glm-worker. The same applies to skill features that dispatch agents (impeccable's plugin agents, improve-ui or improve-animations "plans for another agent"). Those plans are written for this session to execute itself.

## Read first

1. `DESIGN.md`: the design system, the source of truth.
2. `PRODUCT.md`: the brief.
3. `PLANS/DESIGN-AUDIT.md`: the D39 recheck.
4. `PLANS/HANDOFF.md`: the top section.

## Project rules that override skill defaults

Several skills flag this project's deliberate choices as "AI defaults". Report them as **brand exceptions**, not findings, unless a specific use is off-token or broken.

- **Anas's own palette (D39).** Sand, aub, coral and saffron are his colours, not a model default. This overrides:
  - impeccable's cream/sand body-colour rule;
  - taste's premium-consumer palette ban;
  - avoid-ai-design SD1 (cream + terracotta);
  - frontend-design's cluster (1).
- **Thmanyah fonts only (D33).** The serif for display is Anas's brand; serif-ban defaults do not apply.
- **The words are Anas's.** Room texts, the poem, taglines and everything in `src/content/` stay exactly as he wrote them; never rewrite them. Copy checks (antislop-copywriting, the em-dash rules) apply only to interface text we wrote: labels, buttons, errors, empty states, `aria-label`s and metadata.
- **Stack (D04).** CSS Modules plus global tokens, with no Tailwind, no shadcn and no motion library. Translate advice written for those tools, or drop it.
- **Truthful states.** Add no placeholders and no forms without a backend (sign-ups arrive in P08, booking in P09, the reader in P02).
- **Arabic.** No letter-spacing and no italics on Arabic. Arabic body text has a line height of at least 1.6. One digit system per view.
- **Installs and project files:**
  - Do not install impeccable hooks (`npx impeccable install`).
  - Do not let antislop's wizard edit `CLAUDE.md`.
  - Write every report under `artifacts/acceptance/DESIGN-B/`, never `anti-slop/` at the root.
- **Lock and commits.** The DESIGN-B lock is still held, and every fix must stay inside its allowlist. Commit only when the owner asks.
- **Memory before e2e.** Check free memory before any full e2e or visual run: it crashed at about 6 GB free.

## Phase 1: deterministic scans (evidence first)

1. **Source scan with avoid-ai-design.** Run:
   ```sh
   node ~/.claude/skills/avoid-ai-design/scripts/detect.mjs src/styles src/components src/app
   ```
   The baseline on 2026-09-28 was 4 × P1 SD5 ("one word accented in the headline"):
   - `BookView.tsx:45`
   - `HomeView.tsx:35`, the name bands. Probably deliberate; judge it.
   - `Lost.tsx:18`
   - `app/(public)/error.tsx:15`
2. **Built-HTML scan with Gesso anti-slop (73 detectors).** First run `pnpm build`, then:
   ```sh
   npx -y @gessobuild/anti-slop check out --json --marketing
   ```
   The CSS lives in external files (`out/_next/static/css`), so the style checks only give a lower bound. For full coverage, scan a scratch copy of `out/` with the CSS inlined.
3. **Impeccable engine.** Run `~/.claude/skills/impeccable/scripts/impeccable context`, or `impeccable.cmd` under cmd. The first run downloads the engine `engine-v0.1.6` from GitHub releases; it checks the SHA-256 and refuses the file if it doesn't match. Then follow `reference/audit.md` and the detector it describes.
4. **Contrast.** For every tone's text/background pair (`DESIGN.md` lists them), run:
   ```sh
   python ~/.claude/skills/antislop-human/contrast-check.py "#fg" "#bg"
   ```
   Exit code 0 means the pair passes 4.5:1.

## Phase 2: judged audits (read-only, one pass each)

| # | Skill | Scope |
|---|---|---|
| 5 | `/impeccable critique`, then `/impeccable audit` | Every public page, the store pages, the admin look |
| 6 | `/hallmark audit` | Pages and CSS: 57 slop gates, drift from `DESIGN.md`, structural fingerprint |
| 7 | `/web-design-guidelines` | `src/**/*.tsx` and `src/**/*.css` against Vercel's Web Interface Guidelines |
| 8 | `/antislop` mode 2 ("after"), with `antislop-ui`, `antislop-human`, `antislop-layoutmobile` and `antislop-copywriting` (our text only) | Numbered findings |
| 9 | `/designing-arabic-frontends` | RTL, bidi, digits, Arabic type |
| 10 | `/review-animations` and `/fixing-motion-performance` | `motion.css`, `motion.ts`, scroll timelines, reduced motion |
| 11 | `/fixing-accessibility`, `/accessibility`, `/web-quality-audit`, `/core-web-vitals` | Accessibility, and Lighthouse on the static export |
| 12 | `/make-interfaces-feel-better`, `/baseline-ui` | Polish details: optical alignment, shadows, states, tabular numbers |

For visual evidence, use Playwright captures at 360, 768, 1024 and 1440 (the scratchpad `shots.mjs` pattern) and one no-JS pass.

## Phase 3: one report, then fixes

1. Merge every finding into `artifacts/acceptance/DESIGN-B/sweep-findings.md`. Each finding gets:
   - a number;
   - its source skill;
   - `file:line`;
   - a severity (P0 to P3);
   - a "brand exception?" column.

   Deduplicate across skills.
2. The owner picks the numbers to fix. Nothing unpicked is touched.
3. Fix, then re-run Phase 1 and the checks in `artifacts/acceptance/DESIGN-B/commands.txt`: `pnpm check`, the build and budgets, the public, visual and CMS e2e suites, and `stuck.mjs`.
