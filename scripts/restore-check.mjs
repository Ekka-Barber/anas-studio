#!/usr/bin/env node
/**
 * `pnpm restore-check <file> [--extract <dir>]` (D35): proves a backup file.
 *
 * `--extract <dir>` decrypts the archive into a new or empty directory and
 * stops — those are the files for a real restore, per Supabase's
 * backup/restore guide (supabase.com/docs/guides/platform/migrating-within-
 * supabase/backup-restore, fetched 2026-09-27).
 *
 * The default is a full rehearsal in a throwaway local stack that never
 * touches the development stack: its own workdir under the OS temp dir, its
 * own project id, every port moved by +1000, and studio/inbucket/analytics/
 * realtime/edge runtime disabled. The database is restored with the guide's
 * psql invocation inside the scratch database container; only the guide's
 * documented caveats are ever applied (and each one is printed). Storage
 * objects are uploaded back with their original content types, then every
 * table's row count and every object's sha256 are compared. The scratch stack
 * is stopped with `--no-backup` and the temp dirs removed on the way out.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { readBackup } from './lib/backup-format.mjs'
import { promptHidden } from './lib/passphrase.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'anasaq-restore-check'
const CONTAINER = `supabase_db_${PROJECT_ID}`
const DUMP_FILES = ['roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql']

function usage(exit) {
  console.log('Usage: pnpm restore-check <file> [--extract <dir>]')
  process.exit(exit)
}

const args = process.argv.slice(2)
let backupFile
let extractArg
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--extract') extractArg = args[++i]
  else if (!backupFile) backupFile = args[i]
  else usage(args[i] === '--help' || args[i] === '-h' ? 0 : 2)
}
if (!backupFile || extractArg === '') usage(2)
backupFile = resolve(backupFile)

// The extracted files are plaintext (auth password hashes, TOTP secrets,
// customer data): never inside the repository, where a `git add -A` could
// publish them.
if (extractArg) {
  const relDest = relative(repoRoot, resolve(extractArg))
  if (relDest === '' || (!relDest.startsWith('..') && !isAbsolute(relDest))) {
    console.error(`Refusing --extract inside the repository: ${resolve(extractArg)}`)
    process.exit(1)
  }
}

/** Runs the Supabase CLI by name. */
function supabase(cliArgs, options = {}) {
  return spawnSync('supabase', cliArgs, { cwd: repoRoot, ...options })
}

function docker(cliArgs, options = {}) {
  return spawnSync('docker', cliArgs, { cwd: repoRoot, ...options })
}

function mustSucceed(result, what) {
  if (result.status !== 0) {
    console.error(`${what} failed (exit ${result.status}).`)
    if (result.stderr) console.error(result.stderr.toString().trim())
    throw new Error(what)
  }
  return result
}

async function getPassphrase() {
  if (process.env.ANASAQ_BACKUP_PASSPHRASE !== undefined) return process.env.ANASAQ_BACKUP_PASSPHRASE
  if (!process.stdin.isTTY) {
    console.error('No passphrase source: run in a terminal or set ANASAQ_BACKUP_PASSPHRASE.')
    process.exit(1)
  }
  try {
    return await promptHidden('Passphrase: ')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(130)
  }
}

/** Rewrites the scratch stack config: its own id, +1000 on every port, and the
 * heavy optional services off. Auth, Storage and the API gateway stay on. */
function patchConfig(configPath) {
  const DISABLE = new Set(['studio', 'inbucket', 'local_smtp', 'analytics', 'realtime', 'edge_runtime'])
  let section = ''
  const patched = readFileSync(configPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      const header = line.match(/^\[([A-Za-z0-9_.]+)\]$/)
      if (header) {
        section = header[1]
        return line
      }
      if (/^\s*#/.test(line)) return line
      if (section === '' && /^project_id\s*=/.test(line)) return `project_id = "${PROJECT_ID}"`
      if (DISABLE.has(section) && /^\s*enabled\s*=\s*true\s*$/.test(line)) return line.replace(/true/, 'false')
      const port = line.match(/^(\s*\w*port\s*=\s*)(\d+)\s*$/)
      if (port) return `${port[1]}${Number(port[2]) + 1000}`
      return line
    })
    .join('\n')
  writeFileSync(configPath, patched)
}

/** The guide's psql restore inside the scratch database container. */
function psqlRestore(mainFiles) {
  const cliArgs = ['exec', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '--single-transaction', '--variable', 'ON_ERROR_STOP=1']
  if (mainFiles) {
    cliArgs.push('--file', '/tmp/roles.sql', '--file', '/tmp/schema.sql', '--command', 'SET session_replication_role = "replica"', '--file', '/tmp/data.sql')
  } else {
    cliArgs.push('--file', '/tmp/history_schema.sql', '--file', '/tmp/history_data.sql')
  }
  return docker(cliArgs, { timeout: 300000 })
}

/** Copies the five dump files into the container and restores them, applying
 * only the guide's documented caveats when (and only when) their error
 * appears. Data is never edited. Returns the caveats that were applied. */
function restoreDatabase(extractDir) {
  for (const name of DUMP_FILES) {
    mustSucceed(docker(['cp', join(extractDir, name), `${CONTAINER}:/tmp/${name}`], { timeout: 120000 }), `docker cp ${name}`)
  }
  const caveats = []
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const main = psqlRestore(true)
    if (main.status === 0) break
    const output = `${main.stderr?.toString() ?? ''}\n${main.stdout?.toString() ?? ''}`
    if (/OWNER TO "supabase_admin"|cli_login_postgres/.test(output) && !caveats.includes('owner-and-grant')) {
      // Guide caveat: comment out `ALTER ... OWNER TO "supabase_admin"` lines
      // in schema.sql and the `GRANT "postgres" TO "cli_login_postgres"...`
      // line in roles.sql, then copy the files in again.
      const schema = join(extractDir, 'schema.sql')
      writeFileSync(
        schema,
        readFileSync(schema, 'utf8')
          .split(/\r?\n/)
          .map((line) => (/OWNER TO "supabase_admin"/.test(line) ? `-- ${line}` : line))
          .join('\n'),
      )
      const roles = join(extractDir, 'roles.sql')
      writeFileSync(
        roles,
        readFileSync(roles, 'utf8')
          .split(/\r?\n/)
          .map((line) => (/GRANT "postgres" TO "cli_login_postgres"/.test(line) ? `-- ${line}` : line))
          .join('\n'),
      )
      for (const name of ['roles.sql', 'schema.sql']) {
        mustSucceed(docker(['cp', join(extractDir, name), `${CONTAINER}:/tmp/${name}`], { timeout: 120000 }), `docker cp ${name} (caveat)`)
      }
      caveats.push('owner-and-grant')
      console.log('Caveat applied (guide): commented out supabase_admin OWNER TO / cli_login_postgres grant lines.')
      continue
    }
    if (/pg_cron|pg_net/.test(output) && /is not available|does not exist|unknown extension|missing/.test(output) && !caveats.includes('extensions')) {
      // Guide caveat: enable the non-default extension before loading.
      mustSucceed(
        docker(['exec', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '-c', 'create extension if not exists pg_cron;', '-c', 'create extension if not exists pg_net;'], { timeout: 120000 }),
        'create extension pg_cron/pg_net',
      )
      caveats.push('extensions')
      console.log('Caveat applied (guide): created pg_cron and pg_net before loading.')
      continue
    }
    console.error('The psql restore failed; its output was:')
    console.error(output.trim())
    throw new Error('psql restore failed')
  }
  mustSucceed(psqlRestore(false), 'psql history restore')
  return caveats
}

/** Reads {objectName: mimetype} for one bucket from the restored rows. */
function bucketMimetypes(bucket) {
  // The name comes from the archive and goes into SQL: Supabase bucket ids only.
  if (!/^[a-z0-9_-]{1,63}$/.test(bucket)) throw new Error(`Unexpected bucket name in the backup: ${JSON.stringify(bucket)}`)
  const result = docker(
    [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '--dbname',
      'postgres',
      '-At',
      '-c',
      `select coalesce(jsonb_object_agg(name, metadata->>'mimetype'), '{}'::jsonb)::text from storage.objects where bucket_id = '${bucket}'`,
    ],
    { encoding: 'utf8', timeout: 120000 },
  )
  mustSucceed(result, `read mimetypes for ${bucket}`)
  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    return {}
  }
}

/** Uploads every storage object of the manifest with upsert and its original
 * content type. Returns {uploaded, failures}. */
async function uploadObjects(client, extractDir, manifest) {
  let uploaded = 0
  const failures = []
  const storageEntries = manifest.files.filter((f) => f.path.startsWith('storage/'))
  const byBucket = new Map()
  for (const entry of storageEntries) {
    const parts = entry.path.split('/')
    const bucket = parts[1]
    if (!byBucket.has(bucket)) byBucket.set(bucket, { types: bucketMimetypes(bucket), entries: [] })
    byBucket.get(bucket).entries.push({ name: parts.slice(2).join('/'), entry })
  }
  for (const [bucket, { types, entries }] of byBucket) {
    // ponytail: bounded concurrency keeps the local storage API happy.
    const queue = [...entries]
    const workers = Array.from({ length: 8 }, async () => {
      for (;;) {
        const item = queue.shift()
        if (!item) return
        const bytes = readFileSync(join(extractDir, ...item.entry.path.split('/')))
        const { error } = await client.storage
          .from(bucket)
          .upload(item.name, bytes, { upsert: true, contentType: types[item.name] || 'application/octet-stream' })
        if (error) failures.push(`${bucket}/${item.name}: ${error.message}`)
        else uploaded += 1
      }
    })
    await Promise.all(workers)
  }
  return { uploaded, failures }
}

/** {schema.table: COPY rows} from data.sql (one physical line per COPY row). */
function copyRowCounts(dataSqlPath) {
  const counts = new Map()
  let current = null
  for (const line of readFileSync(dataSqlPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^COPY "([^"]+)"\."([^"]+)"\s*\(/)
    if (match) {
      current = `${match[1]}.${match[2]}`
      counts.set(current, 0)
      continue
    }
    if (current !== null) {
      if (line === '\\.') current = null
      else counts.set(current, counts.get(current) + 1)
    }
  }
  return counts
}

/** Row counts in the scratch database, one query for all tables. */
function restoredRowCounts(tables) {
  const selects = [...tables].map((table) => {
    const [schema, name] = table.split('.')
    return `select '${table.replace(/'/g, "''")}' as t, count(*)::bigint as n from "${schema}"."${name}"`
  })
  const result = docker(
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '-At', '-F', '|', '-c', selects.join(' union all ')],
    { encoding: 'utf8', timeout: 300000 },
  )
  mustSucceed(result, 'count restored rows')
  const counts = new Map()
  for (const line of result.stdout.split(/\r?\n/)) {
    const [table, count] = line.split('|')
    if (table) counts.set(table, Number(count))
  }
  return counts
}

/** Downloads every object back and compares sha256 with the manifest. */
async function verifyObjects(client, manifest) {
  const perBucket = new Map()
  const failures = []
  const entries = manifest.files.filter((f) => f.path.startsWith('storage/'))
  const queue = [...entries]
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const entry = queue.shift()
      if (!entry) return
      const parts = entry.path.split('/')
      const bucket = parts[1]
      const name = parts.slice(2).join('/')
      const { data, error } = await client.storage.from(bucket).download(name)
      if (error) {
        failures.push(`${bucket}/${name}: ${error.message}`)
        continue
      }
      const digest = createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex')
      const current = perBucket.get(bucket) ?? { verified: 0, total: 0 }
      current.total += 1
      if (digest === entry.sha256) current.verified += 1
      else failures.push(`${bucket}/${name}: sha256 differs from the manifest`)
      perBucket.set(bucket, current)
    }
  })
  await Promise.all(workers)
  return { perBucket, failures, expected: entries.length }
}

async function main() {
  const passphrase = await getPassphrase()

  if (extractArg) {
    const destDir = resolve(extractArg)
    const manifest = await readBackup(backupFile, passphrase, destDir)
    console.log(`Extracted ${manifest.files.length + 1} files to ${destDir} (manifest.json + the files below):`)
    for (const file of manifest.files) console.log(`  ${file.size.toString().padStart(10)}  ${file.path}`)
    console.log('These are the files for a real restore (see docs/operations.md, "Backups (D35)").')
    console.log('WARNING: they are NOT encrypted. They hold every customer record and the auth secrets. Delete the directory once the restore is verified.')
    return
  }

  const scratch = mkdtempSync(join(tmpdir(), 'anasaq-restore-'))
  const extractDir = mkdtempSync(join(tmpdir(), 'anasaq-restore-files-'))
  // One cleanup for every way out: `finally`, and the 'exit' event, which
  // also runs on Ctrl+C (the handlers below call process.exit). Synchronous,
  // so it completes inside 'exit': the scratch stack is stopped and the
  // decrypted dumps never stay in the temp dir.
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    // The decrypted dumps go first: `supabase stop` can take minutes, longer
    // than Windows allows after the console window closes (SIGHUP).
    rmSync(extractDir, { recursive: true, force: true })
    if (existsSync(scratch)) {
      supabase(['stop', '--no-backup', '--workdir', scratch], { stdio: 'ignore', timeout: 300000 })
    }
    rmSync(scratch, { recursive: true, force: true })
  }
  process.on('exit', cleanup)
  const startedAt = Date.now()
  let exitCode = 1
  try {
    // A rehearsal that crashed earlier can leave its containers behind; clear
    // them by project id (never the development stack's id).
    supabase(['stop', '--no-backup', '--project-id', PROJECT_ID], { stdio: 'ignore', timeout: 300000 })
    console.log(`Rehearsal scratch stack: ${scratch}`)
    mustSucceed(supabase(['init', '--workdir', scratch], { stdio: 'inherit', timeout: 120000 }), 'supabase init')
    patchConfig(join(scratch, 'supabase', 'config.toml'))

    // Decrypt first: a wrong passphrase or a damaged file should fail in
    // seconds, before any container is started.
    console.log('Decrypting the backup...')
    const manifest = await readBackup(backupFile, passphrase, extractDir)
    console.log(`Backup from ${manifest.createdAt} (source: ${manifest.source}), ${manifest.files.length} files.`)

    console.log('Starting the throwaway stack (this can take a few minutes)...')
    mustSucceed(supabase(['start', '--workdir', scratch], { stdio: 'inherit', timeout: 600000 }), 'supabase start')

    const statusResult = supabase(['status', '-o', 'json', '--workdir', scratch], { encoding: 'utf8', timeout: 120000 })
    mustSucceed(statusResult, 'supabase status')
    const status = JSON.parse(statusResult.stdout)
    const host = new URL(status.API_URL).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Refusing: the scratch stack API_URL is not a local host.')

    restoreDatabase(extractDir)

    const client = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    console.log('Uploading storage objects...')
    const upload = await uploadObjects(client, extractDir, manifest)
    for (const failure of upload.failures) console.error(`  upload failed: ${failure}`)
    if (upload.failures.length > 0) throw new Error('object uploads failed')

    console.log('Comparing row counts and object digests...')
    const dumpCounts = copyRowCounts(join(extractDir, 'data.sql'))
    const restored = restoredRowCounts(dumpCounts.keys())
    const objects = await verifyObjects(client, manifest)
    const objectRows = dumpCounts.get('storage.objects')

    const problems = []
    const width = Math.max(...[...dumpCounts.keys()].map((t) => t.length))
    console.log('\nTable rows (COPY block -> restored count):')
    for (const [table, expected] of dumpCounts) {
      const actual = restored.get(table)
      const ok = actual === expected
      if (!ok) problems.push(`${table}: ${expected} rows in data.sql, ${actual} in the restored database`)
      console.log(`  ${table.padEnd(width)}  ${expected} -> ${actual ?? 'MISSING'}  ${ok ? 'ok' : 'FAIL'}`)
    }
    console.log('\nStorage objects (sha256 verified):')
    for (const [bucket, { verified, total }] of objects.perBucket) {
      const ok = verified === total
      if (!ok) problems.push(`${bucket}: ${verified}/${total} objects verified`)
      console.log(`  ${bucket.padEnd(width)}  ${total} objects, ${verified} verified  ${ok ? 'ok' : 'FAIL'}`)
    }
    if (objectRows !== objects.expected) {
      problems.push(`storage.objects has ${objectRows} rows but the backup holds ${objects.expected} objects`)
    }
    for (const failure of objects.failures) problems.push(failure)

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (problems.length > 0) {
      console.error('\nDifferences found:')
      for (const problem of problems) console.error(`  ${problem}`)
      console.error(`FAILED after ${elapsed}s (start to verified).`)
    } else {
      console.log(`\nOK: ${dumpCounts.size} tables, ${objects.expected} objects verified in ${elapsed}s (start to verified).`)
      exitCode = 0
    }
  } finally {
    cleanup()
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
process.on('SIGHUP', () => process.exit(129))

await main()
