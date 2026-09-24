#!/usr/bin/env node
/**
 * Size budgets measured on real build output.
 *
 * Worker bundle: Cloudflare limits a Worker to 64 MiB measured on the
 * *uncompressed* bundle, identical on Workers Free and Workers Paid. There is
 * no compressed size limit (developers.cloudflare.com/workers/platform/limits/,
 * verified 2026-09-22). The number compared here is `Total Upload` from
 * `wrangler deploy --dry-run`, which reports exactly what would be uploaded —
 * not from an estimate. The gzip figure wrangler prints alongside it is
 * informational only and is not gated.
 *
 * Public JavaScript: the plan's target is under 150 KiB gzip of initial hydrated
 * JS on public pages. P00 has no real public page yet, so the figure is reported
 * and compared, but the meaningful measurement arrives with P01.
 *
 * Missing build output is a failure, never a pass.
 */
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const WORKER_UPLOAD_LIMIT_BYTES = 64 * 1024 * 1024 // Cloudflare Workers size limit, uncompressed, Free and Paid alike
const PUBLIC_JS_GZIP_BUDGET_BYTES = 150 * 1024

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

const workerPath = path.join(repoRoot, '.open-next', 'worker.js')
if (!existsSync(workerPath)) {
  console.error('No Worker build found at .open-next/worker.js. Run `pnpm build:worker` first.')
  process.exit(1)
}

const dryRun = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', '.wrangler/budget-dry-run'],
  { cwd: repoRoot, encoding: 'utf8' },
)

const dryRunOutput = `${dryRun.stdout ?? ''}${dryRun.stderr ?? ''}`
if (dryRun.status !== 0) {
  console.error('wrangler deploy --dry-run failed:')
  console.error(dryRunOutput)
  process.exit(1)
}

const gzipMatch = dryRunOutput.match(/gzip:\s*([\d.]+)\s*(KiB|MiB)/i)
if (!gzipMatch) {
  console.error('Could not read the compressed Worker size from wrangler output:')
  console.error(dryRunOutput)
  process.exit(1)
}

const workerGzipBytes =
  parseFloat(gzipMatch[1]) * (gzipMatch[2].toLowerCase() === 'mib' ? 1024 * 1024 : 1024)

const totalMatch = dryRunOutput.match(/Total Upload:\s*([\d.]+)\s*(KiB|MiB)/i)
if (!totalMatch) {
  console.error('Could not read the uncompressed Worker upload size from wrangler output:')
  console.error(dryRunOutput)
  process.exit(1)
}

const workerRawBytes =
  parseFloat(totalMatch[1]) * (totalMatch[2].toLowerCase() === 'mib' ? 1024 * 1024 : 1024)

// Initial public JavaScript: gzip of only the chunks the built public homepage
// (.next/server/app/index.html) actually <script src> references — not every
// chunk under .next/static/chunks (that sum includes bundles other public
// pages need that a visitor to this page never downloads). The legacy
// `nomodule` polyfill script, if present, is excluded: modern browsers never
// fetch it.
const homepagePath = path.join(repoRoot, '.next', 'server', 'app', 'index.html')
if (!existsSync(homepagePath)) {
  console.error(
    `No built homepage found at ${path.relative(repoRoot, homepagePath)}. Cannot measure public JS — run the build first.`,
  )
  process.exit(1)
}
const homepageHtml = readFileSync(homepagePath, 'utf8')
const scriptTagRe = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi
let publicJsGzipBytes = 0
let scriptCount = 0
let polyfillSkipped = 0
const chunkDir = path.join(repoRoot, '.next', 'static', 'chunks')
let match
while ((match = scriptTagRe.exec(homepageHtml))) {
  const [tag, src] = match
  const chunkMatch = src.match(/\/_next\/static\/chunks\/(.+\.js)$/)
  if (!chunkMatch) continue
  if (/\bnoModule=/i.test(tag)) {
    polyfillSkipped += 1
    continue // legacy fallback bundle, never fetched by modern browsers
  }
  const chunkFile = path.join(chunkDir, chunkMatch[1])
  if (!existsSync(chunkFile)) {
    console.error(`Homepage references chunk ${chunkMatch[1]} but it is missing on disk at ${chunkFile}.`)
    process.exit(1)
  }
  publicJsGzipBytes += gzipSync(readFileSync(chunkFile)).length
  scriptCount += 1
}

const failures = []
if (workerRawBytes > WORKER_UPLOAD_LIMIT_BYTES) {
  failures.push(
    `Worker bundle ${kib(workerRawBytes)} uncompressed exceeds the Cloudflare Workers size limit of ${kib(WORKER_UPLOAD_LIMIT_BYTES)}.`,
  )
}
if (publicJsGzipBytes > PUBLIC_JS_GZIP_BUDGET_BYTES) {
  failures.push(
    `Shared public JS ${kib(publicJsGzipBytes)} gzip exceeds the ${kib(PUBLIC_JS_GZIP_BUDGET_BYTES)} budget.`,
  )
}

console.log('check:budgets')
console.log(`  worker upload:        ${kib(workerRawBytes)}  (limit ${kib(WORKER_UPLOAD_LIMIT_BYTES)})`)
console.log(`  worker gzip (info):    ${kib(workerGzipBytes)}  (no Cloudflare limit; informational)`)
console.log(
  `  public JS gzip:        ${kib(publicJsGzipBytes)}  (budget ${kib(PUBLIC_JS_GZIP_BUDGET_BYTES)}, ${scriptCount} homepage scripts, ${polyfillSkipped} nomodule polyfill excluded)`,
)

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}
