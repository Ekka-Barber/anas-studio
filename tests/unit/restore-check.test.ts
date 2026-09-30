// D35: `restore-check --extract` writes plaintext, so it refuses to do that
// inside the repository (a later `git add -A` could publish it).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

describe('restore-check --extract', () => {
  it('refuses a directory inside the repository before it reads anything', () => {
    const result = spawnSync(process.execPath, ['scripts/restore-check.mjs', 'missing.enc', '--extract', 'restore-plaintext'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ANASAQ_BACKUP_PASSPHRASE: 'a-real-backup-passphrase-123' },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing --extract inside the repository')
    expect(existsSync(join(repoRoot, 'restore-plaintext'))).toBe(false)
  })
})
