/**
 * The D35 backup file format: one encrypted, streamed archive, standard
 * library only. Every dump and restore command around it follows Supabase's
 * backup/restore guide (supabase.com/docs/guides/platform/migrating-within-
 * supabase/backup-restore).
 *
 * Layout: | header (46 bytes, also the GCM AAD) | ciphertext | 16-byte tag |
 * Header: ASCII magic "ANASAQ-BACKUP\n" (14) | version byte (1) | scrypt
 * parameters log2N=17, r=8, p=1 (3) | 16-byte random salt | 12-byte random
 * IV. Body: AES-256-GCM over gzip over the entries; each entry is a 4-byte
 * big-endian length, a JSON header {"path","size","sha256"}, then the raw
 * bytes. The first entry is always manifest.json.
 *
 * The passphrase is only ever passed in memory (a string, or a key Buffer
 * from deriveKey so callers can share one derivation); it never reaches a
 * file, a command line or a log.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createGzip, createGunzip } from 'node:zlib'

export const MAGIC = 'ANASAQ-BACKUP\n'
export const VERSION = 1
const MAGIC_BUF = Buffer.from(MAGIC, 'ascii')
// scrypt cost, fixed by format version 1: N = 2^17, r = 8, p = 1 (as header
// bytes 17, 8, 1). maxmem must cover 128 * N * r = 128 MiB.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const PARAMS_BUF = Buffer.from([17, 8, 1])
/** magic (14) + version (1) + scrypt parameters (3) + salt (16) + IV (12). */
export const HEADER_LEN = MAGIC_BUF.length + 1 + PARAMS_BUF.length + 16 + 12
const SALT_START = MAGIC_BUF.length + 1 + PARAMS_BUF.length
const IV_START = SALT_START + 16
const MAX_JSON_LEN = 64 * 1024

/** Error codes: NOT_A_BACKUP, WRONG_PASSPHRASE_OR_DAMAGED, CORRUPT. */
export class BackupFormatError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * A path that is safe to extract: relative, forward slashes only, no empty,
 * "." or ".." segment, no colon (a drive letter, or a Windows alternate data
 * stream), no leading slash, no control characters. Used by both the writer
 * and the reader.
 */
export function assertSafeEntryPath(p) {
  const fail = () => {
    throw new BackupFormatError('CORRUPT', `Unsafe entry path: ${JSON.stringify(p)}`)
  }
  if (typeof p !== 'string' || p === '') fail()
  if (/[\u0000-\u001f\u007f]/.test(p)) fail()
  if (p.includes('\\')) fail()
  if (p.startsWith('/')) fail()
  if (p.includes(':')) fail()
  for (const segment of p.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') fail()
  }
  return p
}

/** The AES-256 key for a passphrase and header salt, with the format's cost. */
export function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, SCRYPT)
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** One error capture per stream (created once, awaited on every write). */
function failurePromise(stream) {
  return new Promise((_, reject) => stream.once('error', reject))
}

/** Rejects as a BackupFormatError the moment the stream errors. */
function failureAs(stream, code, message) {
  return new Promise((_, reject) => stream.once('error', () => reject(new BackupFormatError(code, message))))
}

/** Writes with backpressure; rejects as soon as the stream itself errors. */
async function writeChunk(stream, chunk, failed) {
  if (!stream.write(chunk)) await Promise.race([once(stream, 'drain'), failed])
}

/** Ends a writable; rejects on its error instead of leaving it unhandled. */
function endStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.end(() => resolve())
  })
}

/** Resolves when a readable side has emitted everything; rejects on error. */
function readableEnded(stream) {
  return new Promise((resolve, reject) => {
    stream.once('end', resolve)
    stream.once('error', reject)
  })
}

/** Resolves when a writable has finished; rejects on error. */
function writableFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
  })
}

/**
 * Writes the archive: `outFile + '.partial'` first, renamed on success; the
 * partial file is deleted on any failure. `entries` are `{ path, file }`
 * (file: a plaintext path on disk); the manifest is generated here so it can
 * carry every entry's size and sha256. `options.source` is 'linked' or
 * 'local' and is recorded in the manifest only.
 */
export async function writeBackup(outFile, entries, passphrase, options = {}) {
  const source = options.source === 'linked' ? 'linked' : 'local'
  // The manifest is the first entry, so every digest is computed before any
  // archive byte is written (one extra read pass; the write stays streamed).
  const files = []
  for (const entry of entries) {
    assertSafeEntryPath(entry.path)
    const info = await stat(entry.file)
    const hash = createHash('sha256')
    await new Promise((resolve, reject) => {
      createReadStream(entry.file)
        .once('error', reject)
        .once('end', resolve)
        .pipe(hash, { end: false })
    })
    files.push({ path: entry.path, size: info.size, sha256: hash.digest('hex') })
  }
  const manifest = { version: VERSION, createdAt: new Date().toISOString(), source, files }
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([MAGIC_BUF, Buffer.from([VERSION]), PARAMS_BUF, salt, iv])
  const key = typeof passphrase === 'string' ? deriveKey(passphrase, salt) : passphrase
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const gzip = createGzip()
  const framing = new PassThrough()
  const out = createWriteStream(`${outFile}.partial`)
  const cipherDone = readableEnded(cipher)
  const outFailed = failurePromise(out)
  try {
    // The header goes to the file first, unencrypted: it is the AAD.
    await writeChunk(out, header, outFailed)
    framing.pipe(gzip).pipe(cipher).pipe(out, { end: false }) // the tag is appended after the cipher ends

    await writeEntryBytes(framing, 'manifest.json', manifestBytes)
    for (let index = 0; index < entries.length; index += 1) {
      await writeEntryFile(framing, files[index], entries[index].file)
    }
    framing.end()
    await cipherDone
    await writeChunk(out, cipher.getAuthTag(), outFailed)
    await endStream(out)
    await rename(`${outFile}.partial`, outFile)
  } catch (error) {
    for (const stream of [framing, gzip, cipher, out]) stream.destroy()
    await rm(`${outFile}.partial`, { force: true })
    throw error
  }
  return manifest
}

async function writeEntryBytes(framing, path, bytes) {
  await writeEntryHeader(framing, { path, size: bytes.length, sha256: sha256Hex(bytes) })
  const failed = failurePromise(framing)
  await writeChunk(framing, bytes, failed)
}

async function writeEntryFile(framing, meta, file) {
  await writeEntryHeader(framing, meta)
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .once('error', reject)
      .once('end', resolve)
      .pipe(framing, { end: false })
  })
}

async function writeEntryHeader(framing, meta) {
  const json = Buffer.from(JSON.stringify({ path: meta.path, size: meta.size, sha256: meta.sha256 }), 'utf8')
  if (json.length > MAX_JSON_LEN) throw new Error(`Entry header too long: ${meta.path}`)
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(json.length)
  const failed = failurePromise(framing)
  await writeChunk(framing, prefix, failed)
  await writeChunk(framing, json, failed)
}

/**
 * Decrypts and extracts into `destDir`, which must be new or empty. Checks
 * the magic, version, the GCM auth tag and every entry's size and sha256. On
 * any failure everything written is deleted and a BackupFormatError is thrown
 * (NOT_A_BACKUP, WRONG_PASSPHRASE_OR_DAMAGED or CORRUPT). Returns the parsed
 * manifest.
 */
export async function readBackup(inFile, passphrase, destDir) {
  const info = await stat(inFile)
  if (info.size < HEADER_LEN + 16) {
    throw new BackupFormatError('NOT_A_BACKUP', 'File is too small to be a backup.')
  }
  let createdDir = false
  try {
    const items = await readdir(destDir)
    if (items.length > 0) throw new Error(`Destination directory is not empty: ${destDir}`)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      await mkdir(destDir, { recursive: true })
      createdDir = true
    } else {
      throw error
    }
  }

  const handle = await open(inFile, 'r')
  try {
    const header = Buffer.alloc(HEADER_LEN)
    const tag = Buffer.alloc(16)
    await handle.read(header, 0, HEADER_LEN, 0)
    await handle.read(tag, 0, 16, info.size - 16)
    return await decryptAndExtract(inFile, info.size, header, tag, passphrase, destDir, createdDir)
  } finally {
    await handle.close()
  }
}

async function decryptAndExtract(inFile, fileSize, header, tag, passphrase, destDir, createdDir) {
  if (!header.subarray(0, MAGIC_BUF.length).equals(MAGIC_BUF)) {
    throw new BackupFormatError('NOT_A_BACKUP', 'This is not an ANASAQ backup (bad magic).')
  }
  if (header[MAGIC_BUF.length] !== VERSION) {
    throw new BackupFormatError('NOT_A_BACKUP', `Unknown backup format version: ${header[MAGIC_BUF.length]}`)
  }
  if (!header.subarray(MAGIC_BUF.length + 1, MAGIC_BUF.length + 4).equals(PARAMS_BUF)) {
    throw new BackupFormatError('NOT_A_BACKUP', 'Unknown scrypt parameters in header.')
  }
  const salt = header.subarray(SALT_START, IV_START)
  const iv = header.subarray(IV_START, HEADER_LEN)
  const key = typeof passphrase === 'string' ? deriveKey(passphrase, salt) : passphrase

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(tag) // a wrong passphrase or a flipped byte fails here
  const gunzip = createGunzip()
  const extractor = new EntryExtractor(destDir)
  const src = createReadStream(inFile, { start: HEADER_LEN, end: fileSize - 17 })
  // A pipe does not forward errors, so every stream carries its own capture:
  // the decipher and gunzip failures mean the tag cannot hold for these bytes
  // (wrong passphrase or damage); extractor errors are already coded.
  const wrongKey = failureAs(decipher, 'WRONG_PASSPHRASE_OR_DAMAGED', 'Decryption failed: wrong passphrase or damaged file.')
  const badStream = failureAs(gunzip, 'WRONG_PASSPHRASE_OR_DAMAGED', 'Decryption failed: wrong passphrase or damaged file.')
  const srcFailed = failurePromise(src)
  const extractorDone = writableFinished(extractor)
  src.pipe(decipher).pipe(gunzip).pipe(extractor)

  try {
    await Promise.race([extractorDone, wrongKey, badStream, srcFailed])
    return extractor.manifest
  } catch (error) {
    for (const stream of [src, decipher, gunzip, extractor]) stream.destroy()
    await cleanupExtracted(destDir, createdDir)
    throw error
  }
}

async function cleanupExtracted(destDir, createdDir) {
  if (createdDir) {
    await rm(destDir, { force: true, recursive: true })
    return
  }
  // readBackup only extracts into an empty directory, so everything in it
  // now, nested directories included, came from this extraction.
  for (const name of await readdir(destDir)) await rm(join(destDir, name), { force: true, recursive: true })
}

/**
 * The framing state machine on the decrypted, decompressed stream:
 * 4-byte length -> JSON header -> exactly `size` bytes (hashed while written).
 * The first entry must be manifest.json.
 */
class EntryExtractor extends Writable {
  constructor(destDir) {
    super()
    this.destDir = destDir
    this.buf = Buffer.alloc(0)
    this.state = 'len'
    this.jsonLen = 0
    this.entry = null
    this.hash = null
    this.sizeLeft = 0
    this.bytesSeen = 0
    this.manifestParts = null
    this.ws = null
    this.wsFailed = null
    this.entries = 0
    this.written = new Set()
    this.manifest = null
  }

  _write(chunk, _encoding, callback) {
    this.consume(chunk).then(() => callback(null), (error) => callback(error))
  }

  _final(callback) {
    if (this.state !== 'len' || this.entries === 0) {
      callback(new BackupFormatError('CORRUPT', 'Entry data is truncated.'))
      return
    }
    callback(null)
  }

  async consume(chunk) {
    let data = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    this.buf = Buffer.alloc(0)
    for (;;) {
      if (this.state === 'len') {
        if (data.length < 4) break
        this.jsonLen = data.readUInt32BE(0)
        if (this.jsonLen > MAX_JSON_LEN) throw new BackupFormatError('CORRUPT', 'Entry header length is impossible.')
        this.state = 'json'
        data = data.subarray(4)
      } else if (this.state === 'json') {
        if (data.length < this.jsonLen) break
        await this.openEntry(data.subarray(0, this.jsonLen))
        data = data.subarray(this.jsonLen)
      } else {
        // state === 'data'
        if (data.length === 0) break
        const take = Math.min(this.sizeLeft, data.length)
        const slice = data.subarray(0, take)
        this.hash.update(slice)
        this.bytesSeen += take
        if (this.manifestParts !== null) this.manifestParts.push(slice)
        await writeChunk(this.ws, slice, this.wsFailed)
        this.sizeLeft -= take
        data = data.subarray(take)
        if (this.sizeLeft === 0) await this.closeEntry()
      }
    }
    this.buf = data
  }

  async openEntry(jsonBytes) {
    let meta
    try {
      meta = JSON.parse(jsonBytes.toString('utf8'))
    } catch {
      throw new BackupFormatError('CORRUPT', 'Entry header is not JSON.')
    }
    const valid =
      typeof meta?.path === 'string' &&
      typeof meta?.size === 'number' &&
      Number.isInteger(meta.size) &&
      meta.size >= 0 &&
      typeof meta?.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(meta.sha256)
    if (!valid) throw new BackupFormatError('CORRUPT', 'Entry header is missing path, size or sha256.')
    assertSafeEntryPath(meta.path)
    if (this.entries === 0 && meta.path !== 'manifest.json') {
      throw new BackupFormatError('CORRUPT', 'The first entry must be manifest.json.')
    }
    const dest = join(this.destDir, ...meta.path.split('/'))
    if (this.written.has(dest)) {
      throw new BackupFormatError('CORRUPT', `Duplicate entry path: ${meta.path}`)
    }
    await mkdir(dirname(dest), { recursive: true })
    this.ws = createWriteStream(dest)
    this.wsFailed = failurePromise(this.ws)
    this.written.add(dest)
    this.entry = meta
    this.hash = createHash('sha256')
    this.sizeLeft = meta.size
    this.bytesSeen = 0
    this.manifestParts = this.entries === 0 ? [] : null
    this.state = 'data'
  }

  async closeEntry() {
    await endStream(this.ws)
    if (this.bytesSeen !== this.entry.size || this.hash.digest('hex') !== this.entry.sha256) {
      throw new BackupFormatError('CORRUPT', `Entry ${this.entry.path} failed its size or sha256 check.`)
    }
    if (this.entries === 0) {
      try {
        this.manifest = JSON.parse(Buffer.concat(this.manifestParts).toString('utf8'))
      } catch {
        throw new BackupFormatError('CORRUPT', 'manifest.json is not valid JSON.')
      }
    }
    this.entries += 1
    this.ws = null
    this.state = 'len'
  }
}
