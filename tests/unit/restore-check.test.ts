// D35: `restore-check --extract` writes plaintext, so it refuses to do that
// inside the repository (a later `git add -A` could publish it). The expected
// failures of a tool run rarely and after a disaster end in one readable line,
// never a stack trace.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { writeBackup } from '../../scripts/lib/backup-format.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Runs `scripts/restore-check.mjs` of `repo` (the real repository unless a throwaway copy is given). */
function restoreCheck(args: string[], passphrase?: string, repo = repoRoot) {
  const env = { ...process.env }
  delete env.ANASAQ_BACKUP_PASSPHRASE
  if (passphrase !== undefined) env.ANASAQ_BACKUP_PASSPHRASE = passphrase
  return spawnSync(process.execPath, ['scripts/restore-check.mjs', ...args], { cwd: repo, encoding: 'utf8', env })
}

/** Whether this machine lets a test make a directory link (a symlink on POSIX; Windows allows a junction without elevation). */
function canLink(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'anasaq-link-probe-'))
  try {
    mkdirSync(join(probe, 'target'))
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
const CAN_LINK = canLink()

describe('what restore-check proves', () => {
  /** The buckets a script lists in its `BUCKETS` constant, in order. */
  const bucketsOf = (script: string): string[] => {
    const list = /const BUCKETS = \[([^\]]*)\]/.exec(readFileSync(join(repoRoot, 'scripts', script), 'utf8'))?.[1] ?? ''
    return [...list.matchAll(/'([a-z0-9_-]+)'/g)].map((match) => match[1]!)
  }

  it('lists the same buckets as the backup, the paid files included, so a backup that left one out cannot pass', () => {
    expect(bucketsOf('restore-check.mjs')).toEqual(bucketsOf('backup.mjs'))
    expect(bucketsOf('restore-check.mjs')).toContain('paid-files')
  })

  it('lets the scratch stack take the largest paid file: its storage limit is the project\'s own, not `supabase init`\'s 50 MiB', () => {
    const project = /^\[storage\]\r?\n(?:[^\r\n]*\r?\n)*?file_size_limit = "([^"]+)"/m.exec(readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8'))?.[1]
    expect(project).toBe('100MiB')
    expect(readFileSync(join(repoRoot, 'scripts', 'restore-check.mjs'), 'utf8')).toContain(`file_size_limit = "${project}"`)
  })

  it('compares each bucket with the restored database\'s own rows for it, not only the sum of all objects', () => {
    const source = readFileSync(join(repoRoot, 'scripts', 'restore-check.mjs'), 'utf8')
    expect(source).toMatch(/group by bucket_id/)
    expect(source).toMatch(/object rows in the restored database/)
  })
})

describe('restore-check --extract', { timeout: 60_000 }, () => {
  it('refuses a directory inside the repository before it reads anything', () => {
    const result = restoreCheck(['missing.enc', '--extract', 'restore-plaintext'], 'a-real-backup-passphrase-123')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(repoRoot, 'restore-plaintext'))).toBe(false)
  })
})

describe('restore-check --extract containment', { timeout: 60_000 }, () => {
  const PASSPHRASE = 'a-real-backup-passphrase-123'

  it.each([
    ['a folder whose name only starts with two dots', '..plain'],
    ['the repository root itself', '.'],
    ['a folder inside a repository folder', join('scripts', 'extracted-plaintext')],
  ])('refuses %s: it is inside the repository', (_name, dest) => {
    const result = restoreCheck(['missing.enc', '--extract', dest], PASSPHRASE)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(repoRoot, '..plain'))).toBe(false)
    expect(existsSync(join(repoRoot, 'scripts', 'extracted-plaintext'))).toBe(false)
  })

  it.each([
    ['the folder above the repository', '..'],
    ['a sibling of the repository', join('..', 'anasaq-restore-sibling')],
  ])('lets %s through, as it is outside: the missing backup file is what stops the run', (_name, dest) => {
    const result = restoreCheck(['missing.enc', '--extract', dest], PASSPHRASE)
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain('Refusing --extract inside the repository')
    expect(result.stderr).toMatch(/no such file/)
    expect(existsSync(resolve(repoRoot, '..', 'anasaq-restore-sibling'))).toBe(false)
  })
})

// A link into the repository is the repository: the guard compares real paths, so a junction or symlink cannot pass as
// outside (nor, on Windows, an 8.3 short name or a trailing dot, which resolve the same way but cannot be made here). It
// checks every folder the path passes through, so a link inside the repository that leads out of it is refused as well,
// however the repository is named on the way in. The script runs from a copy in a throwaway repository with the links
// beside it, so a guard that regressed could not write into the real one. Skipped where the machine does not let a test
// make a link.
describe.skipIf(!CAN_LINK)('restore-check --extract containment through a link', { timeout: 60_000 }, () => {
  const PASSPHRASE = 'a-real-backup-passphrase-123'
  let parent: string
  let repo: string

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'anasaq-restore-link-'))
    repo = join(parent, 'repo')
    mkdirSync(join(repo, 'scripts'), { recursive: true })
    copyFileSync(join(repoRoot, 'scripts', 'restore-check.mjs'), join(repo, 'scripts', 'restore-check.mjs'))
    cpSync(join(repoRoot, 'scripts', 'lib'), join(repo, 'scripts', 'lib'), { recursive: true })
    symlinkSync(join(repoRoot, 'node_modules'), join(repo, 'node_modules'), 'junction')
    mkdirSync(join(parent, 'elsewhere'))
    symlinkSync(repo, join(parent, 'repo-link'), 'junction')
    symlinkSync(join(repo, 'scripts'), join(parent, 'scripts-link'), 'junction')
    symlinkSync(join(parent, 'elsewhere'), join(repo, 'leads-out'), 'junction')
  })

  afterAll(() => {
    // The links go first, so that nothing below can follow one.
    for (const link of [join(parent, 'repo-link'), join(parent, 'scripts-link'), join(repo, 'leads-out'), join(repo, 'node_modules')]) {
      try {
        unlinkSync(link)
      } catch {
        // Not made: the setup stopped before it.
      }
    }
    rmSync(parent, { recursive: true, force: true })
  })

  it.each([
    ['a link to the repository', ['repo-link', 'linked-plaintext']],
    ['a folder that does not exist yet, below a link to the repository', ['repo-link', 'new', 'deeper', 'linked-plaintext']],
    ['a link to a folder inside the repository', ['scripts-link', 'linked-plaintext']],
  ])('refuses %s: it is inside the repository, whatever the path looks like', (_name, parts) => {
    const result = restoreCheck(['missing.enc', '--extract', join(parent, ...parts)], PASSPHRASE, repo)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(repo, 'linked-plaintext'))).toBe(false)
    expect(existsSync(join(repo, 'scripts', 'linked-plaintext'))).toBe(false)
    expect(existsSync(join(repo, 'new'))).toBe(false)
  })

  it('refuses a link inside the repository that leads out of it: Git for Windows treats a junction as a folder and would stage what lies behind it', () => {
    const result = restoreCheck(['missing.enc', '--extract', join(repo, 'leads-out', 'plaintext')], PASSPHRASE, repo)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(parent, 'elsewhere', 'plaintext'))).toBe(false)
  })

  it('refuses that link-out path when it is written through a link to the repository, as any alias of the repository would be', () => {
    const result = restoreCheck(['missing.enc', '--extract', join(parent, 'repo-link', 'leads-out', 'via-alias-plaintext')], PASSPHRASE, repo)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(parent, 'elsewhere', 'via-alias-plaintext'))).toBe(false)
  })
})

describe('restore-check arguments', { timeout: 60_000 }, () => {
  it('--help prints the usage and exits 0 before any passphrase prompt or CLI call', () => {
    const result = restoreCheck(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: pnpm restore-check')
    expect(restoreCheck(['-h']).status).toBe(0)
  })

  it.each([
    ['an unknown flag', ['--bogus']],
    ['--extract without a value', ['x.enc', '--extract']],
    ['--extract with an empty value (an unset variable)', ['x.enc', '--extract', '']],
    ['--extract followed by another flag', ['x.enc', '--extract', '--help-me']],
    ['a second file', ['a.enc', 'b.enc']],
  ])('%s is refused with the usage and exit 2, never the full rehearsal', (_name, args) => {
    const result = restoreCheck(args, 'a-real-backup-passphrase-123')
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Usage: pnpm restore-check')
  })
})

describe('restore-check --extract failures', () => {
  const GOOD = 'a-real-backup-passphrase-123'
  let root: string
  let good: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'anasaq-restore-cli-'))
    const plain = join(root, 'a.txt')
    writeFileSync(plain, 'plain text')
    good = join(root, 'good.enc')
    await writeBackup(good, [{ path: 'a.txt', file: plain }], GOOD)
  }, 30_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** One readable line on stderr, exit 1, no stack trace. */
  function expectFriendly(result: ReturnType<typeof restoreCheck>, message: RegExp) {
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(message)
    expect(result.stderr).not.toMatch(/\n\s+at /)
  }

  it('a wrong passphrase says so and leaves no destination behind', () => {
    const dest = join(root, 'dest-wrong')
    expectFriendly(restoreCheck([good, '--extract', dest], 'not-the-passphrase-xyz'), /wrong passphrase or damaged file/)
    expect(existsSync(dest)).toBe(false)
  }, 60_000)

  it('a file that is not a backup, a missing file and a destination that is not empty each say so', () => {
    const junk = join(root, 'junk.enc')
    writeFileSync(junk, randomBytes(500))
    expectFriendly(restoreCheck([junk, '--extract', join(root, 'dest-junk')], GOOD), /not an ANASAQ backup/)
    expectFriendly(restoreCheck([join(root, 'missing.enc'), '--extract', join(root, 'dest-missing')], GOOD), /no such file/)
    const busy = join(root, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'there.txt'), 'x')
    expectFriendly(restoreCheck([good, '--extract', busy], GOOD), /not empty/)
  }, 60_000)
})

// The rehearsal talks to Docker and the Supabase CLI. These tests put a stand-in for each on PATH (and nothing else on
// it, so the real ones can never be reached) and run a copy of the script in a throwaway repository: what the script asks
// them, in which order, and what it does with their answers is read from the calls the stand-in recorded. POSIX only: the
// stand-in is an executable script, which Windows cannot start by name.
const CAN_STUB = process.platform !== 'win32' && !/\s/.test(process.execPath)
const PROJECT_ID = 'anasaq-restore-check'
const CONTAINER = `supabase_db_${PROJECT_ID}`
const NETWORK = `supabase_network_${PROJECT_ID}`
const LABEL = `com.supabase.cli.project=${PROJECT_ID}`

interface Call {
  name: string
  args: string[]
  /** For `supabase start`: the files in the scratch workdir's supabase/.temp at that moment (null: no such folder). */
  temp?: Record<string, string> | null
}
/** One answer of the stand-in: the first rule whose `match` starts the command line wins; a call no rule matches succeeds silently. */
interface Rule {
  match: string
  status?: number
  stdout?: string
  stderr?: string
  /** After answering, remove the command's --workdir, as a temp-folder cleaner might while the stack runs. */
  removeWorkdir?: boolean
}

const STUB = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const name = path.basename(process.argv[1])
const args = process.argv.slice(2)
const state = process.env.STUB_STATE
const workdir = args.includes('--workdir') ? args[args.indexOf('--workdir') + 1] : undefined
const entry = { name, args }
if (name === 'supabase' && args[0] === 'start' && workdir) {
  const temp = path.join(workdir, 'supabase', '.temp')
  entry.temp = fs.existsSync(temp) ? Object.fromEntries(fs.readdirSync(temp).map((file) => [file, fs.readFileSync(path.join(temp, file), 'utf8')])) : null
}
fs.appendFileSync(path.join(state, 'calls.jsonl'), JSON.stringify(entry) + '\\n')
if (name === 'supabase' && args[0] === 'init' && workdir) {
  fs.mkdirSync(path.join(workdir, 'supabase'), { recursive: true })
  fs.writeFileSync(path.join(workdir, 'supabase', 'config.toml'), 'project_id = "scratch"\\n\\n[api]\\nport = 54321\\n')
}
const line = [name, ...args].join(' ')
const plan = JSON.parse(fs.readFileSync(path.join(state, 'plan.json'), 'utf8'))
const rule = plan.find((candidate) => line.startsWith(candidate.match)) ?? {}
if (rule.stdout) process.stdout.write(rule.stdout)
if (rule.stderr) process.stderr.write(rule.stderr)
if (rule.removeWorkdir && workdir) fs.rmSync(workdir, { recursive: true, force: true })
process.exit(rule.status ?? 0)
`

describe.skipIf(!CAN_STUB)('restore-check rehearsal, with a stand-in for Docker and the Supabase CLI', { timeout: 120_000 }, () => {
  const GOOD = 'a-real-backup-passphrase-123'
  let root: string
  let bin: string
  let local: string
  let linked: string
  let full: string
  let failRemoval: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'anasaq-restore-stub-'))
    bin = join(root, 'bin')
    mkdirSync(bin)
    for (const name of ['docker', 'supabase']) {
      writeFileSync(join(bin, name), STUB)
      chmodSync(join(bin, name), 0o755)
    }
    const plain = join(root, 'a.txt')
    writeFileSync(plain, 'plain text')
    local = join(root, 'local.enc')
    await writeBackup(local, [{ path: 'a.txt', file: plain }], GOOD, { source: 'local' })
    linked = join(root, 'linked.enc')
    await writeBackup(linked, [{ path: 'a.txt', file: plain }], GOOD, { source: 'linked' })
    // The smallest backup a whole rehearsal can verify: the five dumps, data.sql holding one empty storage.objects COPY block,
    // and no storage object.
    const dumps = join(root, 'dumps')
    mkdirSync(dumps)
    const names = ['roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql']
    for (const name of names) writeFileSync(join(dumps, name), name === 'data.sql' ? 'COPY "storage"."objects" ("id") FROM stdin;\n\\.\n' : '')
    full = join(root, 'full.enc')
    await writeBackup(full, names.map((name) => ({ path: name, file: join(dumps, name) })), GOOD, { source: 'local' })
    // A preload for the script's process: removing the directory of the decrypted dumps fails with EBUSY, as it does on
    // Windows while something holds one of its files open. (File permissions cannot stand in: root removes anything.)
    failRemoval = join(root, 'fail-removal.cjs')
    writeFileSync(
      failRemoval,
      [
        "const fs = require('node:fs')",
        'const rmSync = fs.rmSync',
        'fs.rmSync = (target, ...rest) => {',
        "  if (String(target).includes('anasaq-restore-files-')) throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${target}'`), { code: 'EBUSY' })",
        '  return rmSync(target, ...rest)',
        '}',
        '',
      ].join('\n'),
    )
  }, 60_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Runs a copy of the script in a throwaway repository whose supabase/.temp holds `tempFiles` and whose one migration is
   * `options.migration`; PATH is the stand-ins only. `options.nodeArgs` go to node before the script. */
  function rehearse(backup: string, plan: Rule[], tempFiles: Record<string, string> = {}, passphrase = GOOD, options: { migration?: string; nodeArgs?: string[] } = {}) {
    const run = mkdtempSync(join(root, 'run-'))
    const repo = join(run, 'repo')
    mkdirSync(join(repo, 'scripts'), { recursive: true })
    copyFileSync(join(repoRoot, 'scripts', 'restore-check.mjs'), join(repo, 'scripts', 'restore-check.mjs'))
    cpSync(join(repoRoot, 'scripts', 'lib'), join(repo, 'scripts', 'lib'), { recursive: true })
    symlinkSync(join(repoRoot, 'node_modules'), join(repo, 'node_modules'), 'dir')
    mkdirSync(join(repo, 'supabase', 'migrations'), { recursive: true })
    if (options.migration !== undefined) writeFileSync(join(repo, 'supabase', 'migrations', '0001_cron.sql'), options.migration)
    if (Object.keys(tempFiles).length > 0) {
      mkdirSync(join(repo, 'supabase', '.temp'))
      for (const [file, content] of Object.entries(tempFiles)) writeFileSync(join(repo, 'supabase', '.temp', file), content)
    }
    const state = join(run, 'state')
    mkdirSync(state)
    writeFileSync(join(state, 'plan.json'), JSON.stringify(plan))
    const temp = join(run, 'tmp')
    mkdirSync(temp)
    const result = spawnSync(process.execPath, [...(options.nodeArgs ?? []), join(repo, 'scripts', 'restore-check.mjs'), backup], {
      cwd: repo,
      encoding: 'utf8',
      // Nothing of the caller's environment but what the run needs; PATH holds the stand-ins and nothing else.
      env: { NODE_ENV: 'test', PATH: bin, TMPDIR: temp, TEMP: temp, TMP: temp, HOME: run, STUB_STATE: state, ANASAQ_BACKUP_PASSPHRASE: passphrase },
    })
    const log = join(state, 'calls.jsonl')
    const calls: Call[] = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Call)
      : []
    // Every run, whatever its plan: no call of the CLI goes without its target. Without `--workdir` (the scratch workdir,
    // under this run's temp folder) or `--project-id` (the rehearsal's own id), the CLI reads this repository's
    // supabase/config.toml and acts on the development stack, where a `stop --no-backup` removes its data volumes.
    for (const call of calls.filter((entry) => entry.name === 'supabase')) {
      const workdir = call.args.indexOf('--workdir')
      const projectId = call.args.indexOf('--project-id')
      const aimed = workdir >= 0 ? (call.args[workdir + 1] ?? '').startsWith(temp + sep) : projectId >= 0 && call.args[projectId + 1] === PROJECT_ID
      expect(aimed, `supabase ${call.args.join(' ')}`).toBe(true)
    }
    return { result, calls, commands: calls.map((call) => [call.name, ...call.args].join(' ')), tempLeft: readdirSync(temp) }
  }

  const START_FAILS: Rule = { match: 'supabase start', status: 1, stderr: 'stub: the stack did not start\n' }

  /** Where the cleanup calls of a run stand in its commands (-1: not made): the stop, the network removal, and the two
   * leftover checks, which find the containers and the volumes by the CLI's label for the project. */
  function cleanupCalls(commands: string[]) {
    return {
      stop: commands.findIndex((command) => command.startsWith('supabase stop --no-backup --workdir ')),
      removeNetwork: commands.indexOf(`docker network rm ${NETWORK}`),
      containers: commands.indexOf(`docker ps -a --filter label=${LABEL} --format {{.Names}}`),
      volumes: commands.indexOf(`docker volume ls --filter label=${LABEL} --format {{.Name}}`),
    }
  }

  describe('the development stack', () => {
    it('is never the target: the first call after decryption clears a crashed rehearsal by its own project id, and rehearse() checks every CLI call names its workdir or that id', () => {
      const { result, commands } = rehearse(local, [START_FAILS])
      expect(result.status).toBe(1)
      expect(commands[0]).toBe(`supabase stop --no-backup --project-id ${PROJECT_ID}`)
    })
  })

  describe('the network and the published ports', () => {
    it('creates the stack\'s network bound to the loopback address before the CLI starts on it, and refuses to restore when a port is published wider', () => {
      const { result, commands, tempLeft } = rehearse(local, [{ match: `docker port ${CONTAINER}`, stdout: '5432/tcp -> 0.0.0.0:55322\n5432/tcp -> [::]:55322\n' }])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Refusing to restore: the scratch database is published beyond the loopback address')
      expect(result.stderr).toContain('0.0.0.0:55322')
      expect(result.stderr).toContain('[::]:55322')

      const create = commands.indexOf(`docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 --label ${LABEL} ${NETWORK}`)
      const start = commands.findIndex((command) => command.startsWith('supabase start '))
      expect(create).toBeGreaterThan(-1)
      expect(start).toBeGreaterThan(create)
      // The CLI is told to join that network by name, not left to arrive at the same name by its convention.
      expect(commands[start]).toMatch(new RegExp(`^supabase start --workdir \\S+ --network-id ${NETWORK}$`))
      expect(commands.indexOf(`docker port ${CONTAINER}`)).toBeGreaterThan(start)
      // Nothing was restored or uploaded: no file copied into the container, no psql, no status read for the API key.
      expect(commands.filter((command) => /^docker (cp|exec) /.test(command) || command.startsWith('supabase status'))).toEqual([])
      // And the stack, its network and its data are checked for on the way out, in that order.
      const { stop, removeNetwork, containers, volumes } = cleanupCalls(commands)
      expect(stop).toBeGreaterThan(start)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
      expect(result.stderr).not.toContain('still on disk')
      expect(tempLeft).toEqual([])
    })

    it('goes on with the restore when every binding is on the loopback address', () => {
      const { result, commands } = rehearse(local, [
        { match: `docker port ${CONTAINER}`, stdout: '5432/tcp -> 127.0.0.1:55322\n' },
        { match: 'supabase status', status: 1, stderr: 'stub: no status\n' },
      ])
      expect(result.stderr).not.toContain('Refusing to restore')
      expect(commands.some((command) => command.startsWith('supabase status -o json --workdir '))).toBe(true)
      expect(result.stderr).toContain('supabase status failed (exit 1)')
    })

    it('refuses to restore when docker shows no published port at all: an empty answer proves nothing about where they are bound', () => {
      const { result, commands, tempLeft } = rehearse(local, [{ match: `docker port ${CONTAINER}`, stdout: '' }])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Refusing to restore')
      expect(result.stderr).toContain('shows no published port')
      expect(commands.filter((command) => /^docker (cp|exec) /.test(command) || command.startsWith('supabase status'))).toEqual([])
      expect(tempLeft).toEqual([])
    })

    it('never starts the stack when its loopback network cannot be created, and names the command that removes one left behind', () => {
      const { result, commands, tempLeft } = rehearse(local, [
        { match: 'docker network create', status: 1, stderr: `Error response from daemon: network with name ${NETWORK} already exists\n` },
      ])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`docker network create ${NETWORK} failed (exit 1)`)
      expect(result.stderr).toContain('already exists')
      // The remedy, not a bare stack trace.
      expect(result.stderr).toContain(`remove it with: docker network rm ${NETWORK}`)
      expect(result.stderr).not.toMatch(/\n\s+at /)
      expect(commands.some((command) => command.startsWith('supabase start'))).toBe(false)
      // What the pre-clean could not remove is still tried on the way out, and what is left is checked for.
      const { stop, removeNetwork, containers, volumes } = cleanupCalls(commands)
      expect(stop).toBeGreaterThan(-1)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
      expect(tempLeft).toEqual([])
    })

    it('touches no container and no network when the run fails before the stack: a wrong passphrase', () => {
      const { result, commands } = rehearse(local, [], {}, 'not-the-passphrase-xyz')
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/wrong passphrase or damaged file/)
      expect(commands.filter((command) => command.startsWith('docker '))).toEqual([])
    })
  })

  describe('what is left after the stop', () => {
    it.each([
      ['a container', [{ match: 'docker ps -a', stdout: `${CONTAINER}\nsupabase_auth_${PROJECT_ID}\n` }], [`container ${CONTAINER}`, `container supabase_auth_${PROJECT_ID}`]],
      ['a volume', [{ match: 'docker volume ls', stdout: `${CONTAINER}\n` }], [`volume ${CONTAINER}`]],
    ] as [string, Rule[], string[]][])('names %s that remains, says plaintext restored data is still on disk, and does not exit 0', (_name, rules, named) => {
      const { result, commands, tempLeft } = rehearse(local, [START_FAILS, ...rules])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('plaintext restored data is still on disk')
      for (const item of named) expect(result.stderr).toContain(`  ${item}\n`)
      expect(result.stderr).toContain(`supabase stop --no-backup --project-id ${PROJECT_ID}`)
      // The containers are found by the CLI's label for the project, as the volumes are, not by a substring of a name.
      expect(commands).toContain(`docker ps -a --filter label=${LABEL} --format {{.Names}}`)
      expect(commands).toContain(`docker volume ls --filter label=${LABEL} --format {{.Name}}`)
      expect(commands.some((command) => command.startsWith('docker ps -a') && command.includes('name='))).toBe(false)
      // The temp dirs go either way: the decrypted dumps must not stay behind because the stack did.
      expect(tempLeft).toEqual([])
    })

    it('says the stack is gone, and nothing about leftovers, when the stop took everything away', () => {
      const { result } = rehearse(local, [START_FAILS])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`Scratch stack removed: no container or volume of ${PROJECT_ID} remains.`)
      expect(result.stderr).not.toContain('still on disk')
      expect(result.stderr).not.toContain('Could not check')
    })

    it('does not pass in silence when docker cannot say whether anything remains', () => {
      const { result } = rehearse(local, [START_FAILS, { match: 'docker ps -a', status: 1, stderr: 'Cannot connect to the Docker daemon\n' }])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Could not check that the scratch stack is gone')
      expect(result.stderr).toContain('plaintext restored data may still be on disk')
    })
  })

  // A rehearsal in which every comparison passes: the answers the stand-ins give for it, a migration with one schedule, and
  // the backup `full`. With nothing left to fail in the run itself, what the exit code is made of is the aftermath.
  const MIGRATION = "select cron.schedule('job-a', '* * * * *', $$select 1$$);\n"
  const VERIFIES: Rule[] = [
    { match: `docker port ${CONTAINER}`, stdout: '5432/tcp -> 127.0.0.1:55322\n' },
    { match: 'supabase status', stdout: JSON.stringify({ API_URL: 'http://127.0.0.1:55321', SECRET_KEY: 'stub-not-a-secret' }) },
    { match: `docker exec ${CONTAINER} psql -U postgres --dbname postgres -At -F | -c select 'storage.objects'`, stdout: 'storage.objects|0\n' },
    { match: `docker exec ${CONTAINER} psql -U postgres --dbname postgres -At -c select jobname from cron.job`, stdout: 'job-a\n' },
  ]
  const VERIFIED = 'OK: 1 tables, 0 objects, 1 schedules verified'
  const rehearseVerified = (extra: Rule[] = [], nodeArgs: string[] = []) => rehearse(full, [...VERIFIES, ...extra], {}, GOOD, { migration: MIGRATION, nodeArgs })

  describe('a rehearsal in which every comparison passes', () => {
    it('exits 0, with nothing left behind, when nothing of the scratch stack remains', () => {
      const { result, commands, tempLeft } = rehearseVerified()
      expect(result.stdout).toContain(VERIFIED)
      expect(result.stdout).toContain(`Scratch stack removed: no container or volume of ${PROJECT_ID} remains.`)
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
      const { stop, removeNetwork, containers, volumes } = cleanupCalls(commands)
      expect(stop).toBeGreaterThan(-1)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
      expect(tempLeft).toEqual([])
    })

    it.each([
      ['a container', [{ match: 'docker ps -a', stdout: `${CONTAINER}\nsupabase_auth_${PROJECT_ID}\n` }], [`container ${CONTAINER}`, `container supabase_auth_${PROJECT_ID}`]],
      ['a volume', [{ match: 'docker volume ls', stdout: `${CONTAINER}\n` }], [`volume ${CONTAINER}`]],
    ] as [string, Rule[], string[]][])('exits 1, naming %s that remains, though every comparison passed', (_name, rules, named) => {
      const { result, tempLeft } = rehearseVerified(rules)
      expect(result.stdout).toContain(VERIFIED)
      expect(result.stdout).not.toContain('Scratch stack removed')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('plaintext restored data is still on disk')
      for (const item of named) expect(result.stderr).toContain(`  ${item}\n`)
      expect(result.stderr).toContain(`supabase stop --no-backup --project-id ${PROJECT_ID}`)
      expect(tempLeft).toEqual([])
    })

    it('exits 1 when docker cannot say whether anything remains', () => {
      const { result } = rehearseVerified([{ match: 'docker volume ls', status: 1, stderr: 'Cannot connect to the Docker daemon\n' }])
      expect(result.stdout).toContain(VERIFIED)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Could not check that the scratch stack is gone (`docker volume ls` did not answer')
      expect(result.stderr).toContain('plaintext restored data may still be on disk')
    })

    // The workdir disappears right after the stack answers `supabase status`, as if a temp-folder cleaner took it: the stack
    // is then stopped by its project id, the network removed and the leftovers checked, all the same.
    const workdirGone = (extra: Rule[] = []) =>
      rehearse(full, [{ ...VERIFIES.find((rule) => rule.match === 'supabase status')!, removeWorkdir: true }, ...extra, ...VERIFIES], {}, GOOD, { migration: MIGRATION })
    function stopAfterStatus(commands: string[]) {
      const status = commands.findIndex((command) => command.startsWith('supabase status'))
      const stop = commands.lastIndexOf(`supabase stop --no-backup --project-id ${PROJECT_ID}`)
      return { ...cleanupCalls(commands), status, stop, removeNetwork: commands.lastIndexOf(`docker network rm ${NETWORK}`) }
    }

    it('stops the stack by its project id when the scratch workdir is gone, and exits 0 when nothing of it remains', () => {
      const { result, commands, tempLeft } = workdirGone()
      expect(result.stdout).toContain(VERIFIED)
      const { status, stop, removeNetwork, containers, volumes } = stopAfterStatus(commands)
      // Not the pre-clean's stop: one after the stack ran.
      expect(stop).toBeGreaterThan(status)
      expect(commands.some((command) => command.startsWith('supabase stop --no-backup --workdir '))).toBe(false)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
      expect(result.stdout).toContain(`Scratch stack removed: no container or volume of ${PROJECT_ID} remains.`)
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
      expect(tempLeft).toEqual([])
    })

    it('exits 1, naming what remains, when the stop by project id leaves the stack behind', () => {
      const { result, commands } = workdirGone([{ match: 'docker ps -a', stdout: `${CONTAINER}\n` }])
      expect(result.stdout).toContain(VERIFIED)
      expect(result.status).toBe(1)
      const { status, stop, containers } = stopAfterStatus(commands)
      expect(stop).toBeGreaterThan(status)
      expect(containers).toBeGreaterThan(stop)
      expect(result.stderr).toContain('plaintext restored data is still on disk')
      expect(result.stderr).toContain(`  container ${CONTAINER}\n`)
    })
  })

  describe('a cleanup step that fails: the decrypted dumps cannot be removed (EBUSY)', () => {
    it('does not skip the stop, the network removal, the leftover check or the scratch workdir, and a run that passed does not exit 0', () => {
      const { result, commands, tempLeft } = rehearseVerified([], ['--require', failRemoval])
      expect(result.stdout).toContain(VERIFIED)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Cleanup step failed (removing the decrypted dumps in ')
      expect(result.stderr).toContain('delete that directory by hand')
      expect(result.stderr).toContain('EBUSY')
      expect(result.stderr).not.toMatch(/\n\s+at /)
      const { stop, removeNetwork, containers, volumes } = cleanupCalls(commands)
      expect(stop).toBeGreaterThan(-1)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
      expect(result.stdout).toContain(`Scratch stack removed: no container or volume of ${PROJECT_ID} remains.`)
      // Only the directory whose removal failed is left: the scratch workdir was removed after it.
      expect(tempLeft).toHaveLength(1)
      expect(tempLeft[0]).toMatch(/^anasaq-restore-files-/)
    })

    it('keeps the failure that ended the run as the error, and still runs every later step', () => {
      const { result, commands } = rehearse(local, [START_FAILS], {}, GOOD, { nodeArgs: ['--require', failRemoval] })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('supabase start failed (exit 1)')
      expect(result.stderr).toContain('Cleanup step failed (removing the decrypted dumps in ')
      expect(result.stderr).toContain('\nError: supabase start\n')
      const { stop, removeNetwork, containers, volumes } = cleanupCalls(commands)
      expect(stop).toBeGreaterThan(-1)
      expect(removeNetwork).toBeGreaterThan(stop)
      expect(containers).toBeGreaterThan(removeNetwork)
      expect(volumes).toBeGreaterThan(containers)
    })
  })

  describe('the linked project\'s service versions', () => {
    const TEMP_FILES = {
      'postgres-version': '17.6.1.032\n',
      'rest-version': 'v13.0.4\n',
      'gotrue-version': 'v2.180.0\n',
      'storage-version': 'v1.30.0\n',
      'storage-migration': 'optimise-existing-functions\n',
      'project-ref': 'abcdefghijklmnopqrst',
      'cli-latest': 'v2.106.0',
    }

    function startOf(calls: Call[]) {
      return calls.find((call) => call.name === 'supabase' && call.args[0] === 'start')
    }

    it('are in the scratch workdir before the stack starts, for a backup of the linked project, and only the version files', () => {
      const { result, calls } = rehearse(linked, [START_FAILS], TEMP_FILES)
      expect(startOf(calls)?.temp).toEqual({
        'postgres-version': '17.6.1.032\n',
        'rest-version': 'v13.0.4\n',
        'gotrue-version': 'v2.180.0\n',
        'storage-version': 'v1.30.0\n',
        'storage-migration': 'optimise-existing-functions\n',
      })
      expect(result.stdout).toContain('gotrue-version: v2.180.0')
      expect(result.stdout).toContain('storage-version: v1.30.0')
      expect(result.stdout).toContain('Service versions of the linked project')
    })

    it('are not copied for a backup of the local stack', () => {
      const { result, calls } = rehearse(local, [START_FAILS], TEMP_FILES)
      expect(startOf(calls)?.temp).toBeNull()
      expect(result.stdout).not.toContain('Service versions of the linked project')
    })

    it('are missed out loud when the repository has none to copy', () => {
      const { result, calls } = rehearse(linked, [START_FAILS])
      expect(startOf(calls)?.temp).toBeNull()
      expect(result.stdout).toContain('holds none of its service versions')
    })
  })
})
