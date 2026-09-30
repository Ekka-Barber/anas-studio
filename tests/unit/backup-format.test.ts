// D35: the backup file format — round trips, tamper detection and path
// safety. The cost is the real one (scrypt N=2^17, r=8, p=1): every round
// trip shares one key derivation by passing the derived key Buffer, and only
// the passphrase tests pay the scrypt cost, so the file runs in seconds.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assertSafeEntryPath,
  BackupFormatError,
  deriveKey,
  readBackup,
  writeBackup,
} from '../../scripts/lib/backup-format.mjs'

const PASSPHRASE = 'a-real-backup-passphrase-123'

let root: string
let src: string
let dest: string
let outFile: string
let key: Buffer

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'anasaq-backup-format-'))
  src = join(root, 'src')
  dest = join(root, 'dest')
  mkdirSync(join(src, 'nested', 'deep'), { recursive: true })
  writeFileSync(join(src, 'a.txt'), 'Some plain text, including Arabic: «النسخ الاحتياطي».\n')
  const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x10, 0x7f, 0x80, 0xaa, 0x55])
  writeFileSync(join(src, 'nested', 'data.bin'), binary)
  writeFileSync(join(src, 'nested', 'deep', 'empty.txt'), '')
  writeFileSync(join(src, 'nested', 'deep', 'blob.json'), JSON.stringify({ hello: 'world', n: 42 }))
  outFile = join(root, 'backup.enc')
  ENTRIES = ENTRY_PATHS.map((path) => ({ path, file: join(src, ...path.split('/')) }))
  // One shared derivation for every round trip in this file.
  key = deriveKey(PASSPHRASE, randomBytes(16))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const ENTRY_PATHS = ['a.txt', 'nested/data.bin', 'nested/deep/empty.txt', 'nested/deep/blob.json']
let ENTRIES: Array<{ path: string; file: string }> = []

async function writeSample() {
  const manifest = await writeBackup(outFile, ENTRIES, key)
  return manifest
}

/** Each tamper test gets its own freshly written file, so tests stay isolated. */
async function tamperedFile(name: string, mutate: (bytes: Buffer) => void): Promise<string> {
  const file = join(root, name)
  await writeBackup(file, ENTRIES, key)
  const bytes = readFileSync(file)
  mutate(bytes)
  writeFileSync(file, bytes)
  return file
}

describe('writeBackup / readBackup', () => {
  it('round-trips text, binary, empty and nested files, and builds the manifest', async () => {
    const manifest = await writeSample()
    expect(manifest.version).toBe(1)
    expect(manifest.source).toBe('local')
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(ENTRIES.map((e) => e.path))
    for (const file of manifest.files) {
      expect(file.size).toBe(readFileSync(join(src, ...file.path.split('/'))).length)
      expect(file.sha256).toBe(
        createHash('sha256').update(readFileSync(join(src, ...file.path.split('/')))).digest('hex'),
      )
    }

    const read = await readBackup(outFile, key, dest)
    expect(read.files).toEqual(manifest.files)
    for (const entry of ENTRIES) {
      const extracted = readFileSync(join(dest, ...entry.path.split('/')))
      expect(extracted.equals(readFileSync(entry.file))).toBe(true)
    }
  })

  it('extracts an archive whose last entry is an empty file', async () => {
    // Studio's `.emptyFolderPlaceholder` objects are 0 bytes and can sort last.
    const lastEmpty = [ENTRIES[0]!, ENTRIES[2]!]
    const emptyOut = join(root, 'backup-empty-last.enc')
    const emptyDest = join(root, 'dest-empty-last')
    await writeBackup(emptyOut, lastEmpty, key)
    const manifest = await readBackup(emptyOut, key, emptyDest)
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(['a.txt', 'nested/deep/empty.txt'])
    expect(readFileSync(join(emptyDest, 'nested', 'deep', 'empty.txt')).length).toBe(0)
  })

  it('works with a string passphrase too (real scrypt on both sides)', async () => {
    const stringOut = join(root, 'backup-string.enc')
    const stringDest = join(root, 'dest-string')
    await writeBackup(stringOut, [ENTRIES[0]!], PASSPHRASE)
    const manifest = await readBackup(stringOut, PASSPHRASE, stringDest)
    expect(manifest.files[0]!.path).toBe('a.txt')
  }, 30_000)

  it('refuses a destination that is not empty', async () => {
    const busy = join(root, 'busy')
    mkdirSync(busy, { recursive: true })
    writeFileSync(join(busy, 'there.txt'), 'x')
    await expect(readBackup(outFile, key, busy)).rejects.toThrow(/not empty/)
  })

  it('a wrong passphrase fails with WRONG_PASSPHRASE_OR_DAMAGED and nothing left in destDir', async () => {
    await writeSample()
    const target = join(root, 'dest-wrong')
    await expect(readBackup(outFile, deriveKey('not-the-passphrase!!', randomBytes(16)), target)).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE_OR_DAMAGED',
    })
    expect(existsSync(target)).toBe(false)
  }, 30_000)

  it('a flipped ciphertext byte fails the same way', async () => {
    const file = await tamperedFile('flip-cipher.enc', (bytes) => {
      const at = bytes.length - 20 // inside the ciphertext, before the tag
      bytes[at] = (bytes[at] ?? 0) ^ 0x01
    })
    const target = join(root, 'dest-flip')
    await expect(readBackup(file, key, target)).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE_OR_DAMAGED',
    })
    expect(existsSync(target)).toBe(false)
  })

  it('a failure inside an existing empty destination leaves it empty, nested folders included', async () => {
    const file = await tamperedFile('flip-existing.enc', (bytes) => {
      const at = bytes.length - 20
      bytes[at] = (bytes[at] ?? 0) ^ 0x01
    })
    const target = join(root, 'dest-existing')
    mkdirSync(target)
    await expect(readBackup(file, key, target)).rejects.toMatchObject({ code: 'WRONG_PASSPHRASE_OR_DAMAGED' })
    expect(readdirSync(target)).toEqual([])
  })

  it('a flipped header byte (the AAD) fails the same way', async () => {
    const file = await tamperedFile('flip-header.enc', (bytes) => {
      bytes[18] = (bytes[18] ?? 0) ^ 0x01 // first salt byte
    })
    const target = join(root, 'dest-aad')
    await expect(readBackup(file, key, target)).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE_OR_DAMAGED',
    })
    expect(existsSync(target)).toBe(false)
  })

  it('a truncated file fails with nothing left behind', async () => {
    const file = await tamperedFile('truncated.enc', () => {})
    const bytes = readFileSync(file)
    writeFileSync(file, bytes.subarray(0, Math.floor(bytes.length / 2)))
    const target = join(root, 'dest-trunc')
    await expect(readBackup(file, key, target)).rejects.toSatisfy((error: unknown) => {
      const code = (error as BackupFormatError).code
      return code === 'WRONG_PASSPHRASE_OR_DAMAGED' || code === 'CORRUPT'
    })
    expect(existsSync(target)).toBe(false)
  })

  it('a file that is not a backup gives NOT_A_BACKUP', async () => {
    const junk = join(root, 'junk.enc')
    writeFileSync(junk, randomBytes(500))
    await expect(readBackup(junk, key, join(root, 'dest-junk'))).rejects.toMatchObject({ code: 'NOT_A_BACKUP' })
    // A broken magic inside a real backup is the same verdict.
    const file = await tamperedFile('bad-magic.enc', (bytes) => {
      bytes[0] = 0x58
    })
    await expect(readBackup(file, key, join(root, 'dest-magic'))).rejects.toMatchObject({ code: 'NOT_A_BACKUP' })
  })

  it('the writer deletes the partial file and rethrows when an entry disappears', async () => {
    // writeBackup reads `file` three times: stat, the digest pass, then the
    // write pass after `${outFile}.partial` is open. Only the third read sees
    // the file gone, so the failure happens mid-write and the cleanup must run.
    let reads = 0
    const broken = [
      {
        path: 'gone.txt',
        get file() {
          return reads++ < 2 ? ENTRIES[0]!.file : join(root, 'does-not-exist.txt')
        },
      },
    ]
    await expect(writeBackup(outFile, broken, key)).rejects.toThrow()
    expect(reads).toBe(3)
    expect(existsSync(`${outFile}.partial`)).toBe(false)
  })

  it('the writer refuses an unsafe entry path', async () => {
    const evil = [{ path: '../outside.txt', file: ENTRIES[0]!.file }]
    await expect(writeBackup(join(root, 'evil.enc'), evil, key)).rejects.toMatchObject({ code: 'CORRUPT' })
  })
})

describe('assertSafeEntryPath', () => {
  it('accepts normal relative paths', () => {
    expect(assertSafeEntryPath('storage/media-private/originals/x')).toBe('storage/media-private/originals/x')
    expect(assertSafeEntryPath('data.sql')).toBe('data.sql')
  })

  it('refuses traversal, absolute, drive-letter, alternate-stream, backslash and empty-segment paths', () => {
    for (const bad of ['..', './x', '/x', 'C:/x', 'a/b:stream', 'a\\b', 'a//b']) {
      expect(() => assertSafeEntryPath(bad)).toThrow(BackupFormatError)
    }
  })
})
