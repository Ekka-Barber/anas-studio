// D35: `restore-check --extract` writes plaintext, so it refuses to do that
// inside the repository (a later `git add -A` could publish it). The expected
// failures of a tool run rarely and after a disaster end in one readable line,
// never a stack trace.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { writeBackup } from '../../scripts/lib/backup-format.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function restoreCheck(args: string[], passphrase?: string) {
  const env = { ...process.env }
  delete env.ANASAQ_BACKUP_PASSPHRASE
  if (passphrase !== undefined) env.ANASAQ_BACKUP_PASSPHRASE = passphrase
  return spawnSync(process.execPath, ['scripts/restore-check.mjs', ...args], { cwd: repoRoot, encoding: 'utf8', env })
}

describe('restore-check --extract', () => {
  it('refuses a directory inside the repository before it reads anything', () => {
    const result = restoreCheck(['missing.enc', '--extract', 'restore-plaintext'], 'a-real-backup-passphrase-123')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(repoRoot, 'restore-plaintext'))).toBe(false)
  })
})

describe('restore-check arguments', () => {
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
  }, 30_000)

  it('a file that is not a backup, a missing file and a destination that is not empty each say so', () => {
    const junk = join(root, 'junk.enc')
    writeFileSync(junk, randomBytes(500))
    expectFriendly(restoreCheck([junk, '--extract', join(root, 'dest-junk')], GOOD), /not an ANASAQ backup/)
    expectFriendly(restoreCheck([join(root, 'missing.enc'), '--extract', join(root, 'dest-missing')], GOOD), /no such file/)
    const busy = join(root, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'there.txt'), 'x')
    expectFriendly(restoreCheck([good, '--extract', busy], GOOD), /not empty/)
  }, 30_000)
})
