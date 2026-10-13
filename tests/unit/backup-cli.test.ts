// D35: `pnpm backup` refuses a bad command line before it touches anything. A
// missing or empty `--out` value (an unset shell variable) must not send the
// backup to the home directory while the owner believes it went to a USB drive.
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

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

let home: string

// A private home: if a refused command line ever gets past the check, the
// default ~/ANASAQ-backups lands here, where the test can see it.
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'anasaq-backup-cli-'))
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

function backup(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home }
  delete env.ANASAQ_BACKUP_PASSPHRASE
  return spawnSync(process.execPath, ['scripts/backup.mjs', ...args], { cwd: repoRoot, encoding: 'utf8', env })
}

/** The buckets a script lists in its `BUCKETS` constant, in order. */
function bucketsOf(script: string): string[] {
  const list = /const BUCKETS = \[([^\]]*)\]/.exec(readFileSync(join(repoRoot, 'scripts', script), 'utf8'))?.[1] ?? ''
  return [...list.matchAll(/'([a-z0-9_-]+)'/g)].map((match) => match[1]!)
}

describe('what a backup holds', () => {
  it('every bucket of the store, the paid files included: they are the product, and a restore without them is not a restore', () => {
    expect(bucketsOf('backup.mjs')).toEqual(['media-private', 'media-public', 'paid-files'])
  })
})

describe('backup arguments', { timeout: 60_000 }, () => {
  it('--help prints the usage and exits 0', () => {
    const result = backup(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: pnpm backup')
  })

  it.each([
    ['--out without a value', ['--local', '--out']],
    ['--out with an empty value (an unset variable)', ['--local', '--out', '']],
    ['--out followed by another flag', ['--out', '--local']],
    ['an unknown flag', ['--bogus']],
  ])('%s is refused with the usage and exit 2, and writes nothing', (_name, args) => {
    const result = backup(args)
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Usage: pnpm backup')
    expect(existsSync(join(home, 'ANASAQ-backups'))).toBe(false)
  })
})

// A backup inside the repository could be committed by accident. The guard compares paths with `path.relative`: a folder
// that merely starts with two dots (`..plain`) is inside the repository, while '..' and '../x' are outside it. The script
// runs from a copy in a throwaway repository, so a guard that regressed could not write into the real one.
describe('backup --out containment', { timeout: 60_000 }, () => {
  /** The throwaway repository inside the private home, made on first use. */
  function throwawayRepo() {
    const repo = join(home, 'repo')
    if (!existsSync(repo)) {
      mkdirSync(join(repo, 'scripts'), { recursive: true })
      copyFileSync(join(repoRoot, 'scripts', 'backup.mjs'), join(repo, 'scripts', 'backup.mjs'))
      cpSync(join(repoRoot, 'scripts', 'lib'), join(repo, 'scripts', 'lib'), { recursive: true })
    }
    return repo
  }

  function backupFromCopy(args: string[]) {
    const repo = throwawayRepo()
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home }
    delete env.ANASAQ_BACKUP_PASSPHRASE
    return { repo, result: spawnSync(process.execPath, [join(repo, 'scripts', 'backup.mjs'), ...args], { cwd: repo, encoding: 'utf8', env }) }
  }

  it.each([
    ['a folder whose name only starts with two dots', '..plain'],
    ['the repository root itself', '.'],
    ['a folder inside a repository folder', join('scripts', 'backups')],
  ])('refuses %s: it is inside the repository, and nothing is written', (_name, dest) => {
    const { repo, result } = backupFromCopy(['--local', '--out', dest])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --out inside the repository')
    expect(existsSync(join(repo, '..plain'))).toBe(false)
    expect(existsSync(join(repo, 'scripts', 'backups'))).toBe(false)
    expect(existsSync(join(home, 'ANASAQ-backups'))).toBe(false)
  })

  it.each([
    ['the folder above the repository', '..'],
    ['a folder outside it', join('..', 'outside-the-repository')],
  ])('lets %s through, as it is outside: the missing passphrase is what stops the run, before any CLI call', (_name, dest) => {
    const { result } = backupFromCopy(['--local', '--out', dest])
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain('Refusing --out inside the repository')
    expect(result.stderr).toContain('No passphrase source')
  })

  // The guard compares real paths, so a junction or symlink cannot pass as outside (nor, on Windows, an 8.3 short name or a
  // trailing dot, which resolve the same way but cannot be made here). It compares the written path too, so a link inside
  // the repository that leads out of it is refused as well. The links are made in the private home, beside the throwaway
  // repository, never in the real one. Skipped where the machine does not let a test make a link.
  describe.skipIf(!CAN_LINK)('through a link', () => {
    let repo: string

    beforeAll(() => {
      repo = throwawayRepo()
      mkdirSync(join(home, 'elsewhere'))
      symlinkSync(repo, join(home, 'repo-link'), 'junction')
      symlinkSync(join(repo, 'scripts'), join(home, 'scripts-link'), 'junction')
      symlinkSync(join(home, 'elsewhere'), join(repo, 'leads-out'), 'junction')
    })

    afterAll(() => {
      // The links go first, so that nothing below can follow one.
      for (const link of [join(home, 'repo-link'), join(home, 'scripts-link'), join(repo, 'leads-out')]) {
        try {
          unlinkSync(link)
        } catch {
          // Not made: the setup stopped before it.
        }
      }
    })

    it.each([
      ['a link to the repository', ['repo-link', 'backups']],
      ['a folder that does not exist yet, below a link to the repository', ['repo-link', 'new', 'deeper', 'backups']],
      ['a link to a folder inside the repository', ['scripts-link', 'backups']],
    ])('refuses %s: it is inside the repository, whatever the path looks like, and nothing is written', (_name, parts) => {
      const { result } = backupFromCopy(['--local', '--out', join(home, ...parts)])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Refusing --out inside the repository')
      expect(existsSync(join(repo, 'backups'))).toBe(false)
      expect(existsSync(join(repo, 'scripts', 'backups'))).toBe(false)
      expect(existsSync(join(repo, 'new'))).toBe(false)
      expect(existsSync(join(home, 'ANASAQ-backups'))).toBe(false)
    })

    it('refuses a link inside the repository that leads out of it, and nothing is written: Git for Windows treats a junction as a folder and would stage what lies behind it', () => {
      const { result } = backupFromCopy(['--local', '--out', join(repo, 'leads-out', 'backups')])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Refusing --out inside the repository')
      expect(existsSync(join(home, 'elsewhere', 'backups'))).toBe(false)
    })
  })
})
