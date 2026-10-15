# I56: the backup rehearsal on Docker Desktop for Windows, the fix round's record

The defect, its adjudication and the audited fix design: `PLANS/ISSUES.md` I56, with
`artifacts/acceptance/FABLE-AUDIT/after/RECORD.md` (Phase 7), `after/backup-bindcheck.txt` and
`after/adjudicate-backup-rehearsal.md`.

- **Roles (D48 (4), a hard fix).** The orchestrator: Claude Opus 5.5 at effort max (a Claude Code session started by
  the session `local_812231b5-1237-4497-8776-130523bdaf25`). The writer: a fresh Claude Opus 5.5 at effort xhigh. The
  auditor: a fresh Claude Opus 5.5 at effort max, read-only.
- **The lock.** `.anasaq-execution.lock`, created with `fs.openSync('.anasaq-execution.lock', 'wx')` at
  2026-10-15T02:07:39.741Z: package I56, base `f022fed`, branch `agent/i56` (cut from `main` at `f022fed`), the roles,
  `dirtyAtStart` (the owner's `.claude/launch.json` and `.claude/settings.json`, never opened, never staged), and its
  allowed paths: the two scripts, the two test files, `docs/operations.md` (the backup sections), `PLANS/ISSUES.md` and
  `PLANS/EXECUTION-STATUS.md` (the orchestrator's), this folder, and `artifacts/acceptance/FABLE-AUDIT/i56/` (the
  rehearsal's output for the label `i56`).
- **The machine.** Windows 11 10.0.26200, Node 24.19.0, pnpm 10.34.6, Supabase CLI 2.106.0, Docker Desktop 4.91.0
  (engine 29.8.0, as recorded by the local close); 15.1 of 31.8 GB free before the rehearsal; the development stack
  ANASAQ.ME running (9 containers), nothing of `anasaq-restore-check` present.

## Progress log

### 1. The design's open details, ruled by the orchestrator (2026-10-15, `brief-W1.md`, the items marked "Decided")

- A create must name the scratch network as its `NetworkMode`: the Supabase CLI v2.106.0 sets every container's
  NetworkMode to the `--network-id` value (`apps/cli-go/internal/utils/docker.go:267-268`; its only `ContainerCreate`
  is at `:306`; read with `gh api` at tag v2.106.0). This makes the design's "refuse host networking" exact.
- `Connection: close` on every forwarded request that is not an upgrade: each connection carries one request, so the
  relay never has to find a request boundary inside a body it does not parse. Responses are never touched.
- No TCP or TLS upstream: on a tcp:// engine, 127.0.0.1 would not be this machine's loopback.
- No hostile-client defence in the relay (case-folded keys, other target forms): the relay is the mechanism, and the
  widened guard is the check.
- The CLI's other uses of the Docker endpoint: `Docker.DaemonHost()` feeds only vector, inside the analytics branch
  (`apps/cli-go/internal/start/start.go:346`, `:364-393`), which `patchConfig` turns off; `GetHostname` returns 127.0.0.1
  for any endpoint that is not tcp (`apps/cli-go/internal/utils/misc.go:298-311`), so the relay's npipe keeps the CLI on
  127.0.0.1.

### 2. The writer (round W1)

New `scripts/lib/docker-loopback-relay.mjs`; `scripts/restore-check.mjs` (only `supabase start` through the relay, the
guard widened, the comments corrected); new `tests/unit/docker-loopback-relay.test.ts` (runs on Windows over real named
pipes, the relay in its worker, a spawnSync-blocked case); `tests/unit/restore-check.test.ts` (the POSIX stand-in
suite: a stand-in start that sends a real create through `DOCKER_HOST` to a fake Docker in a worker, its refusal, the
guard's cases, the context fallback, a tcp:// refusal); `docs/operations.md` (the rehearsal's "Where it listens" and its
tests paragraph). Its checks on Windows: lint 0; typecheck 2, then 0 (a JSDoc return type); the two files 39 passed and
30 skipped; `pnpm test` 2579 passed and 38 skipped. Beyond its brief it ran both test files, type-stripped, under WSL
Ubuntu's Node 18 in its scratchpad, outside the repository: the relay's 17 of 17 passed on Linux, and the stand-in suite
50 of 52 (the two failures were Node 18's supabase-js deprecation warning on stderr); with the rewrite disabled 3 relay
tests failed, and with `DOCKER_HOST` removed from the start's environment both "real create" stand-in tests failed. It
ran no docker or supabase command. Changed assertions, none deleted: `cleanupCalls().containers` uses `lastIndexOf` (the
guard lists the containers with the same command first); `VERIFIES` and the "goes on" case give Kong a loopback binding;
`rehearse()` sets a default `DOCKER_HOST`.

### 3. The orchestrator's read

Every line of the relay, of the `restore-check.mjs` diff and of both test files read: no defect found. The guard keeps
round S's rule for the database, adds Kong's, checks every container by label and by name, refuses on a failing
`docker ps` or `docker port`, and keeps the line test. One documentation gap the writer named was fixed: the relay in
the list of cleanup steps ("What it leaves behind").

### 4. The audit (`audit-W1.md`)

Verdict `pass`; three minor findings (untested branches) and three nits, with the cases no test covers. Rulings: the
three minors and two nits fixed by the orchestrator, one nit and two residuals recorded (the upstream that ignores
`Connection: close`; `docker port`'s live view). Re-run after the fixes, on Windows: lint 0; typecheck 0; the two files
44 passed and 31 skipped; `pnpm test` 71 files, 2584 passed and 39 skipped.

### 5. The commit and CI

`5ab83b3` on `agent/i56` (the code, the tests, the documents and this folder), pushed on 2026-10-15 as a new branch on
GitHub. CI run 38677087554 on `5ab83b3`: success. Its unit step ran both files in full on Linux, the stand-in suite
included: `tests/unit/docker-loopback-relay.test.ts` 22 tests and `tests/unit/restore-check.test.ts` 53 tests, all
passed (71 unit files and 23 database files passed).

### 6. The rehearsal on the owner's machine (2026-10-15, 09:10:39Z to 09:12:18Z)

The owner's word, as he gave it: "Yes, run the backup rehearsal now: bash
artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-backup.sh i56".

Before it: `DOCKER_HOST` and `DOCKER_CONTEXT` unset, the current context's endpoint
`npipe:////./pipe/dockerDesktopLinuxEngine`, Docker engine and client 29.8.0; nothing of `anasaq-restore-check` by label
or by name (containers, volumes, the network); the development stack's 9 containers running; the lock held at
`5ab83b3`. `bash artifacts/acceptance/FABLE-AUDIT/work/scripts/battery-backup.sh i56`, run once in the background with
one completion notification: exit 0. `artifacts/acceptance/FABLE-AUDIT/i56/summary-backup.txt`, verbatim:

```
# backup rehearsal (i56), commit 5ab83b3, 2026-10-15T09:10:39Z
development stack ANASAQ.ME: 9 containers running
paid file uploaded for the rehearsal: assets/backup-rehearsal/20261015T091039Z.pdf, 262191 bytes, sha256 6006c42d773ddf431431c69918a42503abb0d8f34a5454223aaca2c1615052cd
paid-files holds 1 object(s) before the backup
backup --local -> exit 0 (28s)
Size: 730838 bytes (0.7 MB), files: 228, storage objects: 223.
backup file: anasaq-backup-20261015-091047.enc, 730838 bytes, sha256 cd874b0668200865892c1c68fb160b9282037894940277fb0299d84876ef6b1b
restore-check -> exit 0 (57s)
while the scratch stack ran: 5 container(s) and 2 volume(s) labelled com.supabase.cli.project=anasaq-restore-check; by name: 5 and 2
  container supabase_storage_anasaq-restore-check
  container supabase_rest_anasaq-restore-check
  container supabase_auth_anasaq-restore-check
  container supabase_kong_anasaq-restore-check
  container supabase_db_anasaq-restore-check
  volume supabase_db_anasaq-restore-check
  volume supabase_storage_anasaq-restore-check
  docker port: 5432/tcp -> 127.0.0.1:55322
  docker port: 8000/tcp -> 127.0.0.1:55321
after the run: by label, 0 container(s) and 0 volume(s) of anasaq-restore-check remain; by name, 0 container(s), 0 volume(s) and 0 network(s)
the run ended with "Scratch stack removed"
development stack ANASAQ.ME: the same 9 containers running after the run
paid file removed after the rehearsal: assets/backup-rehearsal/20261015T091039Z.pdf
backup file deleted (its passphrase existed only in this run); the full output stays in ~/ANASAQ-backups/rehearsal-20261015T091039Z
verdict: PASS
done 2026-10-15T09:12:18Z
```

`restore-check`'s own lines are in `i56/backup-restore-check.log`: the row counts of all 66 tables equal to their COPY
blocks; 223 objects verified by sha256 (`media-private` 45, `media-public` 177, `paid-files` 1, the rehearsal's paid
file); the runbook's re-run of the 15 `cron.schedule(...)` statements (`cron.job` held none of them before, as the dump
carries none) and all 15 present after it; "OK: 66 tables, 223 objects, 15 schedules verified in 48.6s (start to
verified)."; then "Scratch stack removed: no container or volume of anasaq-restore-check remains." The full output
stays outside the repository and was read by `grep` for these lines only: it has the relay's line, "supabase start
talks to Docker through the loopback relay, which forwards to npipe:////./pipe/dockerDesktopLinuxEngine.", no refusal
by the relay and no "Error response from daemon", and the CLI's fixed notice "All services bind to 0.0.0.0
(network-accessible, not just localhost)", which it prints after every start (`printSecurityNotice`) and which is not a
measurement: the bindings measured are the two `docker port` lines above.

What the run shows of I53 (3)'s Docker-side items:
- the CLI took the relay's `DOCKER_HOST` through its shell to the Go binary, and Docker Desktop answered every request
  the relay forwarded, the creates included: the stack started, with no refusal;
- the loopback binding holds: Docker Desktop kept the 127.0.0.1 the relay wrote, the database and Kong showed one
  binding each, on 127.0.0.1 only, and the guard passed before anything was restored;
- `--network-id` was accepted;
- the project label is on every container and volume while the stack runs: 5 containers and 2 volumes by label, the
  same 5 and 2 by name;
- the pre-clean and the cleanup left ANASAQ.ME alone (the same 9 containers), and nothing of the scratch stack
  remained by label or by name, its network included; the run ended with "Scratch stack removed".

Not this run's to prove: a Ctrl+C or a closed console during a rehearsal (the owner's to try, I53 (3)).

### 7. The records

`PLANS/ISSUES.md` (I56 closed, with I53 (3)'s second real run and the relay's two residuals, and I55 (10) for the
development stack's own binding), `PLANS/EXECUTION-STATUS.md` (the branch, the last commit, the lock, the P08 row, a
ledger row for I56, "Next work"), `PLANS/HANDOFF.md` (added to the lock's allowed paths before it was written: the
repository, P08, the owner's machine, what is open, the local stack, "Next") and `docs/operations.md` (the residual on
the rehearsal, the end of its tests paragraph). Then, on Windows: `pwsh -File PLANS/verify-plan.ps1` PASS (13
documents, 13 packages, 40 unique scope owners, 162 frozen hashes; its `PLANS/evidence/planning-checks.json` timestamp
restored, as the local close did); `pnpm check:frozen` 0; `pnpm check:copy` 0; `git diff --check` clean.

## Verdict

I56 is fixed on `agent/i56`: on Docker Desktop for Windows, the machine it is meant for, `pnpm restore-check` restores a
backup with a paid file into a scratch stack that is published on 127.0.0.1 only, and verifies every table, object and
schedule. The guard is stronger than before (the database and Kong by name, every container by label or by name), and
nothing was loosened. CI is green on the fix.

## What stays open

- A Ctrl+C or a closed console during a rehearsal on Windows (ISSUES I53 (3)): the owner's to try.
- The relay relies on Docker's API server closing each connection after the one request it forwards (it asks with
  `Connection: close`; Go's `net/http` does). One that did not would let a create through unrewritten on a reused
  connection, and the guard would then refuse before anything is restored. The guard reads `docker port`, the live
  bindings: a container of the stack that is restarting, or created and not started, shows none and passes unless it is
  the database or Kong; every container of the stack is created through the relay by this start. Both are in ISSUES
  I53 (3); the audit's reasoning is in `audit-W1.md`.
- The stand-in suite's relay socket path can pass macOS's 104 bytes (CI runs on Linux; a real run's path is about 76).
- The development stack ANASAQ.ME is published on every address, the CLI's default (ISSUES I55 (10)): the relay is the
  rehearsal's alone.
- `main`: fast-forwarded to `agent/i56` only on the owner's word. The lock stays held until his answer.

### 8. The owner's answer on `main` (2026-10-15)

Asked "Fast-forward main to agent/i56 once CI is green, then delete the branch?", he answered, word for word: "Yes, move
main: fast-forward main to agent/i56 once its CI is green, record my answer, release the lock, then delete agent/i56."
So this commit records it; `main` is fast-forwarded to it once its CI is green (from `f022fed`, no force); the lock is
released after it, this round's last commit; and `agent/i56` is then deleted, on GitHub and on his machine.
