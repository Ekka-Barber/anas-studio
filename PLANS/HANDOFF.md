# Handoff: cloud session to local work (2026-09-27)

From cloud session `session_01A6YV5NxaAXMhQXrkxtt5Pr`
(https://claude.ai/code/session_01A6YV5NxaAXMhQXrkxtt5Pr). The owner's files
are on the local machine, so work continues there. Read this, then
`PLANS/EXECUTION-STATUS.md` "Next work".

## Get the code

```sh
git fetch origin
git checkout sync/local-2026-09-26
git pull --ff-only origin sync/local-2026-09-26   # the commit that adds this file, or later
```

Follow `CLAUDE.md`, `AGENTS.md` and `PLANS/README.md`. One writer: create
`.anasaq-execution.lock` with `fs.openSync(path, 'wx')` before writing. If an
old lock from P06 round 2 is still on this machine, prove its owner stopped,
inspect the diff, record the recovery, then release it; never remove it
because it looks old. The cloud session holds no lock.

## Where things stand

- D32–D34 are committed. The site is a static Next.js export (`out/`) served
  by Cloudflare Pages. The admin is a browser app on Supabase. Server work
  runs in Supabase Edge Functions
  (`supabase/functions/{contact,resend-webhook,outbox,admin,staff-admin}`,
  shared code in `supabase/functions/_shared/`). pg_cron runs the jobs:
  `site_build_trigger()` calls the Pages deploy hook, and `outbox_kick()`
  calls the outbox function. Media lives in Supabase Storage (`media-private`,
  `media-public`). `service_role` replaced `app_server`, which is dropped.
  Thmanyah is the only font. There is no tax. The site launches before
  payments, with the store showing «قريباً».
- D31 and D32 were verified locally on the full stack at `eed6625`: test:db
  115/115, e2e 67/67, build/export/budgets green, and room screenshots in
  `artifacts/acceptance/P01/screenshots/`.
- The local audit-fix pass `3c4347c` was audited in the cloud, which added:
  - `00586ea`: the contact rate-limit key takes `cf-connecting-ip` first,
    then the LAST `x-forwarded-for` hop, then `local`. Signed upload URLs
    are created without upsert. `check-budgets` scans every folder depth,
    still skipping `admin.html` and `admin/**`.
  - `33e42c6`: I32/I34 updated, `docs/operations.md`, EXECUTION-STATUS (the
    round 3 order), and the audit record in
    `artifacts/acceptance/P06/commands.txt`.

## Step 1: verify `00586ea` locally (not run yet; needs Docker and the full stack)

1. `pnpm install --frozen-lockfile`.
2. Restart with `supabase stop`, then `supabase start`. Never use
   `--no-backup`: it wipes the imported content.
3. Take `DATABASE_URL` from `supabase status -o json` (`DB_URL`), then run
   `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db`.
4. `pnpm check`, `pnpm build`, `pnpm check:export`, `pnpm check:budgets`.
5. Playwright on `http://localhost:3000` (not 127.0.0.1):
   - `media.spec`: its two new assertions check that a second upload to a
     signed URL is refused. This is their first real run.
   - `owner-operations.spec`: the contact bucket is now keyed by
     `cf-connecting-ip`.
   Restore the P00 playwright report afterwards if the run overwrites it
   (H2).
6. Record the results at the end of `artifacts/acceptance/P06/commands.txt`,
   update `PLANS/EXECUTION-STATUS.md`, commit with the repo's trailers and
   push `sync/local-2026-09-26`.

## Step 2: P06 round 3, in this order, one step at a time, with evidence

1. **H2:** give each package its own Playwright report folder, so runs stop
   overwriting the P00 report.
2. **One pg_cron migration for I29 and I34.**
   - I29: remove `media-private` `quarantine/` objects and
     `media_upload_tickets` rows older than a day.
   - I34: store the id `net.http_post` returns in `finance.site_builds`. On
     the next run, read `net._http_response` for it. If the status is not
     2xx or the call timed out, re-arm the request (`triggered_at = null`).
     Record every attempt in `finance.job_runs` as `site_build`, so the
     owner home shows it.
3. **Commerce settings** without any tax field (D34; DATA-AND-SECURITY
   `commerce_settings`).
4. **The I31 privacy runbook** in `docs/privacy-data-map.md`.
   - Buyers are guests (D08), so a customer request touches customers and
     orders only, never `auth.users`.
   - A departed staff member is revoked (already built). If they ask for
     erasure, replace their email in `auth.users` with a placeholder instead
     of deleting the user; `audit_events` stays append-only.
5. **Backups:** a nightly `supabase db dump` plus a Storage object manifest,
   encrypted, with a restore check (`scripts/{backup,restore-check}.mjs`,
   `.github/workflows/backup.yml`). The destination and who holds the key
   are Anas's decision (E07); ask, don't invent.
6. **`docs/costs.md`:** Pages, Supabase, Resend, Email Routing and the
   domain, with cited current prices only.

Then the phase 2 gate walk-through (WORK-PACKAGES P06). Commit P06 only with
the owner's approval.

## Open flags for the owner

- **R2 in the signed offer.** The offer lists Cloudflare R2 for images and
  files (offer lines 1556, 1785, 1956). D32 uses Supabase Storage instead.
  Tell Anas, as with Payload (D29). If he wants R2, it is a contained change
  behind `MediaStore` in `supabase/functions/_shared/admin.ts`.
- **I33, the room videos.** The 18 room videos (`public/media/*.mp4`, 55.9
  MiB) are git-ignored, so a Pages build from the repository has none.
  Before launch, either commit them or upload them to Storage.
- **Key rotation.** The deleted `.open-next/` and `.wrangler/` folders had
  live secrets inlined. Rotate the Resend key, the hosted Supabase keys and
  the Cloudflare token if the project folder was ever cloud-synced, zipped
  or shared.
- **Hosting (P11)**, only when the owner authorizes it:
  1. Create the Pages project: build `pnpm build`, output `out`, Node 24,
     and the `NEXT_PUBLIC_*` values.
  2. Put `pages_deploy_hook`, `functions_url` and `jobs_secret` in Vault.
  3. Run `supabase functions deploy` and `supabase secrets set`.
  4. Run the I32 probes (IP header, Storage nosniff, Pages build count).
  5. Only after the new site works, the owner deletes the old Worker,
     Hyperdrive, D1 and R2 resources himself. This is irreversible.

## Rules to keep

- Never read or print `.env` contents.
- Never edit `deploy/design/`, and never inspect `_archive/`.
- No invented prices, payments or E-gate closure.
- Before any UI work, read `PLANS/DESIGN-AUDIT.md`.
- Mark anything you did not actually run as "pending local verification".
