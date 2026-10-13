#!/usr/bin/env node
// Screenshot harness for the anas.studio admin: every admin screen in a real
// browser with its Supabase calls answered by mock data. See README.md.
//
//   node harness/shoot.mjs --site <dir> --label <label> [--only home,orders*] [--widths 360,1440]
//
// It starts `next dev` in <dir> (own dist folder, own port), runs one Playwright
// Chromium over the screens, writes shots/<label>/<screen>-<width>.png and
// report.json, and stops the dev server again.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { buildData } from './lib/data.mjs'
import { createMock } from './lib/mock.mjs'
import { buildScreens } from './lib/screens.mjs'
import { NOW_DEFAULT, sleep } from './lib/util.mjs'
import { buildWorld } from './lib/world.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
const { values: args } = parseArgs({
  options: {
    site: { type: 'string' },
    label: { type: 'string', default: 'run' },
    only: { type: 'string' },
    widths: { type: 'string', default: '360,1440' },
    port: { type: 'string', default: '3210' },
    out: { type: 'string' },
    now: { type: 'string', default: NOW_DEFAULT },
    reuse: { type: 'boolean', default: false },
    'server-timeout': { type: 'string', default: '90' },
    'no-slices': { type: 'boolean', default: false },
    chromium: { type: 'string' },
    'ui-lang': { type: 'string', default: 'en-US' },
    env: { type: 'string', multiple: true },
    list: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    lenient: { type: 'boolean', default: false },
    eval: { type: 'string' },
    scrollbars: { type: 'boolean', default: false },
    height: { type: 'string' },
    delay: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
})

if (args.help) {
  console.log('node harness/shoot.mjs --site <dir> [--label before] [--only a,b*] [--widths 360,1440] [--port 3210] [--out <dir>] [--now <iso>] [--reuse] [--no-slices] [--chromium <path>] [--ui-lang ar] [--env KEY=VALUE] [--strict] [--lenient] [--eval '<js>'] [--scrollbars] [--height <px>] [--delay <ms>] [--list]')
  process.exit(0)
}

const siteDir = path.resolve(args.site ?? path.join(harnessDir, '..', 'site'))
const outDir = path.resolve(args.out ?? path.join(harnessDir, '..'))
const port = Number(args.port)
const base = `http://localhost:${port}`
const widths = args.widths.split(',').map((w) => Number(w.trim())).filter(Boolean)
const nowMs = Date.parse(args.now)
if (Number.isNaN(nowMs)) throw new Error(`--now is not a date: ${args.now}`)
const shotsDir = path.join(outDir, 'shots', args.label)
const slicesDir = path.join(shotsDir, 'slices')

// ------------------------------------------------------------------ the data
const data = buildData({ now: nowMs, siteDir })
let screens = buildScreens(data)
if (args.only) {
  const wanted = args.only.split(',').map((s) => s.trim()).filter(Boolean)
  const test = (id) => wanted.some((w) => (w.endsWith('*') ? id.startsWith(w.slice(0, -1)) : id === w))
  screens = screens.filter((screen) => test(screen.id))
}
if (args.list) {
  for (const screen of buildScreens(data)) console.log(`${screen.id.padEnd(34)} ${(screen.role ?? 'owner').padEnd(11)} ${screen.path}`)
  process.exit(0)
}
if (screens.length === 0) throw new Error(`no screen matches --only ${args.only}`)

// ---------------------------------------------------------- site and browser
if (!existsSync(path.join(siteDir, 'package.json'))) throw new Error(`${siteDir} is not a site copy (no package.json)`)
const nextBin = path.join(siteDir, 'node_modules', 'next', 'dist', 'bin', 'next')
if (!existsSync(nextBin)) throw new Error(`${siteDir} has no node_modules; run: pnpm install --frozen-lockfile`)
const siteRequire = createRequire(path.join(siteDir, 'package.json'))
const chromium = (() => {
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    try {
      const found = siteRequire(name).chromium
      if (found) return found
    } catch {
      // try the next package
    }
  }
  throw new Error(`Playwright is not installed in ${siteDir}; run: pnpm install --frozen-lockfile`)
})()
let sharp = null
try {
  sharp = siteRequire('sharp')
} catch {
  console.warn('sharp is not installed in the site: tall pages are not sliced or stitched.')
}

function findChromium() {
  if (args.chromium) return args.chromium
  if (process.env.HARNESS_CHROMIUM) return process.env.HARNESS_CHROMIUM
  try {
    if (existsSync(chromium.executablePath())) return undefined
  } catch {
    // fall through to the browsers folder
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (root && existsSync(root)) {
    if (existsSync(path.join(root, 'chromium'))) return path.join(root, 'chromium')
    for (const name of readdirSync(root).sort().reverse()) {
      const candidate = path.join(root, name, 'chrome-linux', 'chrome')
      if (name.startsWith('chromium-') && existsSync(candidate)) return candidate
    }
  }
  return undefined
}

// ----------------------------------------------------------------- dev server
const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://mock.supabase.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  NEXT_DIST_DIR: '.next/harness',
  NEXT_TELEMETRY_DISABLED: '1',
  ...Object.fromEntries((args.env ?? []).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])),
}
const storageKey = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
let server = null

async function ping(url, ms) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'manual' })
    return response.status
  } catch {
    return null
  }
}

async function startServer() {
  const status = await ping(`${base}/`, 1500)
  if (args.reuse) {
    if (status === null) throw new Error(`--reuse: nothing answers on ${base}`)
    console.log(`reusing the server on ${base}`)
    return
  }
  if (status !== null) throw new Error(`port ${port} already answers (${status}); stop that server, pass --port, or pass --reuse`)
  mkdirSync(outDir, { recursive: true })
  const logFile = path.join(outDir, 'harness', 'dev-server.log')
  mkdirSync(path.dirname(logFile), { recursive: true })
  const log = openSync(logFile, 'w')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(port)], {
    cwd: siteDir,
    env: { ...process.env, ...publicEnv },
    stdio: ['ignore', log, log],
    detached: true,
  })
  server.unref()
  let exited = false
  server.on('exit', () => (exited = true))
  const deadline = Date.now() + Number(args['server-timeout']) * 1000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`next dev exited early; see ${logFile}`)
    const code = await ping(`${base}/admin/sign-in`, 30_000)
    if (code !== null && code < 500) {
      console.log(`dev server ready on ${base} (log: ${logFile})`)
      return
    }
    await sleep(1000)
  }
  throw new Error(`next dev was not ready after ${args['server-timeout']}s; see ${logFile}`)
}

async function stopServer() {
  if (!server || server.pid === undefined) return
  const pid = server.pid
  server = null
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  for (let i = 0; i < 50; i++) {
    await sleep(100)
    try {
      process.kill(-pid, 0)
    } catch {
      return
    }
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // already gone
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stopServer().finally(() => process.exit(130))
  })
}

// -------------------------------------------------------------- one screenshot
const SUSPECT_PHRASES = ['تعذّر', 'لا تملك صلاحية', 'هذه الصفحة للمالك فقط', 'هناك مشاكل في البيانات', 'سجّل الدخول أولًا', 'غير موجود', 'لا توجد مسودة']
/** A stand-in for Cloudflare's widget: a 300x65 box that "solves" itself and calls the page's onload. */
const FAKE_TURNSTILE = `(() => {
  window.turnstile = {
    render(el, options) {
      el.innerHTML = '<div style="box-sizing:border-box;width:300px;height:65px;display:flex;align-items:center;gap:12px;padding:0 14px;border:1px solid #e0e0e0;border-radius:3px;background:#fafafa;color:#333;font:14px system-ui,sans-serif;direction:ltr"><span style="width:24px;height:24px;border:2px solid #c3c3c3;border-radius:2px;background:#fff"></span><span>Success!</span><span style="margin-left:auto;color:#777;font-size:9px;line-height:1.3">CLOUDFLARE<br>Privacy - Terms</span></div>'
      setTimeout(() => options.callback && options.callback('mock-turnstile-token'), 30)
      return 'mock-widget'
    },
    reset() {},
    remove() {},
  }
  if (typeof window.__anasaqTurnstileOnload === 'function') window.__anasaqTurnstileOnload()
})()`
const HIDE_DEV_UI = 'nextjs-portal, [data-nextjs-toast], [data-next-badge-root], #__next-build-watcher { display: none !important; }'

const serializeMatcher = (m) => (m instanceof RegExp ? { r: m.source, f: m.flags } : m === null || m === undefined ? null : { s: String(m) })

/** The mocked-call signature of a served entry, as `screens.mjs` writes them. */
const keyOf = (entry) => `${entry.kind}:${entry.name}`

async function until(check, timeoutMs, stepMs = 40) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(stepMs)
  }
  return false
}

function pageReady({ h1, gate, waitText, waitSelector }) {
  const text = document.body ? document.body.innerText : ''
  if (text.includes('يحمّل')) return false
  const matches = (value) => (h1.s !== undefined ? value.includes(h1.s) : new RegExp(h1.r, h1.f).test(value))
  if (h1) {
    if (![...document.querySelectorAll('h1')].some((el) => matches(el.textContent ?? ''))) return false
  } else if (gate && !text.includes(gate)) return false
  if (waitText && !text.includes(waitText)) return false
  if (waitSelector && !document.querySelector(waitSelector)) return false
  return text.trim().length > 12
}

async function capture(page, file, height) {
  // Chromium refuses captures taller than 16384px: tall pages are shot in bands and stitched.
  const BAND = 8000
  if (height <= 15000 || !sharp) {
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' })
    return
  }
  // The capture is as wide as the page's scrollable overflow, which can exceed the viewport.
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth))
  const parts = []
  for (let top = 0; top < height; top += BAND) {
    const clip = { x: 0, y: top, width, height: Math.min(BAND, height - top) }
    parts.push({ input: await page.screenshot({ fullPage: true, clip, animations: 'disabled', caret: 'hide' }), top, left: 0 })
  }
  await sharp({ create: { width, height, channels: 4, background: '#ffffff' } }).composite(parts).png().toFile(file)
}

async function slice(file, viewportWidth, pageHeight, name) {
  if (!sharp || args['no-slices']) return 0
  // A page that overflows sideways is captured wider than the viewport: slice the whole picture.
  const width = (await sharp(file).metadata()).width
  const size = viewportWidth <= 600 ? 1500 : 1000
  if (pageHeight <= size * 1.25) return 0
  mkdirSync(slicesDir, { recursive: true })
  for (const old of readdirSync(slicesDir)) if (old.startsWith(`${name}.`)) rmSync(path.join(slicesDir, old))
  let count = 0
  for (let top = 0; top < pageHeight; top += size) {
    const n = String(count + 1).padStart(2, '0')
    await sharp(file).extract({ left: 0, top, width, height: Math.min(size, pageHeight - top) }).toFile(path.join(slicesDir, `${name}.${n}.png`))
    count += 1
  }
  return count
}

async function shootOne(browser, screen, width) {
  const started = Date.now()
  const role = screen.role ?? 'owner'
  const world = buildWorld(data, { role, scenario: screen.scenario ?? {} })
  const mock = createMock({ world, now: nowMs })
  const context = await browser.newContext({
    viewport: { width, height: args.height ? Number(args.height) : width < 800 ? 800 : 900 },
    deviceScaleFactor: 1,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const blockedExternal = new Set()
  const result = {
    screen: screen.id,
    width,
    role,
    url: `${base}${screen.path}`,
    note: screen.note ?? '',
    settled: false,
    problems: [],
    consoleErrors: [],
    pageErrors: [],
    unmocked: [],
    blockedExternal: [],
    badResponses: [],
    overflowPx: null,
    offenders: [],
    pageHeight: null,
    flags: [],
    file: null,
    slices: 0,
  }
  try {
    await context.clock.setFixedTime(new Date(nowMs))
    if (!screen.signedOut) {
      await context.addInitScript(
        ({ key, session }) => {
          try {
            window.localStorage.setItem(key, JSON.stringify(session))
          } catch {
            // storage blocked: the shell will send the page to the sign-in
          }
        },
        { key: storageKey, session: world.session() },
      )
    }
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === base) return route.continue()
      if (url.hostname === 'mock.supabase.invalid') return mock.handle(route)
      if (url.hostname === 'challenges.cloudflare.com') {
        // Empty by default: Turnstile cannot load here. A screen can ask for a placeholder widget instead.
        return route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: screen.fakeTurnstile ? FAKE_TURNSTILE : '' })
      }
      blockedExternal.add(url.host)
      return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    const knownUnmocked = () => mock.unmocked.map((entry) => entry.url)
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      const where = message.location().url ?? ''
      let tag = 'app'
      if (/ERR_BLOCKED_BY_CLIENT/.test(text)) tag = 'blocked-external'
      else if (/status of 501/.test(text) || knownUnmocked().some((u) => where.includes(u.split('?')[0]))) tag = 'unmocked'
      else if ((screen.expectConsole ?? []).some((re) => re.test(text))) tag = 'expected'
      result.consoleErrors.push({ tag, text: text.slice(0, 4000), url: where.slice(0, 200) })
    })
    page.on('pageerror', (error) => result.pageErrors.push(String(error.stack ?? error).slice(0, 800)))
    page.on('response', (response) => {
      const url = response.url()
      if (response.status() >= 400 && url.startsWith(base)) result.badResponses.push(`${response.status()} ${url.slice(base.length)}`)
    })

    const settle = async (extraCalls = []) => {
      const need = [...(screen.calls ?? []), ...extraCalls]
      const missing = () => need.filter((sig) => !mock.served.some((entry) => keyOf(entry) === sig))
      if (!(await until(() => missing().length === 0, 45_000))) result.problems.push(`calls never made: ${missing().join(', ')}`)
      await until(() => mock.state.inflight === 0 && Date.now() - mock.state.lastActivity > 500, 20_000)
      try {
        await page.waitForFunction(
          pageReady,
          args.lenient
            ? { h1: null, gate: null, waitText: null, waitSelector: null }
            : { h1: serializeMatcher(screen.h1), gate: (screen.allowText ?? [])[0] ?? null, waitText: screen.waitText ?? null, waitSelector: screen.waitSelector ?? null },
          { timeout: 30_000, polling: 100 },
        )
      } catch {
        result.problems.push(`page not ready: ${screen.h1 ? `heading ${screen.h1}` : 'gate text'}${screen.waitText ? `, text "${screen.waitText}"` : ''}${screen.waitSelector ? `, selector ${screen.waitSelector}` : ''}`)
        return false
      }
      // Pictures and fonts: lazy images load now, and the shot waits for them.
      await page.evaluate(async () => {
        const images = [...document.images]
        for (const image of images) if (image.loading === 'lazy') image.loading = 'eager'
        await Promise.all(
          images.map((image) =>
            image.complete
              ? null
              : new Promise((resolve) => {
                  image.addEventListener('load', resolve, { once: true })
                  image.addEventListener('error', resolve, { once: true })
                  setTimeout(resolve, 8000)
                }),
          ),
        )
        await document.fonts.ready
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      await until(() => mock.state.inflight === 0 && Date.now() - mock.state.lastActivity > 300, 10_000)
      return true
    }

    await page.goto(`${base}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    let settled = await settle()
    if (settled && screen.steps) {
      try {
        await screen.steps({ page, mock, settle })
        settled = await settle()
      } catch (error) {
        settled = false
        result.problems.push(`step failed: ${String(error.message ?? error).split('\n')[0]}`)
      }
    }
    result.settled = settled
    // --delay: a wait after the settle, before the eval and the shot (a dialog's backdrop can hold back the paint of
    // what lies under it).
    if (args.delay) await sleep(Number(args.delay))

    // --eval: an expression (or function) run in the page once it has settled; its value goes to the report and the log.
    if (args.eval) {
      try {
        result.eval = await page.evaluate(args.eval)
      } catch (error) {
        result.eval = `eval failed: ${String(error.message ?? error).split('\n')[0]}`
      }
      console.log(`eval ${screen.id}@${width}: ${JSON.stringify(result.eval)}`)
    }

    // What the page looks like, and what is wrong with it.
    await page.addStyleTag({ content: HIDE_DEV_UI })
    await page.evaluate(() => window.scrollTo(0, 0))
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement
      const overflow = doc.scrollWidth - window.innerWidth
      const offenders = []
      if (overflow > 0) {
        for (const el of document.body.querySelectorAll('*')) {
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || (rect.right <= window.innerWidth + 1 && rect.left >= -1)) continue
          const cls = typeof el.className === 'string' ? el.className.split(' ').map((c) => c.replace(/^.*__([^_]+)__.*$/, '$1')).filter(Boolean).slice(0, 2).join('.') : ''
          offenders.push({ el: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), text: (el.textContent ?? '').trim().slice(0, 40) })
        }
        offenders.sort((a, b) => b.width - a.width)
      }
      return { overflow, offenders: offenders.slice(0, 5), height: doc.scrollHeight, text: document.body.innerText }
    })
    result.overflowPx = metrics.overflow
    result.offenders = metrics.offenders
    result.pageHeight = metrics.height
    const allowed = screen.allowText ?? []
    result.flags = SUSPECT_PHRASES.filter((phrase) => metrics.text.includes(phrase) && !allowed.some((a) => a.includes(phrase) || phrase.includes(a)))

    mkdirSync(shotsDir, { recursive: true })
    const name = `${screen.id}-${width}`
    const file = path.join(shotsDir, `${name}.png`)
    if (screen.viewportOnly) await page.screenshot({ path: file, fullPage: false, animations: 'disabled', caret: 'hide' })
    else await capture(page, file, metrics.height)
    result.file = path.relative(outDir, file)
    result.imageWidth = sharp ? (await sharp(file).metadata()).width : null
    result.slices = screen.viewportOnly ? 0 : await slice(file, width, metrics.height, name)
  } catch (error) {
    result.problems.push(`error: ${String(error.message ?? error).split('\n')[0]}`)
  } finally {
    result.unmocked = mock.unmocked.map((entry) => `${entry.method} ${entry.url} (${entry.reason})`)
    result.blockedExternal = [...blockedExternal]
    result.ms = Date.now() - started
    await context.close().catch(() => {})
  }
  return result
}

const results = []

// ----------------------------------------------------------------------- report
// A partial run (--only, --widths) is merged into the report of the same label, so
// re-shooting one screen updates its entry and leaves the others as they were.
const reportFile = path.join(outDir, 'harness', 'report.json')
const labelReport = path.join(shotsDir, 'report.json')
const order = new Map(buildScreens(data).map((screen, index) => [screen.id, index]))

/** Writes report.json (also after every shot, so an interrupted run keeps what it did). */
function writeReport() {
  let merged = results
  if (existsSync(labelReport)) {
    try {
      const previous = JSON.parse(readFileSync(labelReport, 'utf8'))
      const fresh = new Set(results.map((r) => `${r.screen}@${r.width}`))
      // A whole run replaces the widths it shot; a partial one (--only) replaces only its own entries.
      const kept = previous.screens.filter((r) => (args.only ? !fresh.has(`${r.screen}@${r.width}`) : !widths.includes(r.width)))
      merged = [...kept, ...results]
    } catch {
      merged = results
    }
  }
  merged.sort((a, b) => a.width - b.width || (order.get(a.screen) ?? 999) - (order.get(b.screen) ?? 999))
  const unmockedAll = [...new Set(merged.flatMap((r) => r.unmocked))]
  const report = {
    label: args.label,
    site: siteDir,
    generatedAt: new Date().toISOString(),
    clock: new Date(nowMs).toISOString(),
    browser: browserVersion,
    lenient: args.lenient,
    widths: [...new Set(merged.map((r) => r.width))],
    summary: {
      shots: merged.length,
      settled: merged.filter((r) => r.settled).length,
      notSettled: merged.filter((r) => !r.settled).map((r) => `${r.screen}@${r.width}`),
      withAppConsoleErrors: merged.filter((r) => r.consoleErrors.some((e) => e.tag === 'app')).map((r) => `${r.screen}@${r.width}`),
      withPageErrors: merged.filter((r) => r.pageErrors.length > 0).map((r) => `${r.screen}@${r.width}`),
      withFlags: merged.filter((r) => r.flags.length > 0).map((r) => `${r.screen}@${r.width}: ${r.flags.join(' | ')}`),
      withOverflow: merged.filter((r) => (r.overflowPx ?? 0) > 0).map((r) => `${r.screen}@${r.width}: ${r.overflowPx}px`),
      unmockedCalls: unmockedAll,
    },
    screens: merged,
  }
  mkdirSync(path.join(outDir, 'harness'), { recursive: true })
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
  mkdirSync(shotsDir, { recursive: true })
  copyFileSync(reportFile, labelReport)
  return report
}

// ------------------------------------------------------------------------ run
let browser = null
let browserVersion = null
try {
  await startServer()
  // The browser's own language (native date and file inputs): en-US unless asked. With --ui-lang ar Chromium draws the date fields' placeholders letter-reversed.
  // --scrollbars draws classic scrollbars, as Windows does (headless Chromium hides them by default).
  browser = await chromium.launch({ ...(args.scrollbars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}), executablePath: findChromium(), args: [`--lang=${args['ui-lang']}`], env: { ...process.env, LANGUAGE: args['ui-lang'] } })
  browserVersion = `Chromium ${browser.version()}`
  for (const width of widths) {
    for (const screen of screens) {
      const result = await shootOne(browser, screen, width)
      results.push(result)
      writeReport()
      const appErrors = result.consoleErrors.filter((e) => e.tag === 'app').length
      console.log(
        `${result.settled ? 'ok  ' : 'FAIL'} ${screen.id.padEnd(32)} ${String(width).padStart(4)}  overflow ${String(result.overflowPx).padStart(4)}px  console ${appErrors}  page ${result.pageErrors.length}  unmocked ${result.unmocked.length}${result.flags.length ? `  flags ${result.flags.join('|')}` : ''}${result.problems.length ? `  ! ${result.problems.join('; ')}` : ''}`,
      )
    }
  }
} finally {
  await browser?.close().catch(() => {})
  await stopServer()
  console.log('dev server stopped')
}

const report = writeReport()
console.log(`report: ${reportFile}`)
console.log(`${report.summary.settled}/${report.summary.shots} settled; ${report.summary.unmockedCalls.length} distinct unmocked calls`)
process.exit(args.strict && report.summary.notSettled.length > 0 ? 1 : 0)
