// D35: `pnpm backup` refuses a bad command line before it touches anything. A
// missing or empty `--out` value (an unset shell variable) must not send the
// backup to the home directory while the owner believes it went to a USB drive.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

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

describe('backup arguments', () => {
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
