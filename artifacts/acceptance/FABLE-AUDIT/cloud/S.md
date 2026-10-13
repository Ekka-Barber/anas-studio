# Round S (cloud continuation): the record

Orchestrator: Claude Opus 5.5 at effort max, the cloud continuation session under D48 (2026-10-08 to 2026-10-13). Workers: Claude Sonnet 5.5 at effort max (round S, then S-fix for the audit's findings). Auditors: Claude Opus 5.5 at effort max (the first attempt died on the account's weekly limit on 2026-10-08 before it reported; the retry ran on 2026-10-13), then a fresh one for S-fix. The orchestrator's own fixes after that go to a focused Opus audit, run on the committed tree; its result is added to this record when it reports. The brief of record is `../work/briefs/brief-S.md`; `brief-S.md` and `brief-S-fix.md` beside this file adapt it to the cloud and to the owner's rulings of 2026-10-08: S-3 skipped (the owner's local exclude rules stay local), the audit gate kept at level high with the unused Sass dropped (no advisory ignored), Next to 16.3.8.

## What changed

| Item | Status | What changed | Proof |
|---|---|---|---|
| S-1 (SUPPLY-10) | done | `packageManager` pnpm 10.33.0 → 10.34.6 (published 2026-09-28; pnpm's 18 advisories all match < 10.34.5); docs/development.md's version line | `pnpm --version` 10.34.6; `pnpm install --frozen-lockfile` left the lock unchanged |
| S-2 (SUPPLY-03, VENDOR-PLAT-07) | done | next and eslint-config-next 16.3.5 → 16.3.8 (2026-09-30), sharp 0.35.4 → 0.35.5 (2026-09-27) with its @img platform packages and libvips 1.3.3 → 1.3.4, source-map-js 1.2.1 → 1.2.2 (2026-09-30, a normal transitive update under postcss), Sass 1.77.4 and its subtree removed (sass, chokidar, readdirp, anymatch, immutable, binary-extensions, is-binary-path, normalize-path: an optional peer of next and vite that nothing uses: no .scss or .sass file). No override and no ignored advisory are left in package.json; the lock went from 577 to 569 packages with no new package name. CI gains `pnpm audit --prod --audit-level=high` right after the install: a new critical or high runtime advisory turns the job red (VERIFICATION.md), and so does a registry outage (fail closed; a re-run is the remedy) | `pnpm audit --prod` before: 1 critical, 4 high; after: no known vulnerabilities (0 advisories, 157 dependencies); the auditor proved the lock with an offline frozen install in an isolated copy and checked ten integrity hashes against npm |
| S-3 (SUPPLY-01) | skipped | The owner's ruling | — |
| S-4 (SUPPLY-06) | done, widened | `.gitattributes`: `deploy/** -text` (not only `deploy/design/**`: the frozen manifest pins 50 files under deploy/, and `deploy/mobile-fix.css` is stored with LF outside design/) and `*.woff2`, `*.pdf`, `*.mp4`, `*.webp`, `*.png`, `*.jpg` binary; nothing else | check:frozen 0; `git check-attr` and `git ls-files --eol`: no tracked file changes under the attributes |
| S-5 (SUPPLY-11, -05, -08, -09) | done, then fixed (S-fix) | scripts/restore-check.mjs: the scratch stack's network created first, bound to loopback and labelled for `supabase stop`, the stack started on it, the restore refused unless `docker port` shows bindings and every one is on 127.0.0.1; the linked project's service versions copied into the scratch workdir for a linked backup; the inside-the-repository guard on real paths (also in scripts/backup.mjs); after the stop, a non-zero exit naming any container or volume of the scratch project that remains ("plaintext restored data is still on disk"), each cleanup step isolated | tests/unit/restore-check.test.ts and backup-cli.test.ts with a PATH stand-in harness (POSIX only; skipped on Windows, the owner's machine); see S-fix below |
| S-6 (VENDOR-PLAT-05) | reverted by ruling | supabase/config.toml stays as it was: the key unset. The Supabase CLI's own source (`ApplyApiPrivileges`, v2.106.0, v2.116.0 and v2.120.0, read on 2026-10-08 and again by the auditor on 2026-10-13) revokes the Data API's default grants unless the key is explicitly true, so unset and false are the same today; the finding's premise (that 2.116.0 made unset mean auto-expose) is false for this code. The key is due to be removed on 2026-10-30 and 2.106.0 decodes config.toml strictly, so an explicit key is a risk for a later CLI. Recorded: re-check the key's meaning at any CLI upgrade | auditor agreed |
| S-7 (FIX-A1-05 / SUPPLY-02) | done, then completed (S-fix, the re-audit's Q4) | Both graft helpers (`graft-hooks.cjs`, and `graft-statusline.cjs` after the audit) resolve only @nanonets/graft at exactly the version `.mcp.json` pins (0.21.1), from the project's node_modules, the node prefix or the global npm root (npm asked from the node binary's folder); no ancestor node_modules search, no `<project>/dist` fallback; otherwise a silent no-op. The pin note in both headers and in `PLANS/HANDOFF.md`: graft's installer can regenerate these helpers, so check `git diff .claude/helpers` after a graft update, and move `PINNED` with the `.mcp.json` pin | `tests/unit/graft-helpers.test.ts` (10 tests: the pins agree, both helpers resolve the same way, and the helpers run against stand-in packages: the pinned one runs from the project or the global root; another version, another name, an ancestor node_modules or a committed dist runs nothing); each helper run as Claude Code runs it: exit 0, no tracked file changed |
| S-8 (FIX-A1-01, -03) | done | `.splitCenter` (layout.module.css) and the unused `FieldType` alias (src/admin/fields.ts) deleted | no reference anywhere (git grep) |
| F1-15 (EF-ACCESS-08) | deferred by the orchestrator | The pepper's 32-character check fails closed: it would stop the owner's local functions until `pnpm db:env` is run again with a lengthened local pepper. It goes with P11's hosted setup (the hosted secret checked first) | — |

## The audit (Opus 5.5 at effort max): audit_failed; the orchestrator's rulings

| Finding | Ruling |
|---|---|
| S-A1 major (closure): `graft-statusline.cjs` kept the ancestor search and the dist fallback that S-7 removed from `graft-hooks.cjs`; FIX-A1-05's fix names both helpers | Fixed in S-fix (the same pinned resolution) with the pin note |
| S-A2 minor: no test could fail on a rehearsal that exits 0 while scratch data remains (every leftover test ran through the failing start) | Fixed in S-fix: success-path tests, each proven to fail against the mutant |
| S-A3 minor: an empty `docker port` output passed the loopback check; the network could be bypassed | Fixed in S-fix: `--network-id` on `supabase start`, at least one binding required |
| S-A4 minor (older than S): the containment guard compared paths as text (junctions, symlinks, 8.3 names on Windows) | Fixed in S-fix: real paths compared |
| S-A5 minor (older than S): `npm root -g` ran through cmd.exe in the repository's directory on Windows | Fixed in S-fix |
| S-A6 minor: the unfixable dev-only braces advisory (GHSA-vfj7-8cjw-p6xm, via eslint-config-next) is recorded only in ci.yml | Recorded in PLANS/ISSUES.md by the orchestrator |
| S-A7 nit: containers found by an unanchored name substring | Fixed in S-fix: by the CLI's own project label |
| S-A8 nit: a leftover network gave a stack trace without a remedy; one failing cleanup step skipped the others; the runbook does not describe the new guarantees | (1) (2) fixed in S-fix; (3) goes to round D (docs/operations.md) |

## S-fix (Sonnet 5.5 at effort max): the worker's fixes

S-A1, S-A2, S-A3, S-A4, S-A5, S-A7 and S-A8 (1) (2) were each verified true against the code first, then fixed (brief: `brief-S-fix.md`). The worker proved each new test by mutants on a scratch mirror (15 mutants, all killed; `process.exit(exitCode)`, the audit's own mutant, fails 4 tests). Its open question, whether a link inside the repository that leads out of it may be used, it answered yes; the re-audit showed that answer unsafe on Windows (S-R1).

## The re-audit (Opus 5.5 at effort max): audit_failed; the orchestrator's rulings

All eight S-A items were found closed in the code, each proven by the re-auditor's own mutants (21, all killed; the unmutated copy passes).

| Finding | Ruling |
|---|---|
| S-R1 minor: the S-A4 fix compared real paths only, so a path through a link inside the repository that leads out of it passed. Git for Windows treats a junction as a plain folder (compat/win32.h marks only symlink reparse points as links), so `git add -A` would stage the plaintext dumps or the backup behind it | Fixed by the orchestrator, in both scripts: a path is inside when its written form or its real path is inside the repository; the two link-out tests now expect the refusal |
| S-R2 nit: `PLANS/HANDOFF.md` named two graft pins; `PINNED` in the helpers is a third, and one left behind silences the hooks without a message | Fixed by the orchestrator: the graft line names the three pins and the test that fails until they agree |
| S-R3 nit: the stop, the network removal and the leftover check all sat under "the scratch workdir exists", so a run whose workdir vanished could exit 0 with the stack still up | Fixed by the orchestrator: without its workdir the stack is stopped by its project id (as the pre-clean does), and the network removal and the leftover check run whenever the stack was touched; two tests (the stack stopped, exit 0 when nothing remains; exit 1 naming a container that does) |
| Q4: a committed test for the helpers, since graft's upkeep rewrites them | Accepted: `tests/unit/graft-helpers.test.ts` |
| S-A6 (from the first audit) | Recorded in `PLANS/ISSUES.md` as I53 (1), with the CLI key (S-6), the restore rehearsal's Docker side and F1-15 |

Each of the orchestrator's new or changed tests was proven by mutants on scratch mirrors: the old cleanup structure and a stop that needs the workdir each fail the two workdir tests; the real-path-only guard fails the link-out test in each script, the text-only guard the three link-in tests in each; HEAD's helpers fail 8 of the 10 helper tests, a drifted `PINNED` 4, and npm asked from the project 6.

## Checks (the orchestrator, on the final tree, 2026-10-13)

| Command | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0: 2,580 passed, 1 skipped (content.test.ts, older than this round) |
| `pnpm check:frozen` | exit 0 |
| `pnpm check:copy` | exit 0 |
| `deno check` of every function (cache cleared first) | exit 0 |
| `node .claude/helpers/graft-hooks.cjs session-start`; `echo '{}' \| node .claude/helpers/graft-statusline.cjs` | exit 0 each, no output (no graft installed in the container), `git status` and `git diff` unchanged |
| `git diff --check` | clean |

CI on the pushed commit runs the rest, the database steps included, and `pnpm audit --prod --audit-level=high`, the budgets under Next.js 16.3.8 among them.

## The focused audit of the orchestrator's fixes

Pending when this record was committed; added here when it reports.

## What only the owner's machine can prove

A real `pnpm restore-check` on Windows with Docker Desktop: the items of `PLANS/ISSUES.md` I53 (3) (the loopback binding with no IPv6 line, `--network-id`, the project label on every container and volume, the stop by project id leaving ANASAQ.ME alone, Ctrl+C and a closed console); a real junction in a scratch repository refused by both scripts; the owner's global graft at exactly 0.21.1, or the hooks and the status line stay silent by design.
