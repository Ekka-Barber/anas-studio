# RESIDUALS-1, round R4a: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, runs the e2e and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against the round's base (the lock's `baseCommit`): `git diff <base>`
plus the untracked files (`git status --short`: the new `src/components/store/CheckoutBody.tsx`). Not yours:
`.claude/launch.json` and `.claude/settings.json` (the owner's: never open them). The writer's brief, with the
orchestrator's decided fixes, is `artifacts/acceptance/RESIDUALS-1/brief-R4a.md` (13 items); each item's evidence is its
block, by id, in `artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md` (STORE-UI-*, QUALITY-06, -07) and
`work/waveB/digest.md` (TEST-UNIT-07); FD-B-01 in `artifacts/acceptance/FABLE-AUDIT/cloud/DEEP-AUDIT.md` and
`PLANS/ISSUES.md` I55 (8); I50 (2) in `PLANS/ISSUES.md`.

## What to verify

1. **Item 1, the checkout's body on demand.** Is the move unchanged apart from what the other items decide (compare
   the body with `git show <base>:src/components/store/CheckoutForm.tsx`)? Does the static export still render the
   checkout page's markup it rendered before (no lost `noscript`, heading or landmark), and does `HoldView`'s own lazy
   import still work from the body? Can the shell's fallback and the body's first render flash two different states?
2. **Each item against its decided fix and its evidence**, and the writer's choices inside the brief. In particular:
   - item 2: no static page left with a loading line that only script ends (read `out/` if it is there: `cart.html`,
     `checkout.html`, `checkout/return.html`), and nothing a buyer with script needs went missing;
   - item 4: the view-only `unknown` state never reaches a reply parser or the function, and every path that draws
     the payment handles it;
   - item 5: the schedule's timers are cleared on every exit (state change, close, unmount, StrictMode's double
     effects), a tick never overlaps a running request, a scheduled ask never moves the focus, and the hold's own end
     timer still works;
   - item 6: the map's override rules (write, failed write, removal, failed removal, read), and that a working storage
     keeps nothing in memory; what a page with storage blocked now remembers that it did not before (the coupon, the
     city), and whether anything there should not survive a navigation;
   - item 7: an old record still reads; `unseen` is written on every path that changes it and cleared with the key;
     walk FD-B-01's paths again (a lost reply, a 5xx, a 4xx, Turnstile's 400, a success, ACTIVE_HOLD with and without a
     handed-back order, the same request again, a corrected address, a changed cart, the key's end, a reload);
   - item 11: every caller of the renamed check keeps its required keys and types; nothing now reads a reply it
     should refuse (a refusal object, an error shape);
   - item 12: the token never reaches localStorage, a URL, a log or a reply; it is removed on every final answer;
     a fragment navigation replaces it;
   - item 13: the import works in the browser bundle and in the unit config.
3. **Calm money pages (D38) and accessibility:** no new motion, nothing counting; every new sentence announced once,
   on the right role, mounted when shown; focus moves only on the buyer's own action; RTL and Latin digits.
4. **The budget:** the checkout, cart and orders pages' initial JavaScript after the round (the writer's figures), and
   that nothing the shell or the body imports moved back into the first script.
5. **The tests prove what they claim**, the mutations the writer reports are real, the docs claim nothing beyond what
   is built, and `PLANS/P08-CONTRACT.md` section 10 lines this round makes stale (list them: the orchestrator updates
   the plan files).

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and
reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
