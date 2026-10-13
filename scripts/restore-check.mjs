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
 * table's row count and every object's sha256 are compared. The dumps are
 * not relied on to carry `cron.job` (it depends on the CLI version), so the
 * runbook step follows: every `cron.schedule(...)` call
 * of supabase/migrations is re-run (printed as an applied caveat), and every
 * schedule must then be in `cron.job`.
 *
 * The scratch stack holds the whole restored database behind the CLI's public
 * default credentials, so its Docker network is created first, bound to the
 * loopback address (the CLI would publish every port on all interfaces), the CLI
 * is told to use that network (`--network-id`), and `docker port` must print at
 * least one binding, every one of them on 127.0.0.1, before anything is restored.
 * A backup of the linked project is rehearsed on that project's service versions,
 * copied from supabase/.temp (written by `supabase link`), not on the CLI's
 * defaults. The scratch stack is stopped with `--no-backup` and the temp dirs
 * removed on the way out, each cleanup step on its own so that one that fails
 * never skips the rest; afterwards no container or volume the CLI labelled for
 * the project may remain. A run that finds one, cannot show there is none, or
 * had a cleanup step fail exits non-zero, and says plaintext restored data may
 * still be on disk.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { readBackup } from './lib/backup-format.mjs'
import { cronScheduleStatements, missingCronJobs } from './lib/cron-jobs.mjs'
import { promptHidden } from './lib/passphrase.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'anasaq-restore-check'
const CONTAINER = `supabase_db_${PROJECT_ID}`
// How the CLI names the Docker network of a project (supabase_network_<project_id>) and labels everything it
// creates for it (apps/cli-go/internal/utils/config.go and docker.go, v2.106.0); `supabase stop` removes by the label.
const NETWORK = `supabase_network_${PROJECT_ID}`
const PROJECT_LABEL = `com.supabase.cli.project=${PROJECT_ID}`
// What `supabase link` records in supabase/.temp: the CLI starts the linked project's Postgres, PostgREST, GoTrue and
// Storage images, and Storage's target migration, when it finds these in the workdir's supabase/.temp.
const LINKED_VERSION_FILES = ['postgres-version', 'rest-version', 'gotrue-version', 'storage-version', 'storage-migration']
const DUMP_FILES = ['roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql']
// The buckets `pnpm backup` holds (scripts/backup.mjs). The paid files are the product: a restore without them is not a restore.
const BUCKETS = ['media-private', 'media-public', 'paid-files']

function usage(exit) {
  console.log('Usage: pnpm restore-check <file> [--extract <dir>]')
  process.exit(exit)
}

const args = process.argv.slice(2)
let backupFile
let extractArg
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--help' || arg === '-h') usage(0)
  else if (arg === '--extract') {
    // An empty or missing value (an unset shell variable) must not fall back to the full rehearsal.
    extractArg = args[++i]
    if (!extractArg || extractArg.startsWith('-')) usage(2)
  } else if (arg.startsWith('-') || backupFile) usage(2)
  else backupFile = arg
}
if (!backupFile) usage(2)
backupFile = resolve(backupFile)

/** `target` with its nearest existing ancestor resolved to the real path (a junction or symlink, an 8.3 short name, the
 * letter case and a trailing dot all resolve there) and the parts that do not exist yet, the new folders of this run,
 * appended as they are. */
function realPathOf(target) {
  const missing = []
  let existing = resolve(target)
  for (;;) {
    try {
      return join(realpathSync.native(existing), ...missing)
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return resolve(target)
      missing.unshift(basename(existing))
      existing = parent
    }
  }
}

/** True when `child` is `parent` or anything inside it, by path text. `relative` gives '' for the parent itself, '..' or
 * '..' + sep + ... for anything outside, and an absolute path for another drive on Windows. A folder that merely starts
 * with two dots (`..plain`) is inside, so a bare startsWith('..') is not the test. */
function within(parent, child) {
  const rel = relative(parent, child)
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

/** True when `target`, or any folder it passes through, resolves into the repository. A link into the repository is
 * inside it, whatever the path looks like; so is a path that passes through the repository and leaves it again by a link
 * inside it, however the repository was named on the way in (its own path, a link or junction to it or to a folder above
 * it, a subst drive, an 8.3 name): Git for Windows treats a junction as a plain folder, so `git add -A` would stage what
 * lies behind it. */
function insideRepository(target) {
  const root = realPathOf(repoRoot)
  for (let at = resolve(target); ; at = dirname(at)) {
    if (within(root, realPathOf(at))) return true
    if (dirname(at) === at) return false
  }
}

// The extracted files are plaintext (auth password hashes, TOTP secrets,
// customer data): never inside the repository, where a `git add -A` could
// publish them.
if (extractArg && insideRepository(resolve(extractArg))) {
  console.error(`Refusing --extract inside the repository: ${resolve(extractArg)}`)
  process.exit(1)
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

/** readBackup, with its expected failures (wrong passphrase, damaged or missing file, a destination that is not empty) as one line, not a stack trace. */
async function readBackupOrExit(passphrase, destDir) {
  try {
    return await readBackup(backupFile, passphrase, destDir)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
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
      // `supabase init` limits every upload to 50 MiB, the project's own config (supabase/config.toml) to 100 MiB, the
      // size of the largest paid file: without this a paid file over 50 MiB could not be restored into the scratch stack.
      if (section === 'storage' && /^file_size_limit\s*=/.test(line)) return 'file_size_limit = "100MiB"'
      if (DISABLE.has(section) && /^\s*enabled\s*=\s*true\s*$/.test(line)) return line.replace(/true/, 'false')
      const port = line.match(/^(\s*\w*port\s*=\s*)(\d+)\s*$/)
      if (port) return `${port[1]}${Number(port[2]) + 1000}`
      return line
    })
    .join('\n')
  writeFileSync(configPath, patched)
}

/** A backup of the linked project is rehearsed on the versions that project runs: copies the version files `supabase link`
 * left in the repository's supabase/.temp into the scratch workdir, where the CLI looks for them, and prints what it
 * found. Without them the scratch stack runs the CLI's bundled images, and a hosted Auth or Storage schema newer than
 * those fails the psql restore of a perfectly good backup. */
function copyLinkedVersions(scratch) {
  const from = join(repoRoot, 'supabase', '.temp')
  const to = join(scratch, 'supabase', '.temp')
  const used = []
  for (const name of LINKED_VERSION_FILES) {
    const file = join(from, name)
    if (!existsSync(file)) continue
    const version = readFileSync(file, 'utf8').trim()
    if (version === '') continue
    mkdirSync(to, { recursive: true })
    copyFileSync(file, join(to, name))
    used.push(`${name}: ${version}`)
  }
  if (used.length === 0) {
    console.log("This is a backup of the linked project, but supabase/.temp holds none of its service versions (run `supabase link`): the scratch stack runs the CLI's default versions, so a newer hosted Auth or Storage schema can fail the restore.")
    return
  }
  console.log("Service versions of the linked project, used by the scratch stack instead of the CLI's defaults:")
  for (const line of used) console.log(`  ${line}`)
}

/** Creates the scratch project's Docker network before the CLI can: the CLI reuses an existing network of that name, and
 * the one it would create publishes every port on all host addresses. The bridge driver's default host binding is set to
 * the loopback address (Docker docs, "Port publishing and mapping"). The label is the CLI's own, so `supabase stop` prunes
 * this network too. Docker older than 28.0.0 still lets hosts on the same L2 segment reach ports published to localhost.
 * When the network cannot be created the run ends here with the remedy on one screen, not a stack trace: the usual cause
 * is a network of that name left behind, which the pre-clean's `supabase stop` could not remove. */
function createLoopbackNetwork() {
  const created = docker(['network', 'create', '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', PROJECT_LABEL, NETWORK], { timeout: 60000 })
  if (created.status === 0) return
  console.error(`docker network create ${NETWORK} failed (${created.error?.code ?? `exit ${created.status}`}).`)
  if (created.stderr) console.error(created.stderr.toString().trim())
  console.error(
    `If ${NETWORK} is left from an earlier rehearsal, the pre-clean could not remove it: \`supabase stop\` removes only what carries the CLI's label, and not a network a container still uses. ` +
      `Stop what uses it (\`docker network inspect ${NETWORK}\` lists the containers), then remove it with: docker network rm ${NETWORK}`,
  )
  // The 'exit' handler still stops what was started and checks for leftovers.
  process.exit(1)
}

/** Refuses to restore into a stack that publishes any port beyond the loopback address: from there the whole restored
 * database would be reachable by other devices with the CLI's default credentials. `docker port` prints one
 * `5432/tcp -> 127.0.0.1:55322` line per binding, and at least one must be there: an empty answer would pass the test for
 * the others vacuously. The network's default binding covers every container of the stack, so the database container,
 * the one that matters most, stands for them all. */
function assertLoopbackOnly() {
  const result = docker(['port', CONTAINER], { encoding: 'utf8', timeout: 60000 })
  mustSucceed(result, `docker port ${CONTAINER}`)
  const bindings = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (bindings.length === 0) {
    throw new Error(`Refusing to restore: \`docker port ${CONTAINER}\` shows no published port, so nothing proves the scratch database is bound to the loopback address only, and it would hold the whole restored database behind the CLI's default credentials.`)
  }
  const open = bindings.filter((line) => !/->\s*127\.0\.0\.1:\d+$/.test(line))
  if (open.length > 0) {
    throw new Error(`Refusing to restore: the scratch database is published beyond the loopback address (${open.join('; ')}), and it would hold the whole restored database behind the CLI's default credentials.`)
  }
}

/** The names `docker ps` or `docker volume ls` print, or null when docker could not answer. */
function dockerNames(cliArgs) {
  const result = docker(cliArgs, { encoding: 'utf8', timeout: 60000 })
  if (result.status !== 0) return null
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** How `supabase stop` ended, in words, for the leftover report. */
function describeStop(stopResult) {
  return stopResult.status === 0 ? 'supabase stop reported success' : `supabase stop failed (${stopResult.error?.code ?? `exit ${stopResult.status}`})`
}

/** After `supabase stop`: whether the scratch stack is still on this machine. The restored database is an unencrypted copy
 * of production in a container's Docker volume, so a stop that failed or timed out must not pass in silence. Containers and
 * volumes are found by the label the CLI puts on everything it creates for the project (the one `supabase stop` itself
 * removes by), not by a substring of a name. Says what remains on stderr and returns true when a container or volume of
 * the project does, or when docker cannot show none does. `stop` says how `supabase stop` ended. */
function scratchStackRemains(stop) {
  const containers = dockerNames(['ps', '-a', '--filter', `label=${PROJECT_LABEL}`, '--format', '{{.Names}}'])
  const volumes = dockerNames(['volume', 'ls', '--filter', `label=${PROJECT_LABEL}`, '--format', '{{.Name}}'])
  const remains = [...(containers ?? []).map((name) => `container ${name}`), ...(volumes ?? []).map((name) => `volume ${name}`)]
  if (remains.length > 0) {
    console.error(`\nThe scratch stack was not removed: plaintext restored data is still on disk (the whole restored database, auth secrets and customer records included; ${stop}). Left behind:`)
    for (const item of remains) console.error(`  ${item}`)
    console.error(`Remove it with: supabase stop --no-backup --project-id ${PROJECT_ID}`)
    return true
  }
  if (containers === null || volumes === null) {
    const unanswered = [containers === null && '`docker ps`', volumes === null && '`docker volume ls`'].filter(Boolean).join(' and ')
    console.error(`\nCould not check that the scratch stack is gone (${unanswered} did not answer: is Docker running?). If the rehearsal got as far as restoring, plaintext restored data may still be on disk. Check with: docker ps -a --filter label=${PROJECT_LABEL}  and  docker volume ls --filter label=${PROJECT_LABEL}`)
    return true
  }
  console.log(`Scratch stack removed: no container or volume of ${PROJECT_ID} remains.`)
  return false
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

/** {bucket id: object rows} of the restored database, one query. */
function restoredBucketCounts() {
  const result = docker(
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '-At', '-F', '|', '-c', 'select bucket_id, count(*)::bigint from storage.objects group by bucket_id'],
    { encoding: 'utf8', timeout: 120000 },
  )
  mustSucceed(result, 'count restored storage objects per bucket')
  const counts = new Map()
  for (const line of result.stdout.split(/\r?\n/)) {
    const [bucket, count] = line.split('|')
    if (bucket) counts.set(bucket, Number(count))
  }
  return counts
}

/** jobname of every row in the restored `cron.job`, or null when it cannot be read (no pg_cron). */
function restoredCronJobs() {
  const result = docker(
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '-At', '-c', 'select jobname from cron.job'],
    { encoding: 'utf8', timeout: 120000 },
  )
  if (result.status !== 0) return null
  return result.stdout.split(/\r?\n/).filter((line) => line !== '')
}

/** The runbook step: a restore does not run migrations, and the dumps may not carry the `cron.job` rows. Runs every cron.schedule(...) statement in one transaction (idempotent: the job name is the key). */
function applyCronSchedules(statements) {
  return docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '--dbname', 'postgres', '--single-transaction', '--variable', 'ON_ERROR_STOP=1', '--file', '-'],
    { input: [...statements.values()].join('\n'), encoding: 'utf8', timeout: 120000 },
  )
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
    const manifest = await readBackupOrExit(passphrase, destDir)
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
  // Set from the moment the stack's network is created: only then can the
  // rehearsal have left a container, volume or network behind to look for.
  let stackTouched = false
  // Set when, after the stop, a container or volume of the stack remains (or
  // none can be shown to be gone): the run must then not end with exit code 0.
  let plaintextLeft = false
  // Set when a cleanup step threw: the run must then not end with exit code 0
  // either.
  let cleanupFailed = false
  /** Runs one cleanup step on its own: a throw from it (rmSync of a directory Windows still holds open fails with
   * EBUSY) is reported and remembered, and the steps after it still run. */
  const step = (what, run) => {
    try {
      run()
    } catch (error) {
      cleanupFailed = true
      console.error(`Cleanup step failed (${what}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    // The decrypted dumps go first: `supabase stop` can take minutes, longer
    // than Windows allows after the console window closes (SIGHUP).
    step(`removing the decrypted dumps in ${extractDir}; delete that directory by hand, it holds the restored database in plaintext`, () =>
      rmSync(extractDir, { recursive: true, force: true }),
    )
    let stop = 'supabase stop did not run'
    if (existsSync(scratch) || stackTouched) {
      // Without its workdir (something removed it while the stack ran) the stack is stopped by its project id, as the
      // pre-clean does: never the development stack's id.
      const target = existsSync(scratch) ? ['--workdir', scratch] : ['--project-id', PROJECT_ID]
      step('stopping the scratch stack', () => {
        stop = describeStop(supabase(['stop', '--no-backup', ...target], { stdio: 'ignore', timeout: 300000 }))
      })
    }
    if (stackTouched) {
      // The network was created here, not by the CLI; remove it with the stack (a no-op when `stop` pruned it).
      step(`removing the network ${NETWORK}`, () => docker(['network', 'rm', NETWORK], { stdio: 'ignore', timeout: 60000 }))
      step('checking that nothing of the scratch stack remains', () => {
        plaintextLeft = scratchStackRemains(stop)
      })
    }
    step(`removing the scratch workdir ${scratch}`, () => rmSync(scratch, { recursive: true, force: true }))
  }
  process.on('exit', cleanup)
  const startedAt = Date.now()
  let exitCode = 1
  try {
    // Decrypt first: a wrong passphrase or a damaged file should fail in
    // seconds, before any CLI call or container is started.
    console.log('Decrypting the backup...')
    const manifest = await readBackupOrExit(passphrase, extractDir)
    console.log(`Backup from ${manifest.createdAt} (source: ${manifest.source}), ${manifest.files.length} files.`)

    // A rehearsal that crashed earlier can leave its containers behind; clear
    // them by project id (never the development stack's id).
    supabase(['stop', '--no-backup', '--project-id', PROJECT_ID], { stdio: 'ignore', timeout: 300000 })
    console.log(`Rehearsal scratch stack: ${scratch}`)
    mustSucceed(supabase(['init', '--workdir', scratch], { stdio: 'inherit', timeout: 120000 }), 'supabase init')
    patchConfig(join(scratch, 'supabase', 'config.toml'))
    if (manifest.source === 'linked') copyLinkedVersions(scratch)

    console.log('Starting the throwaway stack (this can take a few minutes)...')
    stackTouched = true
    createLoopbackNetwork()
    // --network-id makes the CLI join the network created above by name instead of relying on its naming convention.
    mustSucceed(supabase(['start', '--workdir', scratch, '--network-id', NETWORK], { stdio: 'inherit', timeout: 600000 }), 'supabase start')
    assertLoopbackOnly()

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
    // Every bucket a backup holds is listed, an empty one too, and each must hold as many objects as the restored
    // database has rows for it: a backup that left a bucket out (the paid files) fails here, by name.
    const bucketRows = restoredBucketCounts()
    console.log('\nStorage objects (sha256 verified):')
    for (const bucket of new Set([...BUCKETS, ...objects.perBucket.keys(), ...bucketRows.keys()])) {
      const { verified, total } = objects.perBucket.get(bucket) ?? { verified: 0, total: 0 }
      const rowCount = bucketRows.get(bucket) ?? 0
      const ok = verified === total && total === rowCount
      if (!ok) problems.push(`${bucket}: ${verified}/${total} objects verified, ${rowCount} object rows in the restored database`)
      console.log(`  ${bucket.padEnd(width)}  ${total} objects, ${verified} verified  ${ok ? 'ok' : 'FAIL'}`)
    }
    if (objectRows !== objects.expected) {
      problems.push(`storage.objects has ${objectRows} rows but the backup holds ${objects.expected} objects`)
    }
    for (const failure of objects.failures) problems.push(failure)

    // The schedules are created by migrations, not carried by the dumps: re-run
    // them (after the counts above, so a purge job cannot touch the compared
    // rows), then require every one in cron.job.
    const cronStatements = cronScheduleStatements(join(repoRoot, 'supabase', 'migrations'))
    const expectedJobs = [...cronStatements.keys()]
    const heldBefore = restoredCronJobs()
    const applied = applyCronSchedules(cronStatements)
    if (applied.status === 0) {
      const held = heldBefore === null ? 0 : expectedJobs.length - missingCronJobs(expectedJobs, heldBefore).length
      console.log(`\nCaveat applied (runbook): re-ran ${expectedJobs.length} cron.schedule(...) statements from supabase/migrations (cron.job held ${held} of them before).`)
    } else {
      problems.push(`re-running the cron.schedule(...) statements failed (exit ${applied.status}): ${(applied.stderr ?? '').trim()}`)
    }
    const presentJobs = restoredCronJobs()
    console.log('\npg_cron schedules (every cron.schedule in supabase/migrations):')
    if (presentJobs === null) {
      problems.push('cron.job cannot be read in the restored database (pg_cron missing): no schedule exists')
    } else {
      const missingJobs = missingCronJobs(expectedJobs, presentJobs)
      for (const name of expectedJobs) console.log(`  ${name.padEnd(width)}  ${missingJobs.includes(name) ? 'MISSING' : 'ok'}`)
      if (missingJobs.length > 0) {
        problems.push(`cron.job still misses ${missingJobs.length} of ${expectedJobs.length} schedules after re-running the cron.schedule(...) statements: ${missingJobs.join(', ')}`)
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (problems.length > 0) {
      console.error('\nDifferences found:')
      for (const problem of problems) console.error(`  ${problem}`)
      console.error(`FAILED after ${elapsed}s (start to verified).`)
    } else {
      console.log(`\nOK: ${dumpCounts.size} tables, ${objects.expected} objects, ${expectedJobs.length} schedules verified in ${elapsed}s (start to verified).`)
      exitCode = 0
    }
  } finally {
    cleanup()
  }
  // Never report success while the restored plaintext is still on this disk, or after a cleanup step failed.
  process.exit(plaintextLeft || cleanupFailed ? 1 : exitCode)
}

process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
process.on('SIGHUP', () => process.exit(129))

await main()
