# Preparation readiness: 2026-09-22

Preparation only. No product code, P00, scaffolding, runtime acceptance, or launch
approval. Execute on Claude under D24, using [README.md](README.md) and the sole
kickoff [FIRST-GLM-PROMPT.md](FIRST-GLM-PROMPT.md).

## Ready inputs

- `Ekka-Barber/anas-studio` is private; the D24/D25 baseline was pushed to `main`.
- `anas.studio` exists in the client Cloudflare account; the earlier read-only
  account/zone check found an active zone. This is not launch DNS/TLS acceptance.
- The owner reports the Supabase `ANAS.STUDIO` Free project and local `.env` are
  supplied. `.env` is ignored and untracked. Database connectivity is untested.
- Plans are migrated to Fable plus Opus workers and the canonical domain. The
  three worker/auditor definitions exist. `AGENTS.md` and `CLAUDE.md` carry the
  execution contract; [SKILLS.md](SKILLS.md) locates the six working skills.
- Node, pnpm, Python, Claude, Graft, and CodeGraph are installed. Docker engine
  29.8.0 was started during the earlier preparation checks.
- Graft was rebuilt; CodeGraph sync and a live MCP query passed. Its daemon was
  alive after the query. Normal idle shutdown does not mean the index is stale.

## Still pending

- **E02:** Moyasar onboarding/test/live acceptance has not started.
- **E01:** Resend domain DNS verification and Anas organization invitations.
  Earlier Resend domain inspection returned `restricted_api_key`; this does not
  prove the sending key is invalid. Cloudflare account/zone reads succeeded, but
  its R2 management request returned HTTP 403; R2 object credentials are untested.
- **E06:** font web/subsetting/distribution license evidence.
- **P06/P10:** Turnstile, Sentry, and UptimeRobot setup and actual acceptance tests.
- Regenerate the database password before live use. Verify connections and scoped
  credentials in P00; account existence is not a runtime pass.
- The earlier clean-environment Claude auth check reported a Pro subscription,
  while D24 records Max. Confirm the intended subscription and model availability
  in Claude before dispatch; this preparation does not alter D24.
- P00 and every later package remain unstarted. All other E gates remain open
  until their required evidence exists; the list above is not a launch waiver.

## Checks and launch

Run `powershell -NoProfile -ExecutionPolicy Bypass -File PLANS/verify-readiness.ps1`.
It checks structure, permitted tracked text for known secret patterns, graph
freshness, and the unchanged plan verifier. Results and lock recovery are saved
in [evidence/preflight-checks.json](evidence/preflight-checks.json). Pattern scans
are not exhaustive secret detection; they exclude forbidden source directories.
No `.env` contents are read by the checker.

For Claude subscription auth, remove `ANTHROPIC_BASE_URL` and
`ANTHROPIC_AUTH_TOKEN` from the launch shell's environment only, then run
`claude auth status` privately. Do not change global settings or paste auth output.
Confirm no preparation lock remains, review the pending inputs, then use the
kickoff for **P00 only**. Never treat this preparation report as permission to
start implementation automatically.
