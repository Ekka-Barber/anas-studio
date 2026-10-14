# FABLE-AUDIT's local close: the prompt for a Claude Code session on the owner's machine (2026-10-14)

Written by the cloud continuation's orchestrator (Claude Opus 5.5 at effort max, under D48) on 2026-10-14, at the owner's
request: "provide full prompt to run it locally in claude desktop / make it perfect , and useing workflow workers". It runs
everything FABLE-AUDIT and P08 still need from his machine, with the Workflow tool's workers and auditors, and then stops.

## For the owner: how to start

1. Start Docker Desktop and wait until it says it is running. Close heavy apps (browsers with many tabs, games, other
   builds) and any other Claude or ZCode session: the e2e battery needs a quiet machine with at least 10 GB of free
   memory, and the 2026-10-05 battery failed under load.
2. In Claude Desktop, open the Code tab on the folder
   `C:\Users\alazi\Downloads\Tech\Code\My_projects\not shipped yet\ANASAQ.ME`, choose Opus 5.5 and the highest effort
   (max), and allow it to run commands in that folder.
3. Paste the short prompt at the end of this file ("The paste prompt"). It makes the session fetch and read this file and
   follow it.
4. It takes about four to six hours, most of it the e2e battery, more if something fails and needs a fix. The session
   asks you at the start (your word on the paused local lock, on your other project's Supabase stack if it runs, and on
   resetting the local database: D48) and at the end (`main` and the acceptances). It also stops and asks if a fix would
   touch money, permissions or a migration.

Only you can do these, whenever you like: revoke and reissue the Supabase personal access token that was partly printed
(REPORT.md section 6); mark the admin redesign's review page (https://claude.ai/artifact/HGPZcH9NEvzAQ7Nz73sheK); tap the
admin's strip on your phone and click it with a mouse in a window about 1024px wide (the last proof of AD-F1, ISSUES I55
(6)); answer the open decisions in `PLANS/DECISIONS.md`.

---

## 0. Who you are and what this is

You are the orchestrator of **FABLE-AUDIT's local close**: Claude Code on the owner's Windows machine, in Claude Desktop,
running **Claude Opus 5.5 at effort max**. If the session runs another model or a lower effort, tell the owner before
anything else. Your workers run **Sonnet 5.5 at effort max**; your auditors and reviewers run **Opus 5.5 at effort max**;
a hard fix escalates to an **Opus 5.5 writer at effort xhigh** (the owner's "(opus 5.5 utracode effort)", which D48 (4)
records as D45 read it), and its diff still gets a fresh Opus auditor. The owner has asked for workflows: use the
Workflow tool for every worker and auditor (section 3).

The work, in order, is FABLE-AUDIT's last part and P08's acceptance battery ("Next work" items 2 and 3 in
`PLANS/EXECUTION-STATUS.md`):
1. the after-battery's database and e2e parts on this machine, from a fresh `supabase db reset` on the owner's word;
2. adjudicating every red and fixing what is in scope, with proof;
3. the backup rehearsal with a paid file (ISSUES I53 (3)) and round S's other owner-machine proofs (`cloud/S.md`);
4. the visual pass of every screen rounds F3 and D1 changed (ISSUES I55 (1));
5. the records, audited; a commit and push to the branch with CI green;
6. the owner's questions (`main`, P08, the admin redesign, FABLE-AUDIT); then stop.

Where things stand (2026-10-14): `main` is at `6ae9c7b`; the branch `claude/amazing-planck-qv3f7a` is ahead of it by
records and by this file and its helper scripts only; no product code, test or migration changed since `b3fa932`, the
commit CI verified on `main` (run 38548605552). The cloud continuation released its lock when it pushed this file
(`PLANS/EXECUTION-STATUS.md`, Lock row). On this machine, `.anasaq-execution.lock` still holds FABLE-AUDIT's local lock,
paused on 2026-10-07T15:30:06Z by the Fable 5.1 session that died at the usage limit, with ZCode's closed RATIFY round of
2026-10-08 in it. Paths below are relative to the repository root unless they start with `~` or a drive; the short ones
(`after/`, `before/`, `cloud/`, `work/`, `ratify-e800fc5/`, `REPORT.md`, `STATE.md`, `HANDOFF-2026-10-07.md`) are in
`artifacts/acceptance/FABLE-AUDIT/`.

## 1. Read first, in this order

Before reading anything else, run Phase 0's git steps: the status, the fetch, the switch to
`claude/amazing-planck-qv3f7a` with its fast-forward, and the proof that no code changed. This checkout is probably
still on `cloud-ratify` (`e45abed`), where the owner's agent left it on 2026-10-08, and there `REPORT.md`, the helper
scripts and the current records do not exist. Those steps change only the checked-out branch.

1. `AGENTS.md`, `CLAUDE.md`, `PLANS/README.md`, `PLANS/KICKOFF.md`. They override your defaults; this file adds to them.
2. `PLANS/EXECUTION-STATUS.md`: "Current state", the "FABLE-AUDIT" section, the ledger rows FABLE-AUDIT, P08 and
   ADMIN-DESIGN, "Next work" items 2 and 3.
3. `PLANS/HANDOFF.md`: "Local stack", "How sessions run", "Branches", "Rules to keep".
4. In `artifacts/acceptance/FABLE-AUDIT/`: `STATE.md` (newest update first), `REPORT.md` sections 4 and 5,
   `HANDOFF-2026-10-07.md` sections 1 to 3, 5 and 6 (D48: the owner's paused local lock "is released on his machine once
   he has read the handoff"), and `ratify-e800fc5/RECORD.md` (how this machine ran the battery on 2026-10-08).
5. This whole file. After any context compaction, read it again with `after/RECORD.md` (your progress log, Phase 1).

Read logs with `grep` and `tail`, never whole: the e2e logs run to thousands of lines.

## 2. Rules that hold for the whole session

Never break these. When one is in the way, stop and ask the owner.

- **The owner's rule:** "MAKE SURE CARFUL WORK ALWAYS DONE NOTHING TO BE BREAK AT ALL".
- **One writer, under the lock.** Record every path in the lock before writing it. Never two writers at once, and no
  agent at all while a battery part, a re-run or the capture runs. Preserve the owner's own uncommitted files
  (`.claude/launch.json` and `.claude/settings.json`, dirty since 2026-10-03; his `.claude/settings.json.tmp` is
  git-ignored): never stage, stash, reset, clean or overwrite them.
- **Every stop.** Whenever you stop before Phase 10, first start again any container you paused (Phase 10, first bullet).
  Once you hold the lock (Phase 1), record where the run stopped in `after/RECORD.md`; before that, write nothing.
- **Secrets.** Never read or print `.env`, `.env.*` or `supabase/functions/.env`. `supabase status` and `supabase start`
  print the local keys: never run `supabase status` bare (use `docker ps --filter name=_ANASAQ.ME`), and send `supabase
  start` output to a file outside the repository, reading only its error lines. Before every commit, scan what is staged
  for key-shaped text (Phase 9).
- **Nothing hosted.** Never `supabase link`, `supabase db push`, any `--linked` command, `pnpm backup` without
  `--local`, a deploy, `wrangler`, the soon Worker or the hosted project. **E02 and everything Moyasar stay untouched**
  (D48 (3)): never run `docs/payments-runbook.md`'s sandbox steps, never call Moyasar, never change a `MOYASAR_*` value;
  the suites use the local emulator on port 54390, which `pnpm db:env` already points the functions at.
- **The database.** `supabase db reset` only after the owner's word in this session (D48). Never `supabase stop
  --no-backup` on ANASAQ.ME. Another project's containers are only stopped and started again, on his word (Phase 1),
  never removed.
- **Frozen and append-only.** Never edit or delete `supabase/migrations/*` (supersede with a new numbered file, and only
  on the owner's word); never edit `deploy/design/`; never inspect `_archive/`.
- **Tests.** Never weaken an assertion, skip, disable or quarantine a test, add `.only`, `fixme` or a retry, raise a
  timeout to get green, or add an allowlist entry. A red is reported red, with its verbatim output. "Flake" is not a root
  cause. A test that failed in the battery and passes alone stays "failed in the battery" in every record.
- **Money and permissions.** Anything in checkout, payments, refunds, order amounts, roles, MFA, step-up, RLS, the admin
  function or a migration is the owner's to decide: describe it with evidence and ask.
- **No polling.** No `sleep`, `until`, `watch`, `tail -f` or `wc` loops, by you or any agent. Run a long command once, in
  the background, with one completion notification; read its result when notified.
- **Workflows.** Never `/compact` while a workflow runs (it never returns). Each workflow's results go into
  `after/RECORD.md` as soon as it returns.
- **Git.** Commit by explicit paths (never `git add -A` or `.`) to `claude/amazing-planck-qv3f7a` only. Never force-push or
  rewrite history. `main` moves only on the owner's word, by fast-forward.
- **Tracked files a check rewrites.** `PLANS/verify-plan.ps1` rewrites the tracked `PLANS/evidence/planning-checks.json`
  with the time of each passing run: restore it right after every run (`git checkout --
  PLANS/evidence/planning-checks.json`); the PASS line is the record. The dev server rewrites `next-env.d.ts`: restore it
  after every Playwright run (`git checkout -- next-env.d.ts` when `git diff --quiet -- next-env.d.ts` fails) and remove
  `.next/e2e`.
- **Records.** No API model identifier string in any file or commit (the role names "Opus 5.5" and "Sonnet 5.5" are the
  project's convention). Nothing you write closes an E-gate or decides an owner decision.
- **Environment (D41).** `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` must be unset, and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  must not be set (it would put the auditors on Sonnet). If one is set, tell the owner; do not edit his settings.

## 3. Workers, auditors and workflows

- Load the `workflow-authoring` skill before you write a workflow script, if the session lists it; otherwise follow the
  API the four scripts in Appendix A use. Appendix A has the scripts this close needs (adjudicate, fix, visual pass,
  records audit): adapt their `args` and prompts, keep their shape.
- On every `agent()` call, name the role, the model and the effort:
  - writer: `{ agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' }`;
  - hard-fix writer: `{ agentType: 'general-purpose', model: 'opus', effort: 'xhigh' }` (D48 (4));
  - auditor, reviewer, verifier: `{ agentType: 'auditor', model: 'opus', effort: 'max' }`.
- Under 10 agents per workflow. One writer per workflow, and one fix workflow at a time.
- Agents never run `supabase`, `docker`, `pnpm test:db`, `pnpm db:*` or the battery scripts; only you do. A fix writer may
  run one named Playwright test (`-g`) when its brief says so; the capture worker runs its temporary specs. Auditors and
  reviewers are read-only: files, images, logs, `git log`, `git show`, `git diff`, `grep`, and lint, typecheck or unit
  tests at most.
- You rule on every finding yourself, read every money, security and migration diff yourself, and fix small findings
  directly (D28). Your own fixes get a fresh auditor; the fixes that follow its findings, taken from its text, are
  recorded as "not audited again".
- If the Workflow tool is missing, use the Agent tool with the same roles (`subagent_type` `sonnet-worker`, `auditor` or
  `general-purpose`, `model` `sonnet` or `opus`, the same effort), one at a time, and say so in the record.

## 4. Phase 0: git, the tree and the facts

```bash
git status --short
git branch --show-current
git fetch origin
```

- The only expected changes are the owner's `.claude/launch.json` and `.claude/settings.json`. Anything else: stop and
  ask.
- Switch to the branch: `git switch claude/amazing-planck-qv3f7a` (or, with no local branch, `git switch --track
  origin/claude/amazing-planck-qv3f7a`), then `git merge --ff-only origin/claude/amazing-planck-qv3f7a`. If the
  fast-forward is refused, stop.
- Prove no code changed since the commit CI verified: `git diff --stat b3fa932 HEAD -- . ':(exclude)artifacts'
  ':(exclude)PLANS'` must print nothing. `git diff --quiet -- next-env.d.ts` must succeed.
- `cloud-ratify`: the owner chose to delete it once `main` held it (2026-10-14); the cloud session's git access was refused
  (HTTP 403). If `git merge-base --is-ancestor origin/cloud-ratify origin/main` succeeds, run `git push origin --delete
  cloud-ratify`, and `git branch -d cloud-ratify` if a local branch exists (`-d`, never `-D`). Otherwise leave it and say so.
- Check the environment without printing any value: `env | grep -cE '^(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_SUBAGENT_MODEL_FORCE)='`
  must print 0.
- The facts for the owner's questions, read only:
  - `docker info --format '{{.ServerVersion}}'` answers (if not, ask him to start Docker Desktop);
  - `docker ps --format '{{.Names}}'`: is ANASAQ.ME's stack running (`*_ANASAQ.ME`), and does another project's Supabase
    stack run (a `supabase_*` container whose name does not end in `_ANASAQ.ME`, for example `saloony-repair`)? It holds
    the same ports. For each such project, count its last hour once: `docker logs --since 60m supabase_kong_<project>
    2>&1 | wc -l` (idle means 0; `HANDOFF-2026-10-07.md` section 5);
  - the old lock file. It is JSON with no secret in it; read it and check that it is the lock D48 means: `package`
    FABLE-AUDIT, `pausedAt` 2026-10-07T15:30:06.095Z (`HANDOFF-2026-10-07.md` section 3, row 6), its last round ZCode's
    RATIFY of 2026-10-08, recorded closed, and nothing after it. If it is missing or holds anything else, stop and ask.

## 5. Phase 1: the owner's word, the lock and the progress log

**Ask once, with one AskUserQuestion call** (or plainly, if that tool is missing), before anything else changes. Until
his answers, the only changes are Phase 0's switch to the branch and, when `main` holds it, the deletion of `cloud-ratify`
he already chose:

1. "D48 releases your paused local lock (FABLE-AUDIT, paused 2026-10-07) once you have read the handoff,
   `artifacts/acceptance/FABLE-AUDIT/HANDOFF-2026-10-07.md` (its sections 1 to 3 show that the lock's session died). Have
   you read it, and may this session release that lock and take its own?" Options: "Yes, release it"; "Not yet".
2. Only when another project's Supabase stack runs: "Your <project> Supabase stack holds the ports this one needs (it
   logged <N> lines in the last hour). May this session stop its containers while it runs (its data is not touched) and
   start them again at the end?" Options: "Yes, stop it for this session"; "No".
3. "The batteries reset the local ANASAQ.ME database and storage: once for the database battery, once for the e2e battery,
   and again for a re-run if a fix changes code. `PLANS/HANDOFF.md` ("Local stack") expects only test data there: anything
   you made yourself in the local admin since the last reset (2026-10-08) is lost unless you back it up first. Reset now?"
   Options: "Yes, reset (Recommended)"; "Back up the local data first"; "Not now".

"Not yet" or "No": tell him what it waits for and wait for his word; touch nothing more until then. "Not now": record
nothing, change nothing more, tell him the checkout is now on `claude/amazing-planck-qv3f7a` (it was on <the branch Phase 0
found>), and stop. "Back up the local data first" is handled in Phase 2, once the stack runs.

**The lock.** D48's condition is his "Yes, release it". Its owner is proven stopped by `HANDOFF-2026-10-07.md` section 1
(no work after 15:30Z on 2026-10-07), ZCode's RATIFY round is closed in it (`ratify-e800fc5/RECORD.md`), its diff was
inspected by the handoff (sections 2 and 4) and every commit since is on `main` with CI green; Phase 0 proved the tree.
The cloud continuation's lock is released (EXECUTION-STATUS, Lock row).

1. Copy the old file's whole JSON into the new lock's `recovery.previousLock`, delete the old file, and create the new one
   in one `node -e` call that writes it with `fs.openSync('.anasaq-execution.lock', 'wx')`.
2. The new lock holds:
   - `package` "FABLE-AUDIT (the local close, D48)", `agent`, `task`, `roles`, `baseCommit` (HEAD), `branch`, `startedAt`;
   - `dirtyAtStart` (`git status --short`) and `recovery` (the proof above, with his answer to question 1 word for word);
   - `rounds` (one per fix round, each with its exact paths before the write);
   - `allowedPaths`:
     - `artifacts/acceptance/FABLE-AUDIT/after/` (new files only; never overwrite the cloud's `summary.txt`,
       `summary-ci.txt`, `ci-*.log`, `lint.log`, `typecheck.log`, `test.log`, `check-*.log`, `deno-check.log`,
       `ci-runs.txt`) and `artifacts/acceptance/FABLE-AUDIT/after-fixes/` if a re-run is needed;
     - `artifacts/acceptance/FABLE-AUDIT/REPORT.md` and `STATE.md`;
     - `PLANS/EXECUTION-STATUS.md`, `PLANS/HANDOFF.md`, `PLANS/ISSUES.md`, `PLANS/DECISIONS.md`;
     - `docs/operations.md` (the two rehearsal lines, "No backup rehearsal with a paid file yet" and "That run has not been
       made" at the end of the rehearsal's guarantees, and the checkout budget line only);
     - `artifacts/acceptance/ADMIN-DESIGN/README.md` (the admin suites' result and the owner's marks and answer only);
     - `artifacts/acceptance/P08/REPORT.md` (new: P08's acceptance record, which `PLANS/P08-KICKOFF.md` item 5 asks for);
     - `next-env.d.ts` and `PLANS/evidence/planning-checks.json` (restore only);
     - `tests/e2e/zz-fable-visual.spec.ts` and `tests/e2e/zz-fable-visual-2.spec.ts` (temporary: the capture; deleted
       before any commit, never committed).
3. Start `artifacts/acceptance/FABLE-AUDIT/after/RECORD.md`: a title, who ran it (you, the model, the effort), the
   commit, the machine (Windows, Node, pnpm, Supabase CLI, Docker), his three answers word for word, and a "Progress log"
   section. After every phase, append what ran, its result and the evidence file. This file is how you, or a fresh
   session, resume.

## 6. Phase 2: the machine

- **The other project's stack**, when he said yes: `docker stop` its containers and list them, with the time, in
  `after/paused-containers.txt`; they are started again in Phase 10.
- **Ports.** `powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 3000,54390 -ErrorAction
  SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess'` must print nothing before a Playwright run:
  Playwright reuses whatever answers on ports 3000 and 54390, and another app there would be tested instead of this one.
  If something listens, ask the owner which program it is; never stop it yourself.
- **Memory and disk.** Free memory at least 10 GB (`powershell -NoProfile -Command
  "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"`; about 6 GB crashes), and `df -h /c`
  shows at least 15 GB available. If not, ask the owner to close programs.
- **Tools.** `node --version` is 24.x, at least 24.9 (24.19.0 on 2026-10-08); `pnpm --version` is 10.34.6 (the
  `packageManager` pin, through corepack); `supabase --version` is 2.106.0 (never upgrade it: ISSUES I53 (2));
  `graft --version` (record it: round S's proof wants 0.21.1, or the hooks and the status line stay silent by design).
- `pnpm install --frozen-lockfile`. If it fails or would change the lockfile, stop. Then `pnpm exec playwright install
  chromium` (the browser of the pinned Playwright).
- **The stack.** Restart it so it runs the current `supabase/config.toml`: `supabase stop` (plain, which keeps the data),
  then `supabase start > "$TEMP/anasaq-supabase-start.log" 2>&1; echo "exit $?"`. On a non-zero exit, read only the
  lines with "error" or "failed" in that file. `docker ps --filter name=_ANASAQ.ME` then lists the stack.
- **"Back up the local data first"**, if he chose it: now that the stack runs, give him this command for a PowerShell
  window opened in the repository folder (not the Git Bash window: there Node gets no console and the script stops at "No
  passphrase source"; he types the passphrase twice, which you never see):
  `pnpm backup --local --out "%USERPROFILE%\ANASAQ-backups\before-local-close"`. Wait for his word that it printed
  "Backup written:".

## 7. Phase 3: the stack-free checks on this machine

One background command (timeout 1800000), its summary in the same shape as the cloud's `after/summary.txt`:

```bash
E=artifacts/acceptance/FABLE-AUDIT/after; S=$E/summary-local.txt
echo "# stack-free checks on the owner's machine, commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ), node $(node --version), pnpm $(pnpm --version)" > "$S"
for c in lint typecheck test check:frozen check:copy; do n=${c/:/-}; t=$(date +%s); pnpm -s "$c" > "$E/local-$n.log" 2>&1; r=$?; echo "$c -> exit $r ($(( $(date +%s)-t ))s)" >> "$S"; done
grep -E "Test Files|Tests " "$E/local-test.log" | tail -2 >> "$S"
powershell -NoProfile -ExecutionPolicy Bypass -File PLANS/verify-plan.ps1 > "$E/local-verify-plan.log" 2>&1; echo "verify-plan -> exit $?" >> "$S"
git checkout -- PLANS/evidence/planning-checks.json; cat "$S"
```

Every line exit 0 (`-ExecutionPolicy Bypass` applies to that one PowerShell process only). The unit suite here runs the
content drift check, which the container and CI skip (it needs the local book assets). It skips by design the two suites
that need a POSIX shell, `tests/unit/graft-helpers.test.ts:44` and `restore-check.test.ts:281`; the link suites,
`restore-check.test.ts:108` and `backup-cli.test.ts:129`, make a junction and must run here. Record the passed and
skipped counts and the files that skipped (the per-file lines of `local-test.log`); a skip anywhere else is a finding.

## 8. Phase 4: the database battery

`bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-db.sh after`, in the background (timeout 3600000). About ten
minutes: reset, content import, demo catalog, `db:env`, the edge runtime restarted, the whole `test:db`, the build,
`check:export`, `check:budgets`. It writes `after/summary-db.txt` and one log per step.

Green means: every step exit 0; `test:db` 31 files, every test passed, the eight HTTP files among them (the eight
`.github/workflows/ci.yml` leaves out because they need the edge runtime: `orders-http`, `refunds-http`, `payment-http`,
`checkout-http`, `staff-admin`, `order-emails`, `notify-http`, `disputes-http`; name each from `test-db.log`);
`check:export` 59 required files and no secret; `check:budgets` at most 150 KiB (CI had `checkout.html` at 149.7 KiB on
`b3fa932`; record yours). Earlier runs for comparison: 814 of 814 at `3a30a91` (`before/`), 874 of 874 at `e800fc5`
(`ratify-e800fc5/`). A red goes to Phase 6 after the e2e battery.

## 9. Phase 5: the e2e battery

The machine stays quiet: no agent runs, the owner's heavy programs are closed, and free memory is at least 10 GB before
each part (the script records it). Before the first part, stop any Playwright browser an earlier run left behind (P08's
kickoff asks for it): `powershell -NoProfile -Command 'Get-Process | Where-Object { $_.Path -like "*ms-playwright*" } |
Select-Object Id, ProcessName, Path'` lists them (Playwright's headless Chromium runs as `chrome-headless-shell`); stop
only those, with `powershell -NoProfile -Command 'Stop-Process -Id <id>'`, never the owner's own browser. Run the five
parts one after the other, each as one background command with timeout 7200000 and one completion notification:

```bash
bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-e2e.sh after setup
bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-e2e.sh after batch1
bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-e2e.sh after batch2
bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-e2e.sh after orders
bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-e2e.sh after finish
```

- The parts run the steps of the script's single run (`all`), which wrote `before/`; they exist so that no part outlives
  one background command. If a part is cut off by the timeout, say so in the record and run that part again; never start
  the next part while one runs.
- Playwright empties `test-results/playwright/` at the start of every run, so after each Playwright part the script keeps
  that folder in the git-ignored `test-results/kept/<label>-e2e-<part>/` (`after-e2e-batch1/`, ...; `after-fixes-e2e-batch1/`,
  ... for a re-run battery; never committed). For each failure, note its kept files:
  `test-results/kept/<label>-e2e-<part>/<test folder>/error-context.md`, `test-failed-1.png`, `trace.zip`.
- After each part, read `after/summary-e2e.txt` and the failing lines of its log (on Windows the list reporter marks a
  failure `  x`: `grep -nE '^  x |^ +[0-9]+\) \[chromium\]|[0-9]+ (failed|flaky|did not run|interrupted)'`), and keep
  going: the battery is the record.
- What it covers: all 17 spec files of `tests/e2e/`: batch1 (9: public, visual, no-js, motion, reader, auth, cms, media,
  owner-operations), batch2 (7: store-admin, cart-checkout, checkout-api, product-availability, order-page,
  orders-admin, orders-money) and `orders.spec.ts`. Among them: the admin's eight (auth, cms, media, owner-operations,
  store-admin, orders-admin, orders-money, orders), never run against the redesigned admin (D49); the cases F3 and D1
  wrote, green once at `e800fc5`; and the deep audit's two cases, never run: `cart-checkout.spec.ts:900` ("a lost create
  reply, then a changed name: ...") and `:919` ("a lost create reply, then the same request again: ...").
- For comparison: `before/` (a loaded machine): batch1 170 of 170, batch2 302 passed and 7 failed, `orders.spec` 12
  passed and 8 not run at its 15-minute limit; `ratify-e800fc5/` (seven specs): 185 passed, `orders.spec` in 6.2 minutes.
  The test counts changed since; compare spec by spec.
- Never set `ACCEPTANCE_PACKAGE` in this session: it would overwrite accepted evidence. The specs' own screenshots go to
  the git-ignored `test-results/screenshots/` (Phase 8 uses this run's).

## 10. Phase 6: the reds (skip it if everything is green)

1. **Record first.** Every red, verbatim (the summary lines and the failing test titles), in `after/RECORD.md`.
2. **Re-run each failing file alone, once,** one at a time, on a quiet machine, in the background. Number each file's
   re-runs so that none overwrites another: `<n>` is 1, then 2 for the run after a fix, and so on; `<label>` is the
   battery's, `after` or `after-fixes`:
   - a spec: `pnpm exec playwright test tests/e2e/<file> --reporter=list > artifacts/acceptance/FABLE-AUDIT/<label>/rerun-<file>-<n>.log 2>&1; echo "exit $?"`;
     then keep its files (`cp -r test-results/playwright test-results/kept/<label>-rerun-<file>-<n>`), restore
     `next-env.d.ts` if it changed, and `rm -rf .next/e2e`;
   - an integration file: `docker restart supabase_edge_runtime_ANASAQ.ME`, then
     `env TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm -s test:db tests/integration/<file> > artifacts/acceptance/FABLE-AUDIT/<label>/rerun-<file>-<n>.log 2>&1`.
3. **Adjudicate** with workflow A (Appendix A.1): one Opus auditor per failing file, then an Opus refuter of its verdicts;
   at most four files per run, more runs for more files.
4. **Rule on each red yourself**, reading the evidence:
   - a product defect or a test defect that is small, clear and in scope: fix it (step 5);
   - money, permissions or a migration: ask the owner, with the evidence and the proposed change;
   - visual only: record it for the round with a browser (ISSUES I55 (2)); no fix here;
   - load (it passed alone and the cause is timing under load): record it as failed in the battery and passed alone, with
     the free memory of that part; fix the spec only if it has a real race and the fix is small, else record it open;
   - environment: fix the environment (never the test) and re-run; record both runs;
   - unknown: investigate further yourself before any fix.
   A test defect is only a spec whose expectation a recorded, intended change replaced (the admin redesign kept every
   route, role, label, accessible name and `data-label` the specs read: `artifacts/acceptance/ADMIN-DESIGN/contract.md`).
   Update it to the recorded behaviour with every assertion as strong as before, citing the record; if the record does
   not settle what is intended, ask the owner.
5. **Fix**, one round at a time, with workflow B (Appendix A.2): record the round and its exact paths in the lock; a
   Sonnet writer (the Opus writer if the fix is hard, or a first writer failed); an Opus audit of the diff; your ruling and
   your own small fixes. Then run lint, typecheck and the unit tests; the failing file whole (as in step 2, with the next `<n>`); after any
   change under `supabase/functions/`, `docker restart supabase_edge_runtime_ANASAQ.ME` and the eight HTTP integration
   files (section 8's list); after a change to a screen, use the changed control yourself at 360 and 1440 and recheck
   `PLANS/DESIGN-AUDIT.md` (CLAUDE.md). Commit the round on its own (Phase 9's checks, scan and explicit paths; the
   battery's evidence under `after/` stays uncommitted until Phase 9), push, and read CI.
6. **Re-run the whole battery** if `git diff --stat <the commit the battery ran on> HEAD -- . ':(exclude)artifacts'
   ':(exclude)PLANS'` prints anything: `battery-db.sh after-fixes`, then the five e2e parts with the label `after-fixes`,
   from fresh resets (his word of Phase 1 covers them). The records report both runs; the final verdict rests on
   `after-fixes`.

## 11. Phase 7: the backup rehearsal and round S's proofs

After the last battery, while its data is in the stack:

- `bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-backup.sh after` (background, timeout 3600000). It:
  - makes a throwaway passphrase it never prints;
  - uploads a paid file when the bucket has none, and removes it afterwards;
  - runs `pnpm backup --local` into a new folder under `~/ANASAQ-backups`, then `pnpm restore-check` on that file;
  - looks at the scratch stack once while it runs, by the CLI's project label and by name;
  - checks that nothing of it remains and that the ANASAQ.ME containers are the same;
  - deletes the backup file (no one can open it without the passphrase);
  - writes `after/summary-backup.txt` and `after/backup-restore-check.log`.

  Green means "verdict: PASS": every table "ok"; the paid files' objects verified; the 15 schedules "ok"; the same
  containers and volumes listed by label as by name while the stack ran; every published port on 127.0.0.1; nothing left
  afterwards by label or by name.
- If the rehearsal is cut off, or ends without "done":
  - list what is left: `docker ps -a` and `docker volume ls`, each once with `--filter
    label=com.supabase.cli.project=anasaq-restore-check` and once with `--filter name=anasaq-restore-check`;
  - if anything is listed, run `supabase stop --no-backup --project-id anasaq-restore-check` (the scratch project, never
    ANASAQ.ME) and list again;
  - remove the rehearsal's paid file, `node artifacts/acceptance/FABLE-AUDIT/work/scripts/paid-file.mjs remove <the key in
    summary-backup.txt>`, and delete the `.enc` in the rehearsal folder;
  - record all of it.
- `bash artifacts/acceptance/FABLE-AUDIT/work/scripts/junction-check.sh after` (foreground, timeout 600000): a real
  junction in a scratch copy, refused by both scripts, while a plain folder outside reaches "No passphrase source"; four
  lines ending "as it must be", and the junction and the copy removed. It writes `after/summary-junction.txt`.
- Record `graft --version` from Phase 2 as the third proof.
- Not yours to run: pressing Ctrl+C during a rehearsal, and closing its console window (I53 (3)). List them in the record
  for the owner:
  1. in a PowerShell window in the repository folder, start `pnpm restore-check <a backup file whose passphrase he knows>`
     (if he has none, run `pnpm backup --local` there first);
  2. press Ctrl+C, or close the window, while it says "Starting the throwaway stack";
  3. then `docker ps -a --filter label=com.supabase.cli.project=anasaq-restore-check` and `docker volume ls --filter
     label=com.supabase.cli.project=anasaq-restore-check` must list nothing;
  4. if either lists anything, run `supabase stop --no-backup --project-id anasaq-restore-check`, then list again.

## 12. Phase 8: the visual pass

Workflow C (Appendix A.3), when no battery runs: one Sonnet capture worker, then six Opus reviewers in parallel, then one
Opus verifier.

- The screens, each at 360 and 1440 px: every screen F3 changed (`cloud/F3.md`, line 64: AdminHome, OrderView,
  CommerceSettingsForm, DisputeForm, PublishBar, CollectionList, FieldInput, MediaPicker, EmailView, SignIn, MfaEnroll,
  StepUp, HoldView, CheckoutForm, CartView, ContactForm, PaymentReturn) and what D1 changed (`cloud/D1.md`, "For the
  owner's visual pass": the footer's «المَشَاهِد»; /book, as seeded and with an edition that names a store variant's SKU,
  which shows a price row, «اطلب النسخة» and the heading «النسخ»; the hold page and the checkout's hold sentence ending
  «بتوقيت الرياض»; the reader's end buttons).
- The worker first reuses this run's screenshots in `test-results/screenshots/`: only files newer than the last e2e
  battery's `e2e-db-reset.log` (older ones are from earlier runs, the admin before its redesign among them). It captures
  the rest with at most two temporary specs, `tests/e2e/zz-fable-visual.spec.ts` and `zz-fable-visual-2.spec.ts`, built
  on `tests/e2e/helpers.ts` and the flows of the specs that already reach each screen. It never mocks a response or builds
  a page by hand, skips a screen it cannot reach (saying why), sets back any document it changed, and deletes the specs
  before it finishes.
- The reviewers check each screen against `DESIGN.md`, every applicable item of `PLANS/DESIGN-AUDIT.md`, and what the
  round recorded; the verifier re-checks every finding above "nit" against the image.
- You rule on the findings and write `after/visual/visual-pass.md`: the screens, their source, what could not be
  reached, every finding with its verdict. Real findings go to ISSUES I55 (2) for the round with a browser ("Next work"
  item 5); this session fixes none of them. The WebP copies in `after/visual/` stay under 25 MB.

## 13. Phase 9: the records and the commit

Write the records yourself (D28):

- `after/RECORD.md`, finished in the shape of `ratify-e800fc5/RECORD.md`: what ran, with numbers; the reds and their
  rulings; the fixes and their commits; the rehearsal; round S's proofs; the visual pass; a verdict; what it does not close.
- `REPORT.md`:
  - section 4's table gains a column "After, the owner's machine" (or the After column is completed), and "Still to
    run" becomes what ran and what stays;
  - section 5's first and last bullets (the owner's machine; the lock);
  - "In short", and a row 12 in section 1's table;
  - section 3, if fixes were made.
- `PLANS/EXECUTION-STATUS.md`: "Current state" (Branch, Last commit, Packages, Lock); the FABLE-AUDIT section; the ledger
  rows FABLE-AUDIT, P08 (its "Left") and ADMIN-DESIGN; "Next work" items 2 and 3.
- `PLANS/HANDOFF.md`: "State", "Local stack" (what the stack now holds), "Next".
- `PLANS/DECISIONS.md`: the revision line and D48's "As run" and "Left".
- `PLANS/ISSUES.md`: the revision line; I55 (1) (what ran); I53 (3) (what the rehearsal showed); I55 (2) (the visual
  findings); I55 (6) (the admin suites); a new item for anything a red left open.
- `docs/operations.md`:
  - "No backup rehearsal with a paid file yet", and the sentence "That run has not been made" that ends the rehearsal's
    guarantees, become the rehearsal's result and date;
  - the checkout budget line ("148.9 of the 150 KiB ... 1.1 KiB of headroom", stale since round F3; CI had 149.7 KiB on
    `b3fa932`) takes this run's `check:budgets` number.
- `artifacts/acceptance/P08/REPORT.md` (new): P08's acceptance record:
  - its rounds and commits (the ledger row);
  - the battery of `PLANS/P08-KICKOFF.md` item 5 as this run ran it (a pointer to `after/`, with the numbers);
  - the backup rehearsal;
  - what stays open: E02, with the payments runbook's "When the Moyasar keys arrive" list and what only the real sandbox
    can prove; E03; the residuals in ISSUES I50 and I51 and FABLE-AUDIT's Appendix B;
  - after Phase 11, the owner's answer.
- `artifacts/acceptance/ADMIN-DESIGN/README.md`: the admin suites' result; and the owner's marks if he has made them. Read
  them with the ArtifactData tool (list the `reviews` collection of https://claude.ai/artifact/HGPZcH9NEvzAQ7Nz73sheK)
  if this session has it, else ask him.
- `STATE.md`: an update at the top.

Then **workflow D** (Appendix A.4): two Opus auditors check every changed sentence, and the new records whole, against
the logs and the earlier records. Fix what they find; the fixes taken from their text are recorded as not audited again.

Before every commit (fix rounds included):

- `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s check:frozen` and `pnpm -s check:copy` exit 0;
  `powershell -NoProfile -ExecutionPolicy Bypass -File PLANS/verify-plan.ps1` passes (then `git checkout --
  PLANS/evidence/planning-checks.json`); `git diff --check` is clean; every markdown table row you touched has as many
  cells as its header.
- Stage by explicit paths, then scan what is staged. This must print nothing:
  `git diff --cached -U0 | grep -nE '^\+.*(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9_-]{10,}|[sp]k_(live|test)_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)'`.
  A hit in a log: replace that value with "[key-shaped value removed]" in the log, note it in `RECORD.md`, stage again.
- `git status --short` shows only your paths (for a fix round, also the uncommitted evidence under `after/` and
  `after-fixes/`) and the owner's `.claude/launch.json` and `.claude/settings.json`; no temporary spec is left.
- Commit in the repository's style (`docs(fable-audit): ...`, `fix(fable-audit): ...`), ending with the attribution
  lines your harness gives, and no model identifier. Push: `git push origin claude/amazing-planck-qv3f7a`.
- CI: `gh run list --branch claude/amazing-planck-qv3f7a --limit 1`, then `gh run watch <id> --exit-status` in the
  background (one notification). Without `gh`, use a GitHub connector if this session has one, or ask the owner to look at
  https://github.com/Ekka-Barber/anas-studio/actions. CI red on your push is yours: fix it as in Phase 6.

## 14. Phase 10: put the machine back

- `docker start` the containers listed in `after/paused-containers.txt`; `docker ps` shows them running.
- Delete `$TEMP/anasaq-supabase-start.log` (it holds the local stack's keys) once its errors are read. Tell the owner that
  the rehearsal's full output stays in `~/ANASAQ-backups/rehearsal-<stamp>/` (the scratch stack's start output, keys
  included) and that he may delete it.
- The ANASAQ stack stays running; `next-env.d.ts` and `PLANS/evidence/planning-checks.json` are clean; `.next/e2e` is gone;
  no temporary spec is left; `git status --short` shows only the owner's two `.claude/` files.
- Record it in `after/RECORD.md` (in the final commit).

## 15. Phase 11: the owner's questions, then stop

Ask with one AskUserQuestion call, giving the facts each answer rests on (verdicts, commits, CI). Recommend only what the
evidence supports:

1. "Move `main` to the branch once this session's last commit is green? (`main` is at `6ae9c7b`; fast-forward only)".
   Options: "Yes, move main" (recommended when everything is green), "Not yet".
2. "Accept P08 as built? Its acceptance battery is this run; E02 and E03 stay open." Options: "Accept P08", "Not yet".
3. Only when the admin suites are green and he has marked every screen: "Accept the admin redesign (D49)? One proof is
   yours: a tap on the strip on your phone and a mouse click on it in a window about 1024px wide (AD-F1)." Options:
   "Accept it", "Not yet".
4. "Close FABLE-AUDIT? What stays open is in REPORT.md section 5. Once `main` holds the branch, the branch is deleted on
   GitHub and here (`PLANS/HANDOFF.md`, "Branches")." Options: "Close it", "Keep it open".

Then, in this order:
1. Record his answers word for word: EXECUTION-STATUS (with the ledger); DECISIONS D48; `PLANS/HANDOFF.md` ("State",
   "Branches" and "Next"); STATE.md; REPORT.md ("In short" and section 5); `artifacts/acceptance/ADMIN-DESIGN/README.md`;
   `after/RECORD.md`; `artifacts/acceptance/P08/REPORT.md`. Record the lock's release too: this session's writes end here,
   whatever his answers, and a later session takes its own lock. Run Phase 9's checks, commit, push, read CI.
2. On his yes to `main`, once that CI run is green: `git merge-base --is-ancestor origin/main HEAD` must succeed, then
   `git push origin HEAD:main` (never forced), and read CI on `main`.
3. When he closed FABLE-AUDIT and `git merge-base --is-ancestor origin/claude/amazing-planck-qv3f7a origin/main` succeeds:
   `git push origin --delete claude/amazing-planck-qv3f7a`, then `git switch main`, `git merge --ff-only origin/main`
   and `git branch -d claude/amazing-planck-qv3f7a` (`-d`, never `-D`).
4. Delete the lock file last, when nothing more will be written.

Then stop. Do not start the residuals round, SITE-STATE-1, P09 or anything after them. Your last message gives:

- what ran, with its numbers;
- every red and what became of it;
- the commits, and CI on each;
- what stays open;
- his own to-dos: the Supabase token, the review marks, the AD-F1 tap and click on his own devices, the Ctrl+C check,
  the rehearsal folder he may delete, the open decisions.

## Appendix A: the workflow scripts

Load the `workflow-authoring` skill first if the session lists it. The scripts are plain JavaScript; fill `args` when you
call them.

### A.1 Adjudicate the reds (read-only)

```js
export const meta = {
  name: 'local-close-adjudicate',
  description: 'Adjudicate the after-battery reds: an Opus auditor per failing file, then an Opus refuter of its verdicts',
  phases: [{ title: 'Adjudicate' }, { title: 'Refute' }],
}
// args.reds: at most 4, one per failing file: { file, tests: ['<title>', ...], logs: ['<path>', ...],
//   evidence: ['<test-results/kept/... paths: error-context.md, test-failed-1.png, trace.zip>', ...],
//   reranAlone: '<passed | failed again> (<log>)', records: ['<records of the rounds that changed this area>', ...] }
const ROLE = { agentType: 'auditor', model: 'opus', effort: 'max' }
const RULES = 'Read-only: never write, edit, stage or commit; never start or stop a server; never run supabase, docker, playwright, pnpm test:db, pnpm db:* or the battery scripts. Read files, logs and images; use git log, git show, git diff and grep. Quote every piece of evidence with its file and line.'
const VERDICTS = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          test: { type: 'string' },
          kind: { type: 'string', enum: ['product-defect', 'test-defect', 'environment', 'load', 'unknown'] },
          rootCause: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          intendedBy: { type: 'string' },
          fix: { type: 'string' },
          fixFiles: { type: 'array', items: { type: 'string' } },
          moneyPermissionsOrMigration: { type: 'boolean' },
          visualOnly: { type: 'boolean' },
        },
        required: ['test', 'kind', 'rootCause', 'evidence', 'intendedBy', 'fix', 'fixFiles', 'moneyPermissionsOrMigration', 'visualOnly'],
      },
    },
  },
  required: ['file', 'verdicts'],
}
const REFUTATION = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { test: { type: 'string' }, upheld: { type: 'boolean' }, reason: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } },
        required: ['test', 'upheld', 'reason', 'evidence'],
      },
    },
  },
  required: ['file', 'results'],
}
return await pipeline(
  args.reds,
  (red) => agent(
    'FABLE-AUDIT\'s after-battery ran on the owner\'s machine and these tests failed. Find the root cause of each and classify it. ' +
    'kind: product-defect (the product is wrong); test-defect (the spec expects what a recorded, intended change replaced: name that record, file and line, in intendedBy; ' +
    'for the admin, artifacts/acceptance/ADMIN-DESIGN/contract.md lists what the redesign kept); environment (the machine, the stack, a port); ' +
    'load (timing under load, with evidence; it passed alone); unknown. "Flake" is never a root cause. A fix never weakens an assertion, skips a test or raises a timeout. ' +
    'Set moneyPermissionsOrMigration for anything in checkout, payments, refunds, order amounts, roles, MFA, step-up, RLS, the admin function or a migration; set visualOnly when only the look is wrong. ' +
    `The red: ${JSON.stringify(red)}. ${RULES}`,
    { label: `adjudicate:${red.file}`, phase: 'Adjudicate', schema: VERDICTS, ...ROLE }),
  (verdicts, red) => verdicts && agent(
    'Another auditor classified these failing tests. Try to refute each verdict: read the evidence yourself, look for a cause it missed, and uphold a verdict only when the evidence holds. ' +
    `The red: ${JSON.stringify(red)}. The verdicts: ${JSON.stringify(verdicts)}. ${RULES}`,
    { label: `refute:${red.file}`, phase: 'Refute', schema: REFUTATION, ...ROLE }).then((refutation) => ({ verdicts, refutation })),
)
```

### A.2 One fix round (one writer, then an audit)

```js
export const meta = {
  name: 'local-close-fix',
  description: 'One fix round: a writer limited to the paths in the lock, then an independent Opus audit of its diff',
  phases: [{ title: 'Write' }, { title: 'Audit' }],
}
// args: { round: 'LC-1', brief: '<the red, your ruling, what to change, the exact files, the checks to run>', paths: ['<exact path>', ...], hard: false }
const WRITER = args.hard
  ? { agentType: 'general-purpose', model: 'opus', effort: 'xhigh' }
  : { agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' }
phase('Write')
const written = await agent(
  `${args.brief}\n\nYou are the only writer, under the lock the orchestrator holds. Write only these paths: ${args.paths.join(', ')}. ` +
  'Never weaken an assertion, skip or disable a test, raise a timeout, edit a migration, read a .env file or print a key. ' +
  'Run only the checks the brief names; never run supabase, docker, pnpm test:db, pnpm db:* or the battery scripts; after a Playwright run, ' +
  'git checkout -- next-env.d.ts if git shows it changed, and remove .next/e2e. ' +
  'End with the files you changed, what each change does, and every check you ran with its exit code.',
  { label: `write:${args.round}`, phase: 'Write', ...WRITER })
if (!written) return { written: null, audit: null, note: 'the writer returned nothing: inspect git status and the diff yourself before another round' }
phase('Audit')
const audit = await agent(
  `Audit fix round ${args.round}: the uncommitted diff of ${args.paths.join(' ')} (git diff -- <paths>, and read whole every path that git status --short --untracked-files=all -- <paths> shows as new). ` +
  'git status must show no other change than these paths, the owner\'s two .claude files and this session\'s uncommitted evidence under artifacts/acceptance/FABLE-AUDIT/after/ and after-fixes/. ' +
  `The writer's brief: ${args.brief}\nThe writer's report: ${written}\n` +
  'Check that the change removes the root cause, weakens no assertion, stays inside the paths, and breaks nothing that calls the changed code (find the callers). ' +
  'Read-only: never write, stage or commit; never run supabase, docker, playwright, pnpm test:db or pnpm db:*; lint, typecheck and unit tests are allowed. ' +
  'Report each finding as major, minor or nit with file:line and the exact change; end with audit_passed or audit_failed.',
  { label: `audit:${args.round}`, phase: 'Audit', agentType: 'auditor', model: 'opus', effort: 'max' })
return { written, audit }
```

### A.3 The visual pass (one capture worker, six reviewers, one verifier)

```js
export const meta = {
  name: 'local-close-visual',
  description: 'The visual pass of the screens F3 and D1 changed: a capture worker, six Opus reviewers, an Opus verifier',
  phases: [{ title: 'Capture' }, { title: 'Review' }, { title: 'Verify' }],
}
// args: { label: 'after' or 'after-fixes' (the last e2e battery) }
const SHOTS = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          screen: { type: 'string' }, width: { type: 'number' }, state: { type: 'string' }, source: { type: 'string' },
          png: { type: 'string' }, parts: { type: 'array', items: { type: 'string' } }, webp: { type: 'array', items: { type: 'string' } },
        },
        required: ['screen', 'width', 'state', 'source', 'png', 'parts', 'webp'],
      },
    },
    unreached: { type: 'array', items: { type: 'object', properties: { screen: { type: 'string' }, why: { type: 'string' } }, required: ['screen', 'why'] } },
    tempSpecsDeleted: { type: 'boolean' },
    documentsSetBack: { type: 'boolean' },
    gitStatus: { type: 'string' },
  },
  required: ['shots', 'unreached', 'tempSpecsDeleted', 'documentsSetBack', 'gitStatus'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, screen: { type: 'string' }, width: { type: 'number' }, image: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low', 'nit'] },
          seen: { type: 'string' }, rule: { type: 'string' }, heldAs: { type: 'string' }, suggestion: { type: 'string' },
        },
        required: ['id', 'screen', 'width', 'image', 'severity', 'seen', 'rule', 'heldAs', 'suggestion'],
      },
    },
    checked: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'checked'],
}
const VERIFIED = {
  type: 'object',
  properties: { results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['id', 'real', 'reason'] } } },
  required: ['results'],
}
const REVIEWER = { agentType: 'auditor', model: 'opus', effort: 'max' }
const READ_ONLY = 'Read-only: never write anything, and never run supabase, docker, playwright, pnpm or the battery scripts.'
const CAPTURE = [
  'You capture, for a visual review, the screens FABLE-AUDIT\'s rounds F3 and D1 changed, each at 360 and 1440 px wide, on the local stack.',
  'The screens: the public footer (the menu\'s «المَشَاهِد»); /book as seeded, and /book with one edition naming a store variant\'s SKU (set it in the admin\'s book editor, as cms.spec.ts edits a document, capture, then set it back) for its price row, «اطلب النسخة» and the heading «النسخ»;',
  'the reader opened on /book and turned to its last page (its end buttons); /contact (ContactForm, empty and with a validation message);',
  '/cart with a line (CartView); /checkout with a line and the form filled (CheckoutForm), and its hold sentence ending «بتوقيت الرياض» after a create; the hold view of an order waiting for payment (HoldView); /checkout/return (PaymentReturn), pending and paid;',
  '/admin/sign-in (SignIn: the form and the code step); /admin as the owner (AdminHome); /admin/orders and the order view of a paid order (OrderView) with its shipping and refund dialogs and the dispute form (DisputeForm); the step-up dialog a refund opens (StepUp);',
  '/admin/settings (CommerceSettingsForm); /admin/email with at least one mail (EmailView); /admin/security before and after enrolling (MfaEnroll); a content collection\'s list (CollectionList) and its editor (FieldInput, PublishBar, and MediaPicker open).',
  'The records: artifacts/acceptance/FABLE-AUDIT/cloud/F3.md (line 64) and cloud/D1.md ("For the owner\'s visual pass").',
  `First reuse this run's screenshots: only files under test-results/screenshots/ (P05, P06, P07, P08, DESIGN-B) newer than artifacts/acceptance/FABLE-AUDIT/${args.label}/e2e-db-reset.log (find test-results/screenshots -name '*.png' -newer <that log>), wherever one shows a screen above in the right state; give its path and time as the source. Never use an older file: older ones come from earlier runs, the admin before its redesign among them.`,
  'For the rest, write tests/e2e/zz-fable-visual.spec.ts. Build it on tests/e2e/helpers.ts (createOwner, createStaff, signInByCode, totpCode, emulatorControl, armEmulator, runOutbox, mailsTo, serviceClient) and copy the flows of the spec that already reaches each screen:',
  'auth.spec.ts (sign-in, security), orders-admin.spec.ts and orders-money.spec.ts (order view, dialogs, step-up), owner-operations.spec.ts (home, settings, email), cms.spec.ts (content editor, the book document), cart-checkout.spec.ts and orders.spec.ts (cart, checkout, hold view, return page), reader.spec.ts (reader).',
  'Seed through the same paths those specs use. Never mock a response, never build a page by hand, never set ACCEPTANCE_PACKAGE. Use reducedMotion \'reduce\'. Save full-page PNGs as test-results/visual/<screen>-<width>.png.',
  'Run it once, in the foreground: pnpm exec playwright test tests/e2e/zz-fable-visual.spec.ts --reporter=list. If it needs more than ten minutes, split it into tests/e2e/zz-fable-visual.spec.ts and tests/e2e/zz-fable-visual-2.spec.ts and run them one after the other. After each run, git checkout -- next-env.d.ts if git shows it changed. A screen you cannot reach in a sound state: skip it and say why in unreached; never fake it.',
  'Then, with sharp from the repository (createRequire of the repository\'s package.json): cut every PNG taller than 2000 px into parts of at most 1800 px with 200 px overlap in test-results/visual/parts/, and write a WebP copy (quality 80) of each full screenshot to artifacts/acceptance/FABLE-AUDIT/after/visual/<screen>-<width>.webp, cut into .1.webp, .2.webp where a side passes 16000 px. Keep after/visual/ under 25 MB.',
  'Finally set back any document you changed, delete both temporary specs, run git checkout -- next-env.d.ts if git shows it changed, remove .next/e2e, and report git status --short.',
  'You write only those two temporary specs, test-results/visual/ and artifacts/acceptance/FABLE-AUDIT/after/visual/. Never run supabase, docker, pnpm test:db, pnpm db:* or the battery scripts; never read a .env file or print a key.',
].join('\n')
const SLICES = [
  { key: 'public', screens: 'the footer, /book (both states), the reader\'s end buttons, /contact' },
  { key: 'buy', screens: 'the cart, the checkout and its hold sentence, the hold view, the return page' },
  { key: 'orders', screens: 'AdminHome, the orders list, the order view, its shipping and refund dialogs, the dispute form' },
  { key: 'settings', screens: 'the commerce settings, the email screen' },
  { key: 'content', screens: 'the collection list, the editor: field inputs, the publish bar, the media picker' },
  { key: 'access', screens: 'the sign-in page, the security page (MFA enrolment), the step-up dialog' },
]
phase('Capture')
const capture = await agent(CAPTURE, { label: 'capture', phase: 'Capture', schema: SHOTS, agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' })
if (!capture) return { error: 'the capture worker returned nothing' }
phase('Review')
const reviews = await parallel(SLICES.map((slice) => () => agent(
  `Review the screenshots of these screens: ${slice.screens}. Pick yours from this list (read the parts of tall pages): ${JSON.stringify(capture.shots)}. ` +
  'Check them against DESIGN.md (direction B «أنساق»), every item of PLANS/DESIGN-AUDIT.md that applies, and what the rounds recorded (artifacts/acceptance/FABLE-AUDIT/cloud/F3.md and D1.md; for the admin, artifacts/acceptance/ADMIN-DESIGN/README.md and direction.md). ' +
  'Look for overflow, clipping or overlap; contrast; right-to-left direction and alignment; missing or wrong Arabic copy; a sentence F3 or D1 changed that does not show as recorded; states that look wrong; spacing and type against the design. ' +
  'For each finding give id (<slice>-1, ...), the screen, the width, the image, the severity, exactly what you see, the rule it breaks (file and section), heldAs (its id when REPORT.md\'s Appendix A already holds it, else empty) and a suggestion. ' +
  `Report nothing you cannot see in an image. List every image you checked. ${READ_ONLY}`,
  { label: `review:${slice.key}`, phase: 'Review', schema: FINDINGS, ...REVIEWER })))
const findings = reviews.filter(Boolean).flatMap((r) => r.findings)
const toVerify = findings.filter((f) => f.severity !== 'nit')
phase('Verify')
const verified = toVerify.length === 0 ? { results: [] } : await agent(
  `Verify each of these visual findings against its image: real exactly as described, or not (a duplicate counts as not real; say of which). ${JSON.stringify(toVerify)}. ${READ_ONLY}`,
  { label: 'verify', phase: 'Verify', schema: VERIFIED, ...REVIEWER })
return { capture, findings, verified, reviewers: reviews.map((r) => (r ? r.checked.length : null)) }
```

### A.4 The records audit (two auditors)

```js
export const meta = {
  name: 'local-close-records-audit',
  description: 'Two independent Opus audits of the local close records against the logs and the earlier records',
  phases: [{ title: 'Audit' }],
}
// args: { base: '<the commit before your record changes>' }
const ROLE = { agentType: 'auditor', model: 'opus', effort: 'max' }
const RULES = 'Read-only: never write, stage or commit; never start or stop a server; never run supabase, docker, playwright, pnpm test:db, pnpm db:* or the battery scripts. Report each finding as major, minor or nit with the file, the line, the evidence quoted with its location, and the exact replacement text; end with audit_passed (nothing above nit) or audit_failed.'
const audits = await parallel([
  () => agent(
    'Audit artifacts/acceptance/FABLE-AUDIT/after/RECORD.md, after/summary-*.txt, after/visual/visual-pass.md, artifacts/acceptance/P08/REPORT.md and the changes to artifacts/acceptance/FABLE-AUDIT/REPORT.md ' +
    `(git diff ${args.base} -- <the tracked ones>; the new files are untracked until the commit, so read them whole) against the logs in after/ (and after-fixes/ if present): every number, verdict, test name, commit and date must match its log or git. ${RULES}`,
    { label: 'audit:evidence', phase: 'Audit', ...ROLE }),
  () => agent(
    `Audit the changes since ${args.base} to PLANS/EXECUTION-STATUS.md, PLANS/HANDOFF.md, PLANS/DECISIONS.md, PLANS/ISSUES.md, docs/operations.md, artifacts/acceptance/ADMIN-DESIGN/README.md and artifacts/acceptance/FABLE-AUDIT/STATE.md: ` +
    'true against after/RECORD.md, REPORT.md and artifacts/acceptance/P08/REPORT.md, consistent with each other, nothing marked done or accepted that the owner did not accept, no E-gate closed, no owner decision decided, no key-shaped string and no API model identifier. ' +
    RULES,
    { label: 'audit:plan', phase: 'Audit', ...ROLE }),
])
return audits
```

---

## The paste prompt

Paste this into Claude Desktop's Code tab, in the ANASAQ.ME folder, with Opus 5.5 at max effort:

> You are the orchestrator of FABLE-AUDIT's local close on my machine: Claude Opus 5.5 at effort max. Run `git fetch
> origin claude/amazing-planck-qv3f7a`, then `git show
> origin/claude/amazing-planck-qv3f7a:artifacts/acceptance/FABLE-AUDIT/LOCAL-CLOSE-2026-10-14.md >
> "$TEMP/LOCAL-CLOSE-2026-10-14.md" && cygpath -w "$TEMP/LOCAL-CLOSE-2026-10-14.md"`, read the file at the path that
> prints, whole, with the Read tool, and follow it as my instructions, phase by phase, from Phase 0. Use workflows (the
> Workflow tool, multi-agent orchestration) for the workers and auditors exactly as it says: Sonnet 5.5 at effort max for
> the workers, Opus 5.5 at effort max for the auditors and reviewers, an Opus 5.5 writer for a hard fix. Make sure careful
> work is always done and nothing breaks. Ask me before releasing my paused lock, before stopping my other Supabase stack,
> before any `supabase db reset`, before anything that touches money, permissions or a migration, and at the end for
> `main` and the acceptances. Never touch Moyasar or E02. If you stop partway, `after/RECORD.md` is where the next session
> resumes.
