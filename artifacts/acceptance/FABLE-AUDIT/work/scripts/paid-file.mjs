#!/usr/bin/env node
// The backup rehearsal's paid file (battery-backup.sh), on the LOCAL stack only.
// Usage: node paid-file.mjs put <key> | remove <key>
// `put` uploads a small PDF-typed file (the bucket takes PDF and EPUB only) under <key> in `paid-files` and prints its
// size and sha256; `remove` deletes that one object. The keys come from `supabase status -o json`, as in
// tests/e2e/helpers.ts, and are never printed; a status whose API is not on this machine is refused.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const require = createRequire(path.join(repoRoot, 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const [command, key] = process.argv.slice(2)
if (!['put', 'remove'].includes(command) || !key || !key.startsWith('assets/backup-rehearsal/')) {
  console.error('usage: node paid-file.mjs put|remove assets/backup-rehearsal/<name>.pdf')
  process.exit(2)
}

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
const host = new URL(status.API_URL).hostname
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error('Refusing: supabase status API_URL is not a local host.')
  process.exit(1)
}
const bucket = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from('paid-files')

if (command === 'put') {
  const body = Buffer.concat([Buffer.from('%PDF-1.4\n% anas.studio backup rehearsal\n'), randomBytes(256 * 1024), Buffer.from('\n%%EOF\n')])
  const { error } = await bucket.upload(key, body, { contentType: 'application/pdf', upsert: false })
  if (error) {
    console.error(`paid file not uploaded: ${error.message}`)
    process.exit(1)
  }
  console.log(`paid file uploaded for the rehearsal: ${key}, ${body.length} bytes, sha256 ${createHash('sha256').update(body).digest('hex')}`)
} else {
  const { data, error } = await bucket.remove([key])
  if (error || !data || data.length !== 1) {
    console.error(`paid file not removed: ${error ? error.message : 'no object by that name'}`)
    process.exit(1)
  }
  console.log(`paid file removed after the rehearsal: ${key}`)
}
