# Brief: P06 round 3, step 5, owner-run local backups (D35)

You work under `.anasaq-execution.lock` at base commit `cf69955`. Do this one task, run the checks, report, stop. Read `PLANS/DECISIONS.md` D35 first, and Supabase's guide, the source of every dump and restore command below: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore (fetched by the orchestrator 2026-09-27).

## Goal

Anas runs `pnpm backup` on his own machine (Windows or macOS) whenever he chooses. It writes one encrypted file to his machine. `pnpm restore-check <file>` proves a file restores. The owner home shows the last backup. No CI workflow, no cloud destination.

## Hard rules (read twice)

- The development stack (project `ANASAQ.ME`, ports 5432x) keeps running. Never stop it, never reset it, never write test data into it except through the checks named below.
- The restore rehearsal uses its own throwaway stack. Every Supabase CLI call for it passes `--workdir <scratch>`. `supabase stop --no-backup` is allowed only with `--workdir <scratch>`.
- The passphrase is never printed, logged, written to a file or passed on a command line. The only non-interactive source is the environment variable `ANASAQ_BACKUP_PASSPHRASE`, for tests and acceptance.
- Never read `.env`. No secret goes into any file you write.
- Scripts are plain Node 24 ESM with the standard library plus dependencies already in `package.json` (`@supabase/supabase-js`, `pg`). No new dependency. They must work on Windows and macOS: no bash, no POSIX-only commands; spawn `supabase` the way `scripts/glm-worker.mjs` spawns `claude`.

## What to build

1. **`scripts/lib/backup-format.mjs`**: the file format, standard library only (`node:crypto`, `node:zlib`, `node:fs`, `node:stream`).
   - Header: the ASCII magic `ANASAQ-BACKUP\n`, one version byte (1), scrypt parameters as three bytes (log2 N = 17, r = 8, p = 1), a 16-byte random salt and a 12-byte random IV. The whole header is the AES-GCM additional authenticated data.
   - Key: `scrypt(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })`.
   - Body: AES-256-GCM over gzip over the entries; the 16-byte auth tag is the last 16 bytes of the file. Stream it; a backup can be hundreds of MB.
   - Entries, in order: a 4-byte big-endian length, a JSON header `{"path","size","sha256"}`, then the raw bytes. The first entry is `manifest.json`: format version, `createdAt`, `source` (`linked` or `local`) and the list of files with size and sha256.
   - `writeBackup(outFile, entries, passphrase)`, where entries are `{ path, file }`: writes `outFile + '.partial'`, renames on success, deletes the partial file on any failure.
   - `readBackup(inFile, passphrase, destDir)`: extracts into a new or empty `destDir`, checks every entry's size and sha256 and the auth tag. On any failure it deletes everything it wrote and throws an error with `code` `NOT_A_BACKUP` (bad magic or version), `WRONG_PASSPHRASE_OR_DAMAGED` (the tag fails) or `CORRUPT` (entry framing, size or hash).
   - `assertSafeEntryPath(p)`, used by both sides: relative, forward slashes only, no empty, `.` or `..` segment, no drive letter, no leading slash, no control characters.
2. **`scripts/backup.mjs`**, `pnpm backup [--local] [--out <dir>]`.
   - Source: `--linked` by default (Anas's machine, after `supabase login` and `supabase link`), `--local` for the development stack.
   - Passphrase: `ANASAQ_BACKUP_PASSPHRASE`, else a hidden prompt twice (raw-mode stdin, no echo, backspace works, Ctrl+C aborts). At least 12 characters; the two entries must match.
   - A temp dir under `os.tmpdir()`, removed in `finally` and on SIGINT/SIGTERM, so no plaintext stays behind.
   - The five dumps, exactly the guide's commands with `--linked` or `--local` in place of `--db-url`: `roles.sql` (`--role-only`); `schema.sql`; `data.sql` (`--use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"`); `history_schema.sql` (`--schema supabase_migrations`); `history_data.sql` (`--use-copy --data-only --schema supabase_migrations`). Run each with inherited stdio, because the CLI may ask for the database password on `--linked`. Any non-zero exit stops the run.
   - Storage: every object of `media-private` and `media-public` with `supabase storage cp -r ss:///<bucket> <tmp>/storage/<bucket> <--linked|--local> --experimental`. Check the layout the CLI produces and keep archive paths as `storage/<bucket>/<object name>`. An empty bucket is not an error.
   - Output: `<out>/anasaq-backup-<UTC yyyymmdd-hhmmss>.enc`. The default `<out>` is `path.join(os.homedir(), 'ANASAQ-backups')`, created if missing. Refuse an `--out` inside the repository, so a backup cannot be committed by accident.
   - Record the run: `supabase db query <--linked|--local> "select public.job_run_record('backup', 'ok', '<json>'::jsonb, '<startedAt>'::timestamptz)"`. The detail holds numbers only: `files`, `objects` and `bytes` (the encrypted file's size). Build the SQL from numbers and `new Date().toISOString()` only. If recording fails, print a warning and exit 0: the file is still good.
   - Terminal messages in short, plain English (Windows consoles render Arabic badly): the file path, its size, the object count, and a reminder that a lost passphrase cannot be recovered.
3. **`scripts/restore-check.mjs`**, `pnpm restore-check <file> [--extract <dir>]`.
   - `--extract <dir>`: decrypt into `<dir>` (new or empty) and stop. These are the files for a real restore, per the guide.
   - Default: a full rehearsal in a throwaway stack that never touches the development stack.
     1. Scratch workdir under `os.tmpdir()`. Run `supabase init` there, then edit `supabase/config.toml`: `project_id = "anasaq-restore-check"`; every port the file sets moved by +1000 (54321 to 55321, and so on for db, shadow, pooler, studio, inbucket and analytics); `enabled = false` for studio, inbucket, analytics, realtime and edge_runtime. Auth, storage and the API gateway stay on.
     2. `supabase start --workdir <scratch>`.
     3. Restore with the guide's psql invocation inside the scratch database container (psql is there; nothing to install). Copy the files in, then run `psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql`, then the history files the same way. If it fails, apply only the guide's documented caveats: comment out the `ALTER ... OWNER TO "supabase_admin"` lines in `schema.sql` or the `cli_login_postgres` grant in `roles.sql`, connect as the role the guide's steps imply, and enable a non-default extension (pg_cron, pg_net) before loading if its absence is the error. Record in the output which caveat was applied. Never edit data.
     4. Storage: upload every backed-up object into the scratch stack's bucket with `upsert: true` and its original content type, read from the restored `storage.objects.metadata->>'mimetype'`. Use `@supabase/supabase-js` with the scratch stack's service key from `supabase status -o json --workdir <scratch>`.
     5. Verify and print a table: for every table in `data.sql`, the number of rows in its COPY block equals `count(*)` in the scratch database; every object downloads back with the sha256 in the manifest. Print the elapsed time from start to verified (the RTO evidence). Exit 0 only if everything matches; otherwise exit 1 and list the differences.
     6. In `finally`: `supabase stop --no-backup --workdir <scratch>`, then remove the temp dirs.
4. **`package.json`**: add `"backup": "node scripts/backup.mjs"` and `"restore-check": "node scripts/restore-check.mjs"`. Without the script, `pnpm backup` falls through to GNU tar's `backup` shell script that Git for Windows puts on PATH.
5. **Owner home** (`src/components/admin/AdminHome.tsx`): add the job `backup` with the label «النسخ الاحتياطي» and a 30-day stale limit. For this job only, the stale text is «آخر نسخة احتياطية أقدم من 30 يومًا.» and the never-run text is «لا توجد نسخة بعد.»; a manual job has no schedule to check.
6. **Settings page** (`src/components/admin/SettingsView.tsx`): a section after «إعدادات المتجر», with exactly this text; commands and names go in `<span dir="ltr">`:
   - `<h2>`: «النسخ الاحتياطي»
   - `<p>`: «تُحفظ النسخة على جهازك أنت، مشفّرة بعبارة مرور لا يعرفها غيرك. لا يحتفظ Supabase المجاني بأي نسخة، فما يُضاف بعد آخر نسخة يضيع إن ضاع المشروع.»
   - `<ol className={styles.metaList}>`:
     1. «مرة واحدة: ثبّت Docker Desktop و Node 24 و pnpm و Supabase CLI، ثم نفّذ في مجلد المشروع supabase login ثم supabase link واختر مشروع ANAS.STUDIO.»
     2. «كل مرة، ويُستحسن بعد كل جلسة تحرير: شغّل Docker Desktop، ثم نفّذ في مجلد المشروع pnpm backup وأدخل عبارة المرور.»
     3. «تُحفظ الملفات في مجلد ANASAQ-backups داخل مجلدك الشخصي. انسخها من وقت لآخر إلى قرص خارجي أو خدمة سحابية، فهي مشفّرة.»
     4. «احفظ عبارة المرور في مدير كلمات المرور: من دونها لا تُفتح أي نسخة.»
7. **`docs/operations.md`**: a section "Backups (D35)", in English: what a file holds and what it deliberately does not (Vault secrets, Edge Function secrets, Auth settings and templates); prerequisites; both commands; a short format summary; and the real restore into a new hosted project: extract, the guide's psql restore, the migration history, re-creating the Vault secrets `functions_url`, `jobs_secret` and `pages_deploy_hook`, `supabase secrets set` for the functions, the Auth settings (I28), and uploading the objects with their content types. End with D35's accepted risks.

## Tests

- New `tests/unit/backup-format.test.ts` (Vitest; `allowJs` is on, so it imports the `.mjs` module directly). Cover: a round trip of several entries (text, binary, an empty file, a nested path); a wrong passphrase gives `WRONG_PASSPHRASE_OR_DAMAGED` with nothing left in `destDir`; one flipped ciphertext byte gives the same; one flipped header byte gives the same (the header is AAD); a truncated file fails with nothing left behind; a file that is not a backup gives `NOT_A_BACKUP`; `assertSafeEntryPath` refuses `..`, `./x`, `/x`, `C:/x`, `a\b` and `a//b`; the writer refuses an unsafe path. Keep test passphrases and scrypt cost realistic, but let the round trips share one key derivation where the API allows, so the file runs in seconds.
- `tests/e2e/owner-operations.spec.ts`: insert a `backup` row into `finance.job_runs` through the existing `db` client: the owner home shows «النسخ الاحتياطي: سليم». With `finished_at` 31 days ago, it shows the stale text. The settings screenshots include the new section.

## Checks to run and report

- `pnpm check`.
- `pnpm exec playwright test tests/e2e/owner-operations.spec.ts` (no `ACCEPTANCE_PACKAGE`).
- The real proof on this machine: with `ANASAQ_BACKUP_PASSPHRASE` set to a test value, run `pnpm backup --local --out <a dir under os.tmpdir()>`, then `pnpm restore-check <that file>`. Both must exit 0. Report the file size, object count, table count, rows compared and the restore time.
- `pnpm restore-check <that file>` with a wrong passphrase: exit 1, nothing left behind.
- Afterwards, `docker ps` shows no `anasaq-restore-check` container and the development stack still running. Delete the test backup files.

## Paths you may write

`scripts/lib/backup-format.mjs`, `scripts/backup.mjs`, `scripts/restore-check.mjs`, `package.json` (the two scripts only), `src/components/admin/{AdminHome,SettingsView}.tsx`, `docs/operations.md`, `tests/unit/backup-format.test.ts`, `tests/e2e/owner-operations.spec.ts`, the screenshots your runs write under `artifacts/acceptance/`, and temp dirs under `os.tmpdir()`. Anything else: stop and ask.

## Report (40 lines or fewer)

Files changed; each check as `command → exit code` with counts and timings; any guide caveat the restore needed; screenshot paths written; anything skipped or open.
