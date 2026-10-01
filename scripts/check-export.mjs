#!/usr/bin/env node
/**
 * The static export in `out/` (D32) is what Cloudflare Pages serves. This
 * checks that it is complete and that nothing secret was bundled into it:
 *
 * - every public page, the admin shells, `404.html` and `_headers` exist;
 * - no file contains a server-side secret. The patterns match secret values,
 *   not names (supabase-js itself mentions the `sb_secret_` prefix), and
 *   any JWT found is decoded so a `service_role` token is caught whatever
 *   its signature. Matches are reported by file and kind, never by value;
 * - no file name or text names one of the five reels with a child (the
 *   `NN-kid-` ids), which stay out until their guardians consent (AUDIT-1, G4.2);
 * - no page shows the local demo catalog in a build against a non-loopback
 *   Supabase (I40, `scripts/lib/demo-guard.mjs`).
 *
 * Missing build output is a failure, never a pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDemoContent } from './lib/demo-guard.mjs'
import { namesGuardianPendingFilm } from './lib/guardian-guard.mjs'

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
  // P02: the book preview the reader opens (the only PDF the site serves).
  'book/khous-preview.pdf',
  '_headers',
  'admin.html',
  'admin/sign-in.html',
  'admin/preview.html',
  'admin/content/rooms/edit.html',
  'admin/content/posts/edit.html',
  'admin/content/site_settings/edit.html',
  'admin/content/taxonomies/edit.html',
  'admin/content/policies/edit.html',
  'admin/content/scenes/edit.html',
  // Every other admin screen (src/app/(admin)): the index pages of the
  // collections and store tables, and the fixed screens.
  'admin/content.html',
  ...['rooms', 'posts', 'site_settings', 'taxonomies', 'policies', 'scenes'].map((c) => `admin/content/${c}.html`),
  ...['email', 'media', 'security', 'settings', 'stats', 'store', 'team'].map((p) => `admin/${p}.html`),
  ...['coupons', 'customers', 'products', 'shipping-rates'].flatMap((t) => [`admin/store/${t}.html`, `admin/store/${t}/edit.html`]),
  'admin/store/variants/edit.html',
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
  if (!existsSync(path.join(outDir, page))) continue // already recorded as missing
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

const TEXT = /\.(html|txt|js|css|json|map|xml|webmanifest)$|[\\/]_headers$/
let scanned = 0
const built = []
for (const file of files(outDir)) {
  const relative = path.relative(outDir, file)
  if (namesGuardianPendingFilm(relative)) failures.push(`${relative}: a film with a child, before guardian consent (G4.2)`)
  if (!TEXT.test(file)) continue
  scanned += 1
  const text = readFileSync(file, 'utf8')
  if (namesGuardianPendingFilm(text)) failures.push(`${relative}: names a film with a child, before guardian consent (G4.2)`)
  if (/\.(html|js)$/.test(file)) built.push({ path: relative.split(path.sep).join('/'), text })
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
const demo = checkDemoContent(built)
if (!demo.ok) failures.push(demo.message)

console.log('check:export')
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`  OK ${REQUIRED.length} required files present; ${scanned} text files scanned, no secrets`)
console.log(`  OK ${demo.message}`)
console.log('  OK no file or text names a film with a child (G4.2)')
