# I56, round W1: the audit and the orchestrator's rulings

The auditor: a fresh Claude Opus 5.5 at effort max, read-only (`audit-brief-W1.md`), 2026-10-15, on the uncommitted diff
of `agent/i56` at base `f022fed`. Its report, as it gave it (paths shortened to the repository):

**Verdict: `pass`.** The relay and the widened guard are correct and fail closed for every create the Supabase CLI
2.106.0 makes. The guard is not weaker than at `f022fed`. Findings 1–3 are small enough to fix directly.

What it checked:
- Tests: `pnpm exec vitest run tests/unit/docker-loopback-relay.test.ts` once on Windows over named pipes: exit 0,
  17/17 passed.
- Probes: two Node scripts in its scratchpad, outside the repository, started the real relay module against fake
  upstreams on named pipes. They confirmed the 502/413/431 answers, Upgrade and duplicate Content-Length on a create,
  `HostIp: null` rewritten to 127.0.0.1, a create split into 17-byte chunks, and a half-close after the body. No Docker,
  no `supabase`.
- The CLI v2.106.0 source: every create goes through `DockerStart`, which sets NetworkMode to the `--network-id` value
  whenever it is given (`docker.go:267-268`), including the storage and auth migrate jobs (`db/start/start.go:334-357`).
  `ContainerCreate` is called only at `docker.go:306`. Ports carry `HostPort` only. With `patchConfig`, only the
  database (5432) and Kong (8000) publish. Vector's `DaemonHost` use (`start.go:364-393`) is inside the analytics branch
  (`:346`). Nothing reachable from `start` uploads a chunked body (no CopyToContainer, ImageLoad or ImageBuild). The TS
  shell's `start` only proxies to the Go binary.
- The guard, old against new: the line test is identical. The database's own one-binding rule is kept
  (`restore-check.mjs:280`). Kong is required too. Containers found by label and by name are checked (`:265`). A failing
  `docker ps` (`:266`) or `docker port` (`:272`) refuses. Every check goes through plain docker.
- Scope: only the five files changed, plus `artifacts/acceptance/I56/`. Nothing in `PLANS/`, no secrets.

Findings:
1. minor, `tests/unit/restore-check.test.ts:492-499`: no test isolates round S's S-A3 rule (the database must show at
   least one binding): that test's only rule is an empty `docker port` for the database, so Kong is empty too, and with
   `name === CONTAINER ||` removed from `restore-check.mjs:280` Kong's check raises the same refusal. Fix: give Kong its
   loopback binding and assert the database's own message.
2. minor, `scripts/restore-check.mjs:272-275`: the refusal for a failing `docker port` has no test. Fix: a guard case
   with a labelled container whose `docker port` exits 1.
3. minor, `scripts/lib/docker-loopback-relay.mjs:111,128,145,147,149,154`: the 502, 431, 413, Upgrade-on-create and
   duplicate Content-Length answers, and the dropping of bytes sent after a create body, are not tested (its probes show
   each works). Fix: rows in the refusal table, and a 502 through a relay pointed at an endpoint nothing serves.
4. nit, `docs/operations.md:1995-1996`: the "What it leaves behind" bullet (the orchestrator's edit, "the relay" in the
   list of cleanup steps) is accurate; one line runs past the wrap width, and the tests paragraph has a short reflow
   leftover.
5. nit (a known residual), `docker-loopback-relay.mjs:179-204` with `restore-check.mjs:658`: on POSIX the folder is made
   before the `try` and `relay` is assigned only after start-up resolves, so a Ctrl+C in that window leaves an empty
   `anasaq-relay-*` folder (at most a dead socket), and a synchronous throw from `new Worker` skips `close()`. Fix: open
   the `try` right after the folder is made, and remove the folder on 'exit' until start-up completes.
6. nit (known), `restore-check.test.ts:393-395`: the stand-in suite's nested TMPDIR pushes the relay socket path past
   macOS's 104 bytes. CI runs only on Linux; a real run on a Mac is about 76 bytes.

Attacks, races and edge cases no test covers (its list):
- An upstream that ignores `Connection: close` (only the real run settles this): after a non-create, a create sent on
  the same connection reached its probe's upstream unrewritten, and after a create the next request on that connection
  is dropped. Safety rests on Docker's API server closing as RFC 9112 section 9.6 requires (Go's `net/http` does), and
  the guard catches it if it does not. Optional hardening, about 8 lines: destroy both sockets on any byte past the first
  request.
- Request forms a hostile client could send that the relay does not recognise (a percent-encoded or absolute-form
  target, JSON keys in other cases, which Go's decoder matches case-insensitively): covered by the brief's decision (no
  hostile-client defence), the user-private endpoint and the guard.
- A non-create request with `Upgrade` that the upstream answers without 101 and keeps alive: later bytes go through
  raw; the Docker client closes a hijack connection on any non-101 answer.
- Windows pipe security: Node passes no security attributes, so the default DACL applies (full control for SYSTEM,
  Administrators and the creator; read-only for Everyone and anonymous; remote clients not rejected): other users can
  open the pipe but cannot write a request; read-only connections are held without a timeout, so the worst case is a
  denial of service of the start, which fails closed.
- `docker port` shows live bindings only: a stack container that is restarting, or created and not started, passes
  vacuously unless it is the database or Kong; only a container created outside this start could carry a wider
  HostConfig.
- A container removed between `docker ps` and `docker port` causes a spurious refusal (fails closed).
- Test flakiness: `rawDocker`'s `once('data')` and the hijack test's echo assume the head and body arrive in one chunk,
  likely on local pipes but not guaranteed.

## The orchestrator's rulings

- 1, 2, 3: accepted and fixed by the orchestrator (small). `restore-check.test.ts`: the empty-answer case now gives
  Kong its binding and asserts "`docker port supabase_db_anasaq-restore-check` shows no published port"; a guard case
  for a labelled `supabase_rest_anasaq-restore-check` whose `docker port` exits 1. `docker-loopback-relay.test.ts`:
  rows for an Upgrade header on a create (400), two Content-Length headers (400) and a body over 1 MiB (413), and cases
  for a head over 64 KiB (431) and an upstream nothing serves (502). The dropping of bytes after a create body stays
  untested: it matters only with an upstream that ignores `Connection: close` (below).
- 4: accepted; the bullet's line re-wrapped. The tests paragraph is rewritten with the rehearsal's result in the records.
- 5: accepted and fixed: `startLoopbackRelay` registers `close` on the process's 'exit' from the moment the folder
  exists and removes it in `close()`, and `new Worker` is inside the `try`, so a Ctrl+C or a throw during start-up
  cannot leave the folder behind.
- 6: recorded, not fixed: the stand-in suite runs on Linux in CI and is skipped on Windows; the real script's path is
  short.
- The upstream that ignores `Connection: close`: recorded as a residual, no hardening. Docker's API server is Go's
  `net/http`, which closes; if one did not, the rewrite would be bypassed for a reused connection and the guard would
  refuse before anything is restored (fail closed). The hardening would change only where the run fails.
- `docker port`'s live view: recorded as a residual. Every container of the stack is created by this start through the
  relay (the pre-clean removes the project's labelled leftovers first), so its configured bindings are 127.0.0.1 by
  construction or the start failed; the guard keeps `docker port`, as round S built it.
- The others need nothing: the hostile-client forms by the brief's decision; the pipe's default security leaves other
  users read-only (no request can be written); a spurious refusal fails closed; the one-chunk assumption holds on local
  pipes and sockets, and a split would fail the test, not pass a defect.

After the fixes the orchestrator re-ran, on Windows: `pnpm lint` exit 0; `pnpm typecheck` exit 0;
`pnpm exec vitest run tests/unit/docker-loopback-relay.test.ts tests/unit/restore-check.test.ts` exit 0, 44 passed and
31 skipped (the POSIX stand-in suite); `pnpm test` exit 0, 71 files, 2584 passed and 39 skipped (`lint.log`,
`typecheck.log`, `unit-relay.log`, `unit.log`).
