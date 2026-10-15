# I56, round W1: the writer's brief

The writer: Claude Opus 5.5 at effort xhigh (D48 (4): a hard fix), a fresh agent. The orchestrator (Claude Opus 5.5,
effort max) holds `.anasaq-execution.lock` for this round (package I56, base `f022fed`, branch `agent/i56`). Do not
create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10; Git Bash and PowerShell are available.

## Read first

`CLAUDE.md`, `AGENTS.md`; `PLANS/ISSUES.md` I56 and I53 (3); `artifacts/acceptance/FABLE-AUDIT/after/adjudicate-backup-rehearsal.md`
(the audited design and the refuter's corrections: binding, as refined below);
`artifacts/acceptance/FABLE-AUDIT/after/backup-bindcheck.txt`; `scripts/restore-check.mjs` and
`tests/unit/restore-check.test.ts` (whole); `docs/operations.md` lines 1951 to 2005.

## Write only these paths

- `scripts/lib/docker-loopback-relay.mjs` (new)
- `scripts/restore-check.mjs`
- `tests/unit/docker-loopback-relay.test.ts` (new)
- `tests/unit/restore-check.test.ts`
- `docs/operations.md`: only the "Where it listens" bullet of "What the rehearsal guarantees about its scratch stack
  (round S)" and the tests paragraph after that list (from "`tests/unit/restore-check.test.ts` proves" to
  "(`PLANS/ISSUES.md`, I53 (3) and I56)."). The residual near line 1415 is the orchestrator's, after the real rehearsal.

Any other path: stop and report.

## Never

Read or print `.env` or any settings file (`.claude/settings*.json`, `.mcp.json`). Touch `PLANS/`, `_archive/`,
`deploy/design/` or `artifacts/`. Run `supabase` or `docker` against anything real: no `supabase start/stop/status`, no
`docker ...` command, no `pnpm restore-check` or `pnpm backup` (the development stack ANASAQ.ME runs on this machine and
must stay untouched; the real rehearsal is run later, on the owner's word). Commit, push, stash, reset or switch
branches. Spawn sub-agents. Poll (no sleep, until or tail loops).

## The defect, in one paragraph

`pnpm restore-check` keeps its scratch Supabase stack on loopback only through the Docker network it creates with
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1` (`scripts/restore-check.mjs:233`) and hands to
`supabase start --network-id` (`:621`). Docker Desktop 4.91.0 (engine 29.8.0) does not apply that option; the Supabase
CLI 2.106.0 publishes every port with no host IP and has no setting for one; so the scratch database came up on
`0.0.0.0` and `[::]`, and `assertLoopbackOnly` (`:250`) refused before anything was restored. The guard was right and
must never be weakened. An explicit `127.0.0.1` in the create request is honoured by Docker Desktop, in `docker port`
and in the Windows listener (`backup-bindcheck.txt`, section 2 and 3).

## The design (binding; "Decided" marks the orchestrator's rulings on details the adjudication left open)

### 1. `scripts/lib/docker-loopback-relay.mjs`

Plain ESM, `node:` imports only, no new dependency. One file is both the library and the worker's entry point.

a. `relayTarget(dockerHost)`: the upstream path for a `DOCKER_HOST`-style value. `npipe:////./pipe/<name>` gives
   `\\.\pipe\<name>` (the part after `npipe://` must be `//./pipe/<name>`: a local pipe); `unix:///<path>` gives
   `/<path>`. Anything else (`tcp://`, `ssh://`, `fd://`, a remote pipe, an empty or malformed value) throws an Error that
   names the value and says the rehearsal can relay only a local Docker endpoint (a named pipe or a unix socket).
   Decided: no TCP or TLS upstream; on a tcp:// engine, 127.0.0.1 would not be this machine's loopback.

b. `rewriteCreate(body, network)`: pure; `body` a Buffer; returns `{ body: Buffer }` (the rewritten JSON) or
   `{ refusal: string }`.
   - Parse as UTF-8 JSON with a reviver that throws on an integer that is not `Number.isSafeInteger` (it would not
     survive the round trip exactly): a refusal. Not JSON, or not a plain object: a refusal.
   - `HostConfig` must be a plain object and `HostConfig.NetworkMode` must equal `network` exactly. Decided: the CLI
     2.106.0 sets every container's NetworkMode to the `--network-id` value (`apps/cli-go/internal/utils/docker.go:267-268`
     at tag v2.106.0, read by the orchestrator), so anything else (`host`, `none`, `container:<id>`, the default bridge, a
     network given by id, a missing HostConfig) is refused. This is the design's "host networking" refusal, made exact.
   - `HostConfig.PublishAllPorts`: anything but absent, null or false is a refusal.
   - `HostConfig.PortBindings`: absent or null, nothing to do. Otherwise a plain object whose values are null or arrays
     of plain objects; any other shape is a refusal. In each binding: `HostIp` absent, null or `""` becomes
     `"127.0.0.1"`; `"127.0.0.1"` is kept; any other value (`0.0.0.0`, `::`, `::1`, a name, a non-string) is a refusal
     naming the port and the value.
   - Everything else is kept as parsed; the result is `JSON.stringify` of the edited object.
   - Decided: the relay reads exactly the keys Docker's API names (`HostConfig`, `NetworkMode`, `PublishAllPorts`,
     `PortBindings`, `HostIp`). It is the mechanism, not the check: its only client is the Supabase CLI, and the widened
     guard (2c) refuses a stack published wider whatever the relay did. Add no case-folding or other hostile-client
     defence.

c. `startLoopbackRelay({ upstream, network })`: async. Validates `upstream` with `relayTarget` (throwing before anything
   starts), picks the endpoint, starts the server in a `worker_threads` Worker running this same module
   (`new Worker(new URL(import.meta.url), { workerData })`; the module serves only when `!isMainThread` and its
   `workerData` marks it as the relay), waits until the worker reports that it listens (rejecting on its error, on its
   exit before that, or after about 10 s), `unref()`s it, keeps an 'error' listener on it for its whole life (a Worker
   'error' with no listener throws in the main thread), and returns `{ dockerHost, close }`.
   - Windows: a named pipe `\\.\pipe\anasaq-restore-relay-<16 random hex>`, `dockerHost`
     `npipe:////./pipe/anasaq-restore-relay-<hex>`, Node's default pipe security (no `readableAll`/`writableAll`).
   - POSIX: a unix socket `d.sock` in a fresh `mkdtempSync(join(tmpdir(), 'anasaq-relay-'))` folder (mkdtemp makes it
     0700; keep the path short: macOS limits a socket path to 104 bytes), `dockerHost` `unix://<path>`.
   - Never TCP: a Docker API on a loopback TCP port is open to every local process.
   - `close()`: idempotent; terminates the worker and, on POSIX, removes the socket's folder synchronously (`rmSync`,
     recursive, force) before it returns the termination promise, so a synchronous caller (restore-check's 'exit'
     cleanup) can call it too.
   Why a worker (the refuter's (a)): `supabase()` is `spawnSync`, which blocks restore-check's event loop for the whole
   start, so a server on the main thread could not answer a single request and the start would hang to its 600 s limit.

d. The server (in the worker): one HTTP request per client connection.
   - Read the request head up to the first CRLF CRLF; past 64 KiB, answer 431 and close.
   - A container create is a `POST` whose path (the target before any `?`) matches
     `^/(v[0-9][0-9.]*/)?containers/create$`. For a create: answer 400 when it carries `Transfer-Encoding` or `Upgrade`,
     or not exactly one `Content-Length` made of digits only; 413 when that length is over 1 MiB. Read exactly that many
     body bytes; run `rewriteCreate`; on a refusal answer 403 and forward nothing; otherwise forward the request line, the
     original headers without `Content-Length`, `Connection` and `Keep-Alive`, then `Content-Length: <the new body's byte
     length>` and `Connection: close`, then the new body, and pipe the upstream's answer back unchanged. Bytes the client
     sends after the body are not forwarded.
   - Any other request without an `Upgrade` header: forward its head with `Connection` and `Keep-Alive` replaced by
     `Connection: close`, then pipe both directions unchanged (its body, chunked or not, is never parsed).
   - Any other request with an `Upgrade` header (exec and attach hijacks, `Upgrade: tcp`; the CLI's `DockerExecOnce`
     uses one): forward the original bytes unchanged and pipe both directions for the life of the connection.
   - Decided (the one departure from "byte for byte"): `Connection: close` on every forwarded non-upgrade request, so
     each connection carries exactly one request and the relay never has to find a request boundary inside a body it
     does not parse (a chunked upload). Docker's Go client opens a new connection when an answer says close. Responses
     are never touched.
   - A refusal or error answer: `HTTP/1.1 <status> <reason>`, `Content-Type: application/json`, `Content-Length`,
     `Connection: close`, body `{"message":"restore-check's loopback relay refused this container create: <reason>"}`
     (the 502's message says the relay could not reach Docker at the path, with the error code). That is Docker's error
     shape: the CLI prints it as "Error response from daemon: ...". Then end the connection.
   - Upstream: `net.connect(<the relayTarget path>)`; when it cannot connect, answer 502.
   - Every socket gets an 'error' handler that destroys both ends: nothing a client or the upstream does may crash the
     worker. `allowHalfOpen` on both ends, so a half-closed hijack is relayed.

### 2. `scripts/restore-check.mjs`

a. The upstream: `process.env.DOCKER_HOST` when it is not empty (the CLI and docker.exe let it override any context),
   otherwise `docker context inspect --format {{.Endpoints.docker.Host}}` through the script's own `docker()` (it must
   succeed; trimmed). Resolve it and start the relay right after `createLoopbackNetwork()`, before `supabase start`.
   Print one line naming the endpoint the relay forwards to (no secrets are involved).
b. Only `supabase start` runs with `env: { ...process.env, DOCKER_HOST: relay.dockerHost }`. Close the relay as soon as
   the start returns (`try`/`finally`), before `mustSucceed`. Also close it in `cleanup()` as its own `step`, so that
   Ctrl+C or a throw cannot leave the socket's folder behind. Every other docker and supabase call (the pre-clean, stop,
   status, port, ps, cp, exec) keeps the caller's environment: never the relay.
c. Widen `assertLoopbackOnly` (the refuter's (b)): the database container by name (`supabase_db_<id>`) and Kong by name
   (`supabase_kong_<id>`; 55321 reaches the same rows with the CLI's default key) must each show at least one binding
   (round S's S-A3 rule, now for both); then every container listed by
   `docker ps -a --filter label=com.supabase.cli.project=<id> --format {{.Names}}` or by
   `docker ps -a --filter name=<id> --format {{.Names}}` (the two lists `battery-backup.sh` makes), with those two by
   name, must have every binding on 127.0.0.1 (the line test `/->\s*127\.0\.0\.1:\d+$/`, unchanged). A `docker port` or
   `docker ps` that fails refuses. Each refusal names the container and its bindings and ends, as today, with why
   ("... behind the CLI's default credentials."). The guard reads through plain docker only. Loosen nothing.
d. Keep `createLoopbackNetwork` and `--network-id` (still right on a Linux engine). Correct every comment that says the
   network alone keeps the stack on loopback (the file's header, lines 23 to 27; `createLoopbackNetwork`'s and
   `assertLoopbackOnly`'s doc comments): Docker Desktop does not apply the network's default binding (say only that; the
   refuter: which component drops it is not proven), so the relay writes 127.0.0.1 into each binding and the guard
   checks the result.

### 3. Tests

a. `tests/unit/docker-loopback-relay.test.ts`: runs on every platform, Windows included, over a real named pipe there
   (a unix socket elsewhere), never touching the real Docker. A fake upstream (`node:http` on its own named pipe or
   socket) records each request (method, url, headers, body) and answers. The relay is started with the real
   `startLoopbackRelay`, so the worker is exercised; requests go through its endpoint with `node:http` (`socketPath`).
   Cases:
   1. A versioned create with a query and three bindings: HostIp `""`, no HostIp, and `"127.0.0.1"`. The upstream gets
      `"127.0.0.1"` in all three, everything else deep-equal to what was sent, a Content-Length equal to the body's byte
      length, and `Connection: close`; the client gets the upstream's status and body unchanged.
   2. An unversioned `/containers/create` is rewritten too.
   3. Each refusal answers 4xx with the relay's message, and the upstream receives nothing: HostIp `"0.0.0.0"`, HostIp
      `"::"`, `PublishAllPorts: true`, NetworkMode `"host"`, another network, no HostConfig, a body that is not JSON, a
      chunked create, a create without Content-Length, an unsafe integer.
   4. A non-create request whose answer streams (chunked, several writes) reaches the client byte for byte, and the
      upstream sees `Connection: close`.
   5. An `Upgrade: tcp` request is relayed both ways after the upstream's 101 (an echo).
   6. `relayTarget`: npipe and unix map to their paths; `tcp://`, `ssh://`, a remote pipe and `""` throw.
   7. The endpoint is a named pipe on Windows and a unix socket elsewhere; on POSIX its folder is 0700 and gone after
      `close()`; after `close()` a connection fails.
   8. The real flow on every platform: while the test's main thread is blocked in `spawnSync` (as restore-check's is
      during `supabase start`), a child node process sends a create through the relay and gets the upstream's answer, the
      upstream (in another worker or a child process, since the main thread is blocked) having received `127.0.0.1`.
b. `tests/unit/restore-check.test.ts`, the stand-in suite (it stays POSIX-only): every rehearsal must reach the relay
   with a valid upstream (a default `DOCKER_HOST` in `rehearse()`'s env, such as `unix://<run>/upstream.sock`), and Kong
   gets a loopback binding wherever a test expects the run to go on (`VERIFIES`, the "goes on" case). New cases:
   1. A stand-in `supabase start` that really sends a create through the `DOCKER_HOST` it was given (5432/tcp with
      HostIp `""`, NetworkMode the scratch network) to a fake upstream running in another thread or process (the test's
      main thread is blocked in `spawnSync`): the upstream receives `"127.0.0.1"`; the start's DOCKER_HOST is the
      relay's, not the caller's; the calls after the start (`docker port`, `supabase status`) see the caller's
      DOCKER_HOST; the run's temp folder is empty afterwards (the relay's folder removed).
   2. The same start sending HostIp `"0.0.0.0"`: the relay refuses, the stand-in exits non-zero as the CLI would, the
      upstream received no create, and nothing is restored.
   3. The guard: a labelled container other than the database (`supabase_rest_<id>`) on 0.0.0.0 refuses, naming it,
      before any `docker cp`, `docker exec` or `supabase status`; Kong with no binding refuses; Kong on 0.0.0.0 refuses;
      a container found by name only (not by label) on 0.0.0.0 refuses; a failing `docker ps` refuses.
   4. With DOCKER_HOST unset, the upstream comes from `docker context inspect` (the stand-in prints `unix:///...`); a
      `tcp://` answer refuses before `supabase start`, naming it.
   Keep every existing assertion that still describes the behaviour; adapt the ones the widened guard changes; delete
   none silently.
c. Run, each once, in the foreground, with a timeout: `pnpm lint`; `pnpm typecheck`;
   `pnpm exec vitest run tests/unit/docker-loopback-relay.test.ts tests/unit/restore-check.test.ts`; then `pnpm test`
   (the whole unit suite). On Windows the stand-in suite is skipped and CI on Linux runs it, so write those cases with
   care: they cannot be run here.

### 4. `docs/operations.md`

The "Where it listens" bullet: how the binding is made now (a relay around `supabase start` only, on a named pipe or a
private socket, never TCP, writes 127.0.0.1 into every published port of each container the CLI creates; a create that
asks for another address, `PublishAllPorts` or another network is refused, so the start fails closed); that the network
is still created with its loopback option and handed over with `--network-id` (what holds on a Linux engine; Docker
Desktop does not apply it); what the guard checks now (the database and Kong, at least one binding each; every
container found by label or by name, only on 127.0.0.1). The tests paragraph: the relay's own test runs on every
platform, Windows included, over a real named pipe; the POSIX stand-in suite includes a start that sends a real create
through the relay; only a real run proves Docker's side. Keep the sentence about the 2026-10-14 run, and add that the
relay is the fix and the rehearsal is to be run again (I56). Normal prose in the file's own style; no new heading.

## Style

Match the surrounding code: comments are full sentences that say why; the files' own naming and idioms; no new
dependency; no unrelated refactor; mark a deliberate shortcut with `// ponytail:` and its ceiling. Keep it small: the
adjudication sized the whole change at about 200 to 250 lines before the refuter's additions.

## Report back (short)

`git diff --stat` and the new files' line counts; each command with its exit code and pass/skip counts; the existing
assertions you changed and why; anything you did differently from this brief and why; the risks only the real rehearsal
can settle. Do not self-accept.
