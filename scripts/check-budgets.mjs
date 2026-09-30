#!/usr/bin/env node
/**
 * Size budgets measured on real build output (D32: the static export in
 * `out/`, served by Cloudflare Pages; there is no Worker bundle any more).
 *
 * Public JavaScript: the plan's target is under 150 KiB gzip of the initial
 * JavaScript a visitor downloads. Measured per built public room page: the
 * gzip of exactly the chunks its HTML `<script src>` references (the legacy
 * `nomodule` polyfill, if present, is excluded: modern browsers never fetch
 * it). The largest page is the one gated.
 *
 * Missing build output is a failure, never a pass.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, 'out')

const PUBLIC_JS_GZIP_BUDGET_BYTES = 150 * 1024
// Every public page in the export, at any depth — an allowlist, or a
// top-level-only scan, would let a new page (a journal post, a product)
// silently escape the budget. The admin (`admin.html` and `admin/**`) is
// excluded: it is the staff-only CMS client (Supabase, Lexical, cropping),
// 230–440 KiB gzip at D32, and no visitor ever loads it.
function publicPages(dir, prefix = '') {
  const pages = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`
    if (entry.name.startsWith('_') || relative === 'admin' || relative === 'admin.html') continue
    if (entry.isDirectory()) pages.push(...publicPages(path.join(dir, entry.name), `${relative}/`))
    else if (entry.name.endsWith('.html')) pages.push(relative)
  }
  return pages.sort()
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

if (!existsSync(outDir)) {
  console.error('No static export found at out/. Run `pnpm build` first.')
  process.exit(1)
}

const PUBLIC_PAGES = publicPages(outDir)
if (PUBLIC_PAGES.length === 0) {
  console.error('out/ holds no public page (a partial export?). Run `pnpm build` first.')
  process.exit(1)
}

const scriptTagRe = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi
const results = []
for (const page of PUBLIC_PAGES) {
  const htmlPath = path.join(outDir, page)
  if (!existsSync(htmlPath)) {
    console.error(`Built page ${page} is missing from out/.`)
    process.exit(1)
  }
  const html = readFileSync(htmlPath, 'utf8')
  let bytes = 0
  let scripts = 0
  let match
  while ((match = scriptTagRe.exec(html))) {
    const [tag, src] = match
    if (!src.startsWith('/_next/static/')) continue
    if (/\bnoModule=/i.test(tag)) continue // legacy fallback bundle, never fetched by modern browsers
    const file = path.join(outDir, src.slice(1))
    if (!existsSync(file)) {
      console.error(`${page} references ${src} but it is missing from out/.`)
      process.exit(1)
    }
    bytes += gzipSync(readFileSync(file)).length
    scripts += 1
  }
  results.push({ page, bytes, scripts })
}

console.log('check:budgets')
for (const { page, bytes, scripts } of results) {
  console.log(`  ${page.padEnd(12)} initial JS gzip ${kib(bytes)} (${scripts} scripts)`)
}
const bare = results.filter((r) => r.scripts === 0).map((r) => r.page)
if (bare.length > 0) {
  console.error(`  FAIL no /_next/static/ script found in ${bare.join(', ')}; was the asset path changed?`)
  process.exit(1)
}
const largest = Math.max(...results.map((r) => r.bytes))
if (largest > PUBLIC_JS_GZIP_BUDGET_BYTES) {
  console.error(`  FAIL initial public JS ${kib(largest)} gzip exceeds the ${kib(PUBLIC_JS_GZIP_BUDGET_BYTES)} budget.`)
  process.exit(1)
}
console.log(`  OK largest ${kib(largest)} (budget ${kib(PUBLIC_JS_GZIP_BUDGET_BYTES)})`)
