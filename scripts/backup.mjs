#!/usr/bin/env node
/**
 * `pnpm backup [--linked] [--local] [--out <dir>]` (D35): one encrypted file
 * on Anas's own machine, written by him, whenever he chooses. No CI, no
 * off-machine destination, no key custodian.
 *
 * The five database dumps and the psql restore shape follow Supabase's
 * backup/restore guide (supabase.com/docs/guides/platform/migrating-within-
 * supabase/backup-restore, fetched 2026-09-27), with `--linked`/`--local` in
 * place of the guide's `--db-url`. Storage objects come from the CLI's
 * `storage cp` download. The passphrase is typed twice (hidden) or read from
 * ANASAQ_BACKUP_PASSPHRASE for unattended runs; it is never printed, logged
 * or written anywhere.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeBackup } from './lib/backup-format.mjs'
import { promptHidden } from './lib/passphrase.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The paid files (`paid-files`, P08) are the product: a restore without them is not a restore.
const BUCKETS = ['media-private', 'media-public', 'paid-files']

function usage(exit) {
  console.log('Usage: pnpm backup [--linked] [--local] [--out <dir>]')
  console.log('  --linked  dump the linked Supabase project (default; needs supabase login + link)')
  console.log('  --local   dump the local development stack')
  console.log('  --out     destination directory (default: ~/ANASAQ-backups, created if missing)')
  process.exit(exit)
}

const args = process.argv.slice(2)
let mode = '--linked'
let outArg
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--help' || args[i] === '-h') usage(0)
  else if (args[i] === '--local') mode = '--local'
  else if (args[i] === '--linked') mode = '--linked'
  else if (args[i] === '--out') {
    // An empty or missing value (an unset shell variable) must not fall back to the home directory.
    outArg = args[++i]
    if (!outArg || outArg.startsWith('-')) usage(2)
  } else usage(2)
}

// `storage cp` runs in the temp dir (its destination must be relative), where
// the CLI cannot find the link file, so --linked hands it the project ref.
function linkedProjectRef() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID
  const refFile = join(repoRoot, 'supabase', '.temp', 'project-ref')
  const ref = existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : ''
  if (ref === '') {
    console.error('No linked Supabase project: run `supabase link` first (see docs/operations.md, "Backups (D35)"). Nothing was written.')
    process.exit(1)
  }
  return ref
}
const projectRef = mode === '--linked' ? linkedProjectRef() : undefined

// A backup inside the repository could be committed by accident.
const outDir = resolve(outArg ?? join(homedir(), 'ANASAQ-backups'))
const relOut = relative(repoRoot, outDir)
if (relOut === '' || (!relOut.startsWith('..') && !isAbsolute(relOut))) {
  console.error(`Refusing --out inside the repository: ${outDir}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

/** Runs the Supabase CLI by name. */
function supabase(cliArgs, options = {}) {
  return spawnSync('supabase', cliArgs, { stdio: 'inherit', cwd: repoRoot, ...options })
}

async function getPassphrase() {
  const fromEnv = process.env.ANASAQ_BACKUP_PASSPHRASE
  if (fromEnv !== undefined) {
    if (fromEnv.length < 12) {
      console.error('ANASAQ_BACKUP_PASSPHRASE is shorter than 12 characters.')
      process.exit(1)
    }
    return fromEnv
  }
  if (!process.stdin.isTTY) {
    console.error('No passphrase source: run in a terminal or set ANASAQ_BACKUP_PASSPHRASE.')
    process.exit(1)
  }
  let first
  try {
    first = await promptHidden('Passphrase (min 12 characters): ')
    const second = await promptHidden('Repeat passphrase: ')
    if (first !== second) {
      console.error('The two passphrases do not match. Nothing was written.')
      process.exit(1)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(130)
  }
  if (first.length < 12) {
    console.error('The passphrase must be at least 12 characters. Nothing was written.')
    process.exit(1)
  }
  return first
}

function walkFiles(dir, prefix = '') {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...walkFiles(join(dir, entry.name), rel))
    else files.push({ path: rel, file: join(dir, entry.name) })
  }
  return files
}

const startedAt = new Date()
const work = mkdtempSync(join(tmpdir(), 'anasaq-backup-'))
let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(work, { recursive: true, force: true })
}
// Every failure below ends with process.exit(), which skips `finally`; the
// 'exit' event still runs synchronously, so the plaintext dumps never stay in
// the temp dir.
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(143)
})
// Closing the console window raises SIGHUP on Windows; without a listener Node
// exits without the 'exit' event and the plaintext dumps stay in the temp dir.
process.on('SIGHUP', () => {
  cleanup()
  process.exit(129)
})

try {
  const passphrase = await getPassphrase()

  // 1. The five dumps, exactly the guide's commands with --linked/--local
  //    instead of --db-url (verified live against CLI 2.106.0). Inherited
  //    stdio: the CLI may ask for the database password on --linked.
  const dumps = [
    { name: 'roles.sql', extra: ['--role-only'] },
    { name: 'schema.sql', extra: [] },
    { name: 'data.sql', extra: ['--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes'] },
    { name: 'history_schema.sql', extra: ['--schema', 'supabase_migrations'] },
    { name: 'history_data.sql', extra: ['--use-copy', '--data-only', '--schema', 'supabase_migrations'] },
  ]
  for (const dump of dumps) {
    const result = supabase(['db', 'dump', mode, '-f', join(work, dump.name), ...dump.extra])
    if (result.error?.code === 'ENOENT') {
      console.error('The Supabase CLI was not found on PATH. Install it first (see docs/operations.md, "Backups (D35)").')
      process.exit(1)
    }
    if (result.status !== 0) {
      console.error('A database dump failed. No backup was written.')
      process.exit(result.status ?? 1)
    }
  }

  // 2. Storage: every object of the three buckets. The recursive download needs a
  //    RELATIVE destination: on Windows an absolute path like C:\... parses
  //    as a URL scheme in the CLI, which answers "Unsupported operation"
  //    (verified live; CLI source apps/cli-go/internal/storage/cp/cp.go). An
  //    empty bucket is not an error: the listing simply has no lines.
  let objectCount = 0
  for (const bucket of BUCKETS) {
    const listing = spawnSync(
      'supabase',
      ['storage', 'ls', '-r', `ss:///${bucket}`, mode, '--experimental'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    if (listing.status !== 0) {
      console.error(`Could not list bucket ${bucket}. No backup was written.`)
      process.exit(listing.status ?? 1)
    }
    const names = listing.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`/${bucket}/`))
      .map((line) => line.slice(`/${bucket}/`.length))
      .filter((name) => name !== '' && !name.endsWith('/'))
    if (names.length === 0) continue
    const result = supabase(['storage', 'cp', '-r', `ss:///${bucket}`, `storage/${bucket}`, mode, '--experimental'], {
      cwd: work,
      env: { ...process.env, ...(projectRef && { SUPABASE_PROJECT_ID: projectRef }) },
    })
    if (result.status !== 0) {
      console.error(`Downloading bucket ${bucket} failed. No backup was written.`)
      process.exit(result.status ?? 1)
    }
    const downloaded = walkFiles(join(work, 'storage', bucket)).map((f) => f.path)
    if (downloaded.length !== names.length) {
      console.error(`Bucket ${bucket}: listed ${names.length} objects but downloaded ${downloaded.length}. No backup was written.`)
      process.exit(1)
    }
    objectCount += names.length
  }

  // 3. One encrypted file. Archive paths: dumps at the root, objects as
  //    storage/<bucket>/<object name> (the layout `storage cp` produces).
  const entries = [
    { path: 'roles.sql', file: join(work, 'roles.sql') },
    { path: 'schema.sql', file: join(work, 'schema.sql') },
    { path: 'data.sql', file: join(work, 'data.sql') },
    { path: 'history_schema.sql', file: join(work, 'history_schema.sql') },
    { path: 'history_data.sql', file: join(work, 'history_data.sql') },
    ...(existsSync(join(work, 'storage')) ? walkFiles(join(work, 'storage')).map((f) => ({ path: `storage/${f.path}`, file: f.file })) : []),
  ]
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const outFile = join(outDir, `anasaq-backup-${stamp}.enc`)
  await writeBackup(outFile, entries, passphrase, { source: mode === '--local' ? 'local' : 'linked' })

  // 4. Record the run (numbers only). A failed record never invalidates the
  //    file, so it is a warning, not an error. The pg_typeof wrapper returns
  //    a text column: the CLI's scanner cannot scan the function's void
  //    return (unknown oid 2278, verified live).
  const bytes = statSync(outFile).size
  const detail = JSON.stringify({ files: entries.length, objects: objectCount, bytes })
  const record = supabase([
    'db',
    'query',
    mode,
    `select coalesce(pg_typeof(v)::text, 'void') as result from (select public.job_run_record('backup', 'ok', '${detail}'::jsonb, '${startedAt.toISOString()}'::timestamptz) as v) r`,
  ])
  if (record.status !== 0) {
    console.error('Warning: could not record the backup run in finance.job_runs (the backup file itself is fine).')
  }

  console.log(`Backup written: ${outFile}`)
  console.log(`Size: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(1)} MB), files: ${entries.length}, storage objects: ${objectCount}.`)
  console.log('Keep the passphrase safe: a lost passphrase cannot be recovered, and without it no backup can be opened.')
} finally {
  cleanup()
}
