# Handoff: local session to the next session (2026-09-27)

From the local orchestrator session of 2026-09-27 (Opus 5.5, max effort). The repository is the source of truth; read this, then `PLANS/EXECUTION-STATUS.md` "Next work".

## Start

```sh
git fetch origin
git checkout sync/local-2026-09-26
git pull --ff-only origin sync/local-2026-09-26   # the commit that adds this file, or later
```

Follow `CLAUDE.md`, `AGENTS.md` and `PLANS/README.md`. No lock is held: the previous session released `.anasaq-execution.lock` after its last commit. Create it with `fs.openSync(path, 'wx')` before writing. The local Supabase stack is running with the content imported and every migration applied (through `20260927140000_privacy_requests.sql`); never stop or reset it without re-importing (`pnpm db:reset` then `pnpm db:import`).

## Roles and how work was run (D28, D30)

- The orchestrator audits, fixes and signs off; `glm-worker` builds. Each GLM task: write a brief to `artifacts/acceptance/P06/brief-<step>.md` with exact paths and checks, commit it, retask the lock to `glm-worker` with the allowed paths, then run once in the background: `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN node scripts/glm-worker.mjs <brief>`. On completion: prove it exited, diff against the allowlist, read every changed file, fix, re-prove (a clean `supabase db reset` + `pnpm db:import` whenever the worker edited an applied migration), record evidence at the end of `artifacts/acceptance/P06/commands.txt`, commit, push.
- GLM-5.3 stays the builder: screenshots are reviewed by the orchestrator, so no vision model is needed.
- The owner approved commits and pushes to `sync/local-2026-09-26` step by step ("go ahead"). Package acceptance of P06 as a whole still needs his explicit approval.

## What this session did (all pushed)

| Commit | What |
|---|---|
| `71a8849` | Local verification of `00586ea`: test:db 115, e2e 67/67, the no-upsert and `cf-connecting-ip` proofs |
| `5b1f910` | Prompt audit of the instruction files: decision ranges, graft guidance, `opus-worker-lite` folded into `opus-worker` |
| `0de9d07` | H2: routine e2e reports go to `test-results/`; `ACCEPTANCE_PACKAGE=Pxx` keeps a package's report |
| `3520028` | I29 and I34: the deploy hook's answer is checked and retried (`site_build` job), and a daily `media_sweep` removes day-old quarantine parts through the Storage API |
| `068fd6a` | `glm-worker.md` stack rules; `AGENTS.md`: the owner sets the orchestrator's effort |
| `8241d47` | Step 3: commerce settings without tax (D34), owner step-up, audited |
| `cf69955` | D35: backups are owner-run and local |
| `c450031` | Step 5: `pnpm backup` / `pnpm restore-check` (restore proven: 44 tables, 222 objects, 49 s) |
| `5008138` | Step 6: `docs/costs.md` (cited prices); D36: contact messages kept 90 days after their notice reaches a mailbox |
| `29c2cdc` | Step 4: `privacy_erase_staff`, `privacy_erase_contacts`, the D36 `contacts-purge` job, `docs/privacy-data-map.md` |

## Next work, in order

1. **I37: a cold `next dev` after `pnpm build` 404s `/admin/content/site_settings/edit`** (details in `PLANS/ISSUES.md`). Give the e2e dev server its own dist dir so a build never shares state with it, then prove `owner-operations.spec.ts` passes cold right after `pnpm build`. Until it is fixed, delete `.next` before an e2e run that follows a build.
2. **I35: the email job reads stale on an idle hosted site.** Since D32 the outbox runs only while a row is due, so the owner home's 10-minute rule would warn on a quiet site. Fix: a SQL function (owner/operations, like `job_runs_latest`) returning when the oldest due row became due (`pending`/`uncertain` with `next_at <= now()` and attempts left, or an expired `sending` lease); the home warns only when a row has waited more than 10 minutes. Write the warning without an em dash. Integration test for the function and its role check; e2e with one planted row due 15 minutes ago.
3. **The phase 2 gate walk-through** (`PLANS/WORK-PACKAGES.md` P06): acting as the owner, add and crop an image, write and publish a post, edit and reorder a section without code, and open every admin screen at 360 and 1440; no blank CRUD screens. Read `PLANS/DESIGN-AUDIT.md` first. Known finding for it: round 2 admin text uses em dashes (item 2), for example the owner home's «سليم — …» and «المتجر غير مُهيأ — …», and the settings status lines «Mailpit (محلي) — …» and «تعذّر تحميل الحالة — …». Then run the full acceptance battery with `ACCEPTANCE_PACKAGE=P06`, record it, and ask the owner to accept P06.

## For the owner and Anas

- **Privacy policy (E08):** it must state that contact messages are kept 90 days after they reach the mailbox (D36), and describe the backups (D35). Anas approves the wording.
- **R2 in the signed offer:** the offer lists Cloudflare R2 for files (lines 1556, 1785, 1956); D32 uses Supabase Storage. Tell Anas, as with Payload (D29).
- **I33:** the 18 room videos are git-ignored, so a Pages build has none. Commit them or upload them to Storage before launch.
- **Key rotation:** rotate the Resend key, the hosted Supabase keys and the Cloudflare token if this folder was ever synced, zipped or shared (the deleted `.open-next/` and `.wrangler/` had them inlined).
- **Machine hygiene:** several MCP servers on this machine receive Supabase access tokens as plain command-line arguments, which any process listing shows. Move them to environment variables. A process listing during this session printed their first characters.
- **Hosting (P11), only when the owner authorizes it:** the Pages project, the Vault values and function secrets, `supabase functions deploy`, the I32 probes, and two checks added this session: that the migration role may update `auth.users` and `auth.audit_log_entries` on the hosted project (the privacy erase needs it), and Anas's first `pnpm backup` (linked) on the first hosted day. Read the `.studio` renewal price in the Cloudflare dashboard (`docs/costs.md`).

## Rules to keep

Never read or print `.env` contents. Never edit `deploy/design/`, never inspect `_archive/`. No invented prices, payments or E-gate closure. Never stop the development stack with `--no-backup`. Playwright runs on `http://localhost:3000`. After any e2e run, restore every screenshot the task did not change, and `next-env.d.ts`. Mark anything not actually run as pending.
