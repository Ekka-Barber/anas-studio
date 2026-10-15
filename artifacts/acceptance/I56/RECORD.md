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
