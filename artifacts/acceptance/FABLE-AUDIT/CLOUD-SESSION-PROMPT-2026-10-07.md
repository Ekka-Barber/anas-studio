# Takeover prompt — paste into the new cloud Claude session (Claude Opus 5.5 at effort max)

Everything between the horizontal rules is the prompt. The session that receives it runs
**Claude Opus 5.5 at effort max** — that model and effort are the owner's choice and must be
named by the session itself in anything it records about its own role.

---

You are taking over the ANASAQ (anas.studio) build as **Claude Opus 5.5 at effort max**, working
cloud-side, directly off the GitHub repo (`Ekka-Barber/anas-studio`, branch `main`). You have NO
access to the owner's local machine: no local Supabase Docker stack, no local database, no local
Playwright, none of the local evidence folders. CI is your verifier. The owner set this standing
arrangement on 2026-10-07 (recorded as D48 in `PLANS/DECISIONS.md`).

**Why a takeover.** The previous session — the FABLE-AUDIT deep audit, orchestrated by Claude
Fable 5.1 — died at the account-wide weekly usage limit on 2026-10-07 at 18:30 Riyadh, right
after pausing at the end of fix round M2 and entering a context compaction it never came out
of. It is NOT being resumed; its account is exhausted for the week. Its work was verified,
committed and pushed by a packaging agent at the owner's request; everything you need to
continue is in the repo. Do not try to contact or resume the dead session; do not trust its
claims beyond what the handoff verified — verify what you rely on.

## 1. Kickoff ritual (this repo's own, then the handoff)

In this order, before any edit:
1. Read `AGENTS.md`, `CLAUDE.md`, `PLANS/README.md`, and `PLANS/KICKOFF.md` (the session
   kickoff). Obey them: they override your defaults. Note `PLANS/` is the plan of record,
   decisions in `PLANS/DECISIONS.md` are settled, `_archive/` and `deploy/design/` are
   off-limits, secrets only via environment.
2. Read the "Current state" and "Next work" sections of `PLANS/EXECUTION-STATUS.md` (they still
   describe the P08 pause — the audit's plan-file round that would update them has not run
   yet; that round is yours, near the end).
3. Read `artifacts/acceptance/FABLE-AUDIT/STATE.md` — its **newest "Update" section first**
   (the packaging agent's ~22:55 Riyadh update, then the dead session's "~19:20" one, which
   was actually written at 18:30 Riyadh; the label is off, the content is true).
4. Read `artifacts/acceptance/FABLE-AUDIT/HANDOFF-2026-10-07.md` **in full**. It is the
   authoritative record: how the session died, every claim of its last words verified against
   the tree and the database, the per-round state, every known red, the database state, the
   resume chain, and the archaeology pointers.

## 2. Your work, in order (unchanged from the dead session's plan)

1. **Round F3** from `artifacts/acceptance/FABLE-AUDIT/work/briefs/brief-F3.md` (17 items).
2. **D1** (`brief-D1.md`), then **S** (`brief-S.md`), then **D** (`brief-D.md`).
3. The plan files: `PLANS/EXECUTION-STATUS.md` (Current state, Next work, a FABLE-AUDIT
   section), `PLANS/ISSUES.md` (the new items and the corrections listed in the rulings and
   `work/report-notes.md`), `PLANS/HANDOFF.md`, `PLANS/DECISIONS.md` (nothing closes; the
   owner's open decisions are listed in `work/report-notes.md`). While there, formalize D48
   properly in your own words.
4. The after-battery and **REPORT.md** — see the founder questions below; their answers decide
   how much of the battery can run cloud-side.

Known reds you inherit (details and verbatim text in HANDOFF §8; fix them as part of their
named rounds, never by widening a gate):
- The order view's «تصحيح بيانات الشحن» button still calls `fulfillment_update`
  (`src/components/admin/OrderView.tsx:264`; the button label is at `:817`), which M2 now
  refuses with BAD_TRANSITION for shipped lines. `public.fulfillment_correct` exists in the
  database with no caller. **F3-4 is this fix.** Do it first inside F3.
- `refund_request`'s STALE check, `cron_failures_recent()` and `outbox_close()` have no caller
  until F3 (F3-2, F3-15, F3-16b).
- `deno check` on F1's Edge Function edits and `check:budgets` after F2b run for the first
  time in CI on the packaging push — a red there is real; fix forward.
- The rich-text link rule accepting `http://`/`mailto:` is a deliberate intermediate state;
  F3-11 restores exactly lowercase `https://` with a host.
- The baseline e2e/unit reds under load (HANDOFF §8 item 4) are for the after-battery to
  re-adjudicate on a quiet machine — not yours to re-litigate in CI.

Masking order when CI is red: read the failure; if it is one of the known reds above, fix it
in its named round; if it is a new code failure, fix it properly (smallest change that removes
the cause); if it is gate mechanics or environment (runner, timeouts, flake), say exactly what
happened with the verbatim error and ask the owner before touching the gate itself. Never
weaken an assertion, never add an allowlist entry on your own, never mark unfinished work
verified.

## 3. The cloud verification loop (your only loop)

Edit → fast local checks that need no database (`pnpm lint`, `pnpm typecheck`, `pnpm test` —
unit only; **never** `pnpm test:db`, `test:e2e`, `supabase *`, `docker *`, `pnpm db:*` — they
need the local stack you do not have) → commit → push → `gh run watch` / `gh run view
--log-failed` → read the failures verbatim → repeat. CI (`.github/workflows/ci.yml`) runs on
every push to every branch: lint, typecheck, unit, frozen-design, copy rules, `deno check` of
every Edge Function, then its own Supabase stack from a **fresh migration replay** (proving
every migration including M1a/M1b/M2 from scratch), content import, static export,
export/budget checks, and every database integration file that needs no served Edge Function
(the eight HTTP files that need the edge runtime are local-only by design, as are the
Playwright suites). `vitest.config.ts` refuses a non-local database — do not try to point it
anywhere else.

Adapt the briefs, don't obey them blind: they were written for the dead session's Windows
machine. Their `REPO:` paths are local Windows paths — translate to your checkout. Their
verification commands mention `docker restart supabase_edge_runtime_ANASAQ.ME`,
`TEST_ENV=local DATABASE_URL=…` integration runs and one-spec Playwright runs — none of that
exists for you; the equivalent proof is the CI loop above. Never run
`artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-db.sh` or `battery-e2e.sh` (local-stack
scripts). The items themselves (what to change, in which files, with which exact Arabic copy)
stand as written.

Dispatch discipline: keep the repo's rules — one writer at a time, briefs with exact paths,
fresh worker per round, the auditor independent of the writer, model and effort named on every
dispatch (D45 lineage; under D48 the orchestrator is you, Opus 5.5 at effort max). The audit's
worker dispatch scripts (`work/scripts/fix-worker.js`) were built for the dead machine's
workflow tooling — reproduce their effect with your own sub-agent mechanism; do not try to run
them.

## 4. Warnings that outlive the handoff

- **Migrations are append-only.** Never edit or delete `supabase/migrations/*`; supersede with
  a new numbered file. The three `20261007*` files are now history — treat them as immutable.
- **Money or permission ambiguity is a stop-and-ask**, not a guess. No invented prices,
  approvals, payments or gate closures; E-gates stay open until their named evidence exists.
- **Report gates red as red**, with verbatim output. A clean-looking run that skipped a step
  proves nothing.
- **The local machine's database is not yours.** It sits at the M2 reset with demo data; CI's
  database is ephemeral and unrelated. Any future LOCAL gate (owner's machine) begins with
  `supabase db reset` at the owner's word — never assume the two databases agree.
- The lock file `.anasaq-execution.lock` exists only on the dead machine (held, paused,
  gitignored). You cannot see it. Record the lock recovery in your state per CLAUDE.md's
  ritual, using the HANDOFF as the proof that its owner stopped and the diff was inspected;
  when the owner next works locally, the file should be released there.
- Secrets only through environment variables; never read, print or commit `.env*`. The repo's
  evidence folders were secret-scanned before publishing — keep them that way.
- In this project's tracking files, attribute honestly: your entries say who you are (the
  cloud continuation session, Claude Opus 5.5 at effort max, under D48) and when.

## 5. Founder questions — ask the owner BEFORE work begins

1. **Browser/screen verification with no local stack.** The briefs' UI items (F3-3, F3-5…F3-10,
   D1) were verified with Playwright and screenshots on the local machine; you have neither.
   Options: (a) a CI job that runs headless browser checks (the Playwright suites exist but
   need Mailpit + the Moyasar emulator — a real engineering decision, not free); (b) the owner
   runs named specs/screenshots locally on your request; (c) UI verification is deferred to a
   later local pass and you mark those items built-not-visually-verified. Which does the owner
   want?
2. **The after-battery's "quiet machine".** The dead plan demands the full battery
   (`battery-db.sh`, `battery-e2e.sh`, `pnpm test`) on a quiet machine — that is the owner's
   machine. Same choice as (1): schedule it with the owner, or define a CI equivalent now?
3. **Your push policy.** D42 made `main` the only branch and the repo's sessions committed to
   it directly under the owner's eye. Confirm: do you commit and push `main` directly (the
   packaging agent was authorized once, for the packaging only), or work on short-lived
   branches merged on green CI?
4. **Anything new on E02 (Moyasar keys)?** It was blocked when the session died; if keys have
   arrived, the runbook's "When the Moyasar keys arrive" section changes the near-term plan.

## 6. Before you begin

State, in your first reply: what you understood the situation to be, what you will do first
(after the founder questions are answered or explicitly deferred by the owner), and what you
will NOT do. Then start. Stop with evidence; short reports; when a session gets long, record
the state and continue in a new session — that is how the last one stayed recoverable.

---
