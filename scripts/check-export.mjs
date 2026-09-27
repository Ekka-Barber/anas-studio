#!/usr/bin/env node
/**
 * The static export in `out/` (D32) is what Cloudflare Pages serves. This
 * checks that it is complete and that nothing secret was bundled into it:
 *
 * - every public page, the admin shells, `404.html` and `_headers` exist;
 * - no file contains a server-side secret. The patterns match secret values,
 *   not names (supabase-js itself mentions the `sb_secret_` prefix), and
 *   any JWT found is decoded so a `service_role` token is caught whatever
 *   its signature. Matches are reported by file and kind, never by value.
 *
 * Missing build output is a failure, never a pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, 'out')

const REQUIRED = [
  'index.html',
  'started.html',
  'built.html',
  'passed.html',
  'shelf.html',
  'journal.html',
  'contact.html',
  'book.html',
  'scenes.html',
  'store.html',
  'cart.html',
  'checkout.html',
  'policies/store.html',
  'policies/delivery.html',
  'policies/refund.html',
  'policies/privacy.html',
  '404.html',
  '_headers',
  'admin.html',
  'admin/sign-in.html',
  'admin/preview.html',
  'admin/content/rooms/edit.html',
  'admin/content/posts/edit.html',
  'admin/content/site_settings/edit.html',
  'admin/content/taxonomies/edit.html',
]

// Every public page is Arabic RTL; losing the html attributes would scramble
// the layout while every other check stays green.
const RTL_PAGES = REQUIRED.filter((file) => file.endsWith('.html') && !file.startsWith('admin') && file !== '404.html')

const SECRET_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['Svix webhook secret', /whsec_[A-Za-z0-9+/=]{16,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['local jobs secret', /local-jobs-secret-not-for-production/],
  ['local token pepper', /local-pepper-not-for-production/],
]
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g

if (!existsSync(outDir)) {
  console.error('No static export found at out/. Run `pnpm build` first.')
  process.exit(1)
}

const failures = []
for (const file of REQUIRED) {
  if (!existsSync(path.join(outDir, file))) failures.push(`missing ${file}`)
}
for (const page of RTL_PAGES) {
  const head = readFileSync(path.join(outDir, page), 'utf8').slice(0, 600)
  if (!/<html\b[^>]*\blang="ar"[^>]*\bdir="rtl"/.test(head)) failures.push(`${page}: html is not lang="ar" dir="rtl"`)
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* files(full)
    else yield full
  }
}

const TEXT = /\.(html|txt|js|css|json|map|xml|webmanifest)$|\/_headers$/
let scanned = 0
for (const file of files(outDir)) {
  if (!TEXT.test(file)) continue
  scanned += 1
  const text = readFileSync(file, 'utf8')
  const relative = path.relative(outDir, file)
  for (const [kind, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) failures.push(`${relative}: ${kind}`)
  }
  for (const match of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') failures.push(`${relative}: service_role JWT`)
    } catch {
      // Not a JWT after all.
    }
  }
}

console.log('check:export')
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`  OK ${REQUIRED.length} required files present; ${scanned} text files scanned, no secrets`)
