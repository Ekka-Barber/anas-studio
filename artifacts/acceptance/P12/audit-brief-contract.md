# P12, the contract: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only, before any worker round (as P08's contract had at its
checkpoint 1). The orchestrator (Claude Opus 5.5, effort max) wrote `PLANS/P12-CONTRACT.md` (version 1, 2026-10-16) and
rules on your findings.

## What to audit

`PLANS/P12-CONTRACT.md` against:
- the decisions: `PLANS/DECISIONS.md` D22, D40, D49, D50 and D52 (the owner's answers of 2026-10-16), and ISSUES I52;
- the design the owner was shown: `artifacts/acceptance/P12/comp/index.html` and its pictures beside it;
- the code it touches: the staff model and roles (`supabase/migrations/20260924130000_staff_and_app_server.sql` and
  every later use of `public.current_staff_role()` and of the role lists in `supabase/functions/staff-admin/index.ts`,
  `supabase/functions/_shared/staff.ts`, `src/components/admin/AdminShell.tsx`, `src/components/admin/TableList.tsx`,
  `src/components/admin/TeamView.tsx`), the admin's design rules (DESIGN.md section 10, `admin.module.css`), the static
  export's constraints (`next.config.*`, how the admin's existing `?id=` routes are built), and how earlier contracts set
  their SQL rules (`PLANS/P08-CONTRACT.md`, its rules at the top).

## What to verify

1. **Authorization is complete and tight.** For every function in section 4, and every role (anon, `editor`,
   `operations`, a `board` person not on the project, `viewer`, `member`, owner), is the answer decided and right?
   Does adding the `board` value to `public.staff_role` widen anything outside the board (a policy or function that
   treats any staff role as enough, an Edge Function action, the Auth hooks, the team screens)? Name each place.
2. **The data model holds:** positions, the lock order, versions and `STALE`, the limits, deletes and archives,
   removal and deactivation, the link to content (can it leak a draft's title to someone who may not see drafts?), the
   done column's rule, the overview's definitions (are they computable exactly from the rows and the activity?).
3. **Privacy:** what a `viewer` or `member` can learn about other staff (names, emails) or other projects; the CSV;
   the activity's content.
4. **The screens:** the right-to-left keyboard mapping, touch versus scroll, the phone's single column, the dialog's
   stale save, every state; anything in the comp the contract does not cover, or the reverse.
5. **Feasibility:** `@dnd-kit` with this repository's React and Next versions (read `package.json`), its accessibility
   features (keyboard sensor, announcements) on a right-to-left page; the static export with `?id=` routes; the
   migration that adds an enum value (transactions).
6. **Scope:** anything D22, D50 or D52 asks for that the contract leaves out, or anything it adds that they exclude.
7. **The words** (section 7): Arabic correctness (hamza, agreement, plurals), consistency with the admin's existing
   words, no calques.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command. `git`, `grep` and reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), the contract's
section and line, the evidence it rests on (file:line), and a concrete change to the contract. Then the open questions
that only the owner can answer, if any. Short and exact.
