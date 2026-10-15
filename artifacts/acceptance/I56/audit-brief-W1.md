# I56, round W1: the auditor's brief

The auditor: a fresh Claude Opus 5.5 at effort max, read-only. The writer was a Claude Opus 5.5 at effort xhigh (D48 (4));
the orchestrator (Claude Opus 5.5, effort max) holds the lock, read every line of the security-relevant diff, and rules
on your findings.

## What to audit

The uncommitted diff on branch `agent/i56` against `f022fed` (`git diff f022fed -- scripts docs tests` plus the two new
files, which are untracked: `git status --short`):

- `scripts/lib/docker-loopback-relay.mjs` (new)
- `scripts/restore-check.mjs`
- `tests/unit/docker-loopback-relay.test.ts` (new)
- `tests/unit/restore-check.test.ts`
- `docs/operations.md` (the rehearsal's guarantees and its tests paragraph)

The writer's brief, with the orchestrator's design rulings marked "Decided", is `artifacts/acceptance/I56/brief-W1.md`.
The defect and the audited design are `PLANS/ISSUES.md` I56 and `artifacts/acceptance/FABLE-AUDIT/after/adjudicate-backup-rehearsal.md`
(the auditor's fix and the refuter's corrections (a), (b) and (c)); the machine's facts are
`artifacts/acceptance/FABLE-AUDIT/after/backup-bindcheck.txt`. The Supabase CLI v2.106.0 source can be read with
`gh api "repos/supabase/cli/contents/<path>?ref=v2.106.0" --jq .content | base64 -d` (for example
`apps/cli-go/internal/utils/docker.go`, `apps/cli-go/internal/start/start.go`, `apps/cli-go/internal/db/start/start.go`).

## What to verify

1. The guard is not weakened anywhere. Compare the old `assertLoopbackOnly` (at `f022fed`) with the new one line by
   line: round S's S-A3 rule (the database container must show at least one binding) kept; Kong required too; every
   container found by label or by name checked; a failing `docker ps` or `docker port` refuses; the line test unchanged;
   the guard reads through plain docker, never the relay.
2. The rewrite rule (`rewriteCreate`): correct and fail-closed for every case the brief lists. Find any path by which a
   container create of the Supabase CLI 2.106.0 could reach Docker with a binding not on 127.0.0.1, and any path by which
   a request the relay does not parse as a create could create or publish a container (a reused keep-alive connection,
   pipelined bytes, an upgrade).
3. The transport: one request per connection (`Connection: close`, the brief's one "Decided" departure from byte for
   byte), the upgrade passthrough, streamed answers, half-close, every error path (no worker crash, no hang), the
   400/403/413/431/502 answers, sockets left open.
4. The worker: it serves while the main thread is blocked in `spawnSync`; start-up and tear-down; the permanent 'error'
   listener; `unref`; `close()` idempotent and safe in restore-check's synchronous 'exit' cleanup; the POSIX folder's
   removal; the Windows named pipe's default security against the design's "an endpoint private to the user".
5. `restore-check`: only `supabase start` gets the relay's `DOCKER_HOST`; the relay is closed before the guard runs;
   the cleanup steps' order; Ctrl+C, SIGTERM and SIGHUP; the failure paths (an endpoint it cannot relay, a relay that
   cannot start) still remove the network and the temp folders and exit non-zero.
6. The CLI side, from its v2.106.0 source: every Docker API call `supabase start` makes passes through the relay intact
   (pulls, volume and network calls, inspects, logs, exec); every container create carries a `HostConfig` whose
   `NetworkMode` is the `--network-id` value (`apps/cli-go/internal/utils/docker.go:250-306`); nothing in `start` that
   is enabled in the scratch stack (restore-check's `patchConfig` turns studio, inbucket, local_smtp, analytics, realtime
   and edge_runtime off) mounts or uses the Docker endpoint itself (vector's `DaemonHost` use is analytics only).
7. The tests prove what they claim: would they fail if the rewrite were removed, if `supabase start` did not get the
   relay's `DOCKER_HOST`, if another call did, if the relay ran on the main thread? The POSIX stand-in cases cannot run on
   this Windows machine (CI runs them on ubuntu-24.04 with Node 24): read them for correctness. Flakiness (a fake Docker
   that records its first `data` chunk as the head; timeouts; pipe-name collisions), cleanup of servers, workers and
   folders.
8. `docs/operations.md`: no claim beyond what is built or proven; it says only that Docker Desktop does not apply the
   network's default binding (the refuter: which component drops it is not proven).
9. Scope and hygiene: only those five paths and `artifacts/acceptance/I56/` changed (`.claude/launch.json` and
   `.claude/settings.json` were dirty before the round and are the owner's: do not open them); no secret; nothing in
   `PLANS/`.

Residuals the orchestrator already knows, for you to rule on as well: on POSIX, a Ctrl+C in the ~50 ms while the relay
starts can leave its empty 0700 folder behind (`relay` is assigned after the start resolves); the 502 path has no test;
the stand-in suite's relay socket path can exceed macOS's 104 bytes.

## Rules

Read-only: edit, create or delete no file anywhere in the repository. Never read or print `.env` or any settings file
(`.claude/settings*.json`, `.mcp.json`). Never run `docker`, `supabase`, `pnpm restore-check` or `pnpm backup`: a real
development stack runs on this machine. The orchestrator runs lint, typecheck and the unit suite itself; you may run
`pnpm exec vitest run tests/unit/docker-loopback-relay.test.ts` or the restore-check file once if a question needs it.
No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then: which attack, race or edge case no test covers. Short and exact; no
hedged verdict.
