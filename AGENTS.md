<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->

<!-- PONYTAIL_CAVEMAN_START -->
## Default working style (user preference — all agents)

- **Ponytail (full) by default** — laziest solution that actually works: YAGNI ladder (skip unneeded -> stdlib -> native platform -> existing dep -> one-liner -> minimal code). Shortest working diff. No unrequested abstractions, no boilerplate. Mark deliberate shortcuts with `ponytail:` comments. NEVER simplify away: trust-boundary validation, data-loss error handling, security, accessibility, explicitly requested work.
- **Caveman (full) for conversational output** — terse: no filler, pleasantries, hedging, or tool-call narration; fragments OK; drop articles where unambiguous. Keep technical terms, numbers, errors, code EXACT. Write normal prose in anything persisted (code, comments, commits, docs, PR text). Drop compression for security warnings, irreversible-action confirmations, or ambiguity.
- Reply in the user's dominant language always. Off-switches: "stop ponytail" / "stop caveman" / "normal mode". Levels: `ponytail lite|full|ultra`, `caveman lite|full|ultra`.
<!-- PONYTAIL_CAVEMAN_END -->

<!-- ANASAQ_EXEC_START -->
## ANASAQ execution contract (all agents)

- Authority: `PLANS/` is the plan of record. Execute packages P00→P12 in order from `PLANS/WORK-PACKAGES.md`; P00 (runtime spike) gates everything after it. `PLANS/DECISIONS.md` D01–D30 are settled (D02 superseded by D29).
- Orchestrator (main session, Claude Opus 5.5 per D28): plans, dispatches, audits, accepts, fixes, and does all major design work itself. It holds the lock whenever it writes product code.
- Builder: `glm-worker` (Z.AI GLM-5.3, 1M, max effort; D30) from `.claude/agents/` for long, well-specified work, launched with `node scripts/glm-worker.mjs <brief-file>`, never the Agent tool. Set `model` explicitly on every other sub-agent dispatch. `opus-worker`/`opus-worker-lite` only on the owner's request. Exactly ONE active writer, holding the exclusive lock (fs.openSync 'wx'). No writer spawns a writer.
- The orchestrator fixes small audit findings itself; large ones go to a fresh bounded worker (never a resumed one). Token rules: CLAUDE.md "Token budget" (I24). Never self-accept; the orchestrator accepts after independent inspection.
- Forbidden: editing `_archive/` or frozen sources under `deploy/design/`; inventing prices, approvals or E-gate closure; bypassing a failed gate; staging unrelated edits into a package commit; touching `.env` (read keys via environment only).
- Secrets live only in `.env` (gitignored). Never in code, chat, commits, logs or artifacts.
- Claude Code specifics: the orchestrator uses subscription auth — do not set ANTHROPIC_BASE_URL/AUTH_TOKEN for its session; only `scripts/glm-worker.mjs` sets them, for the worker process (D30); Opus effort is xhigh globally (quota, not money, is the constraint).
<!-- ANASAQ_EXEC_END -->

