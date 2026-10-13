// The admin shell's dynamic cases, which the harness's one-shot --eval cannot reach: a resize across the rail's
// breakpoint (1280px), client-side navigation, a role change, real Tab presses, a slow web font, short laptop heights,
// classic scrollbars, the skip link and the sign-out. Written by the D49 re-auditor (Claude Opus 5.5, 2026-10-13) and
// kept as evidence. It reuses the harness's mock (data, world, mock) and starts `next dev` in a copy of the site
// exactly as shoot.mjs does (port 3210); never point it at a working tree you are editing. Writes only to <outDir>.
//   node driver.mjs <siteDir> <outDir> [test,...]
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const H = new URL('../harness/lib', import.meta.url).pathname
const { buildData } = await import(`${H}/data.mjs`)
const { createMock } = await import(`${H}/mock.mjs`)
const { buildScreens } = await import(`${H}/screens.mjs`)
const { NOW_DEFAULT, sleep } = await import(`${H}/util.mjs`)
const { buildWorld } = await import(`${H}/world.mjs`)

const [siteDir, outDir, onlyArg] = process.argv.slice(2)
const only = onlyArg ? onlyArg.split(',') : null
mkdirSync(outDir, { recursive: true })
const port = 3210
const base = `http://localhost:${port}`
const nowMs = Date.parse(NOW_DEFAULT)
const data = buildData({ now: nowMs, siteDir })
const screens = new Map(buildScreens(data).map((s) => [s.id, s]))
const siteRequire = createRequire(path.join(siteDir, 'package.json'))
const { chromium } = siteRequire('@playwright/test')
const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://mock.supabase.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  NEXT_DIST_DIR: '.next/harness',
  NEXT_TELEMETRY_DISABLED: '1',
}
const storageKey = 'sb-mock-auth-token'
const ping = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' })).status } catch { return null } }

const log = openSync(path.join(outDir, 'dev-server.log'), 'w')
const server = spawn(process.execPath, [path.join(siteDir, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(port)], { cwd: siteDir, env: { ...process.env, ...publicEnv }, stdio: ['ignore', log, log], detached: true })
server.unref()
const stop = () => { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
process.on('exit', stop)
for (let i = 0; i < 120; i++) { const c = await ping(`${base}/admin/sign-in`); if (c !== null && c < 500) break; await sleep(1000) }

// As shoot.mjs's findChromium: Playwright's own browser if present, else $PLAYWRIGHT_BROWSERS_PATH/chromium.
let executablePath
try { if (!(await import('node:fs')).existsSync(chromium.executablePath())) executablePath = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers', 'chromium') } catch { executablePath = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers', 'chromium') }
const browser = await chromium.launch({ executablePath, args: ['--lang=en-US'], env: { ...process.env, LANGUAGE: 'en-US' } })
const results = {}

async function open(screenId, viewport, { role, routes, contextOptions } = {}) {
  const screen = screens.get(screenId)
  const world = buildWorld(data, { role: role ?? screen.role ?? 'owner', scenario: screen.scenario ?? {} })
  const mock = createMock({ world, now: nowMs })
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', ...(contextOptions ?? {}) })
  await context.clock.setFixedTime(new Date(nowMs))
  await context.addInitScript(({ key, session }) => { try { localStorage.setItem(key, JSON.stringify(session)) } catch {} }, { key: storageKey, session: world.session() })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    if (url.hostname === 'mock.supabase.invalid') return mock.handle(route)
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript' }, body: '' })
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
  if (routes) await routes(page, context, mock)
  await page.goto(`${base}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.locator('nav[aria-label="لوحة التحكم"]').waitFor({ timeout: 60000 })
  if (screen.h1 && typeof screen.h1 === 'string') await page.locator('h1', { hasText: screen.h1 }).first().waitFor({ timeout: 60000 }).catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes('يحمّل'), null, { timeout: 30000 }).catch(() => {})
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })
  await sleep(300)
  return { page, context, errors, mock }
}

// The strip or the rail, measured as the user sees it.
const MEASURE = async () => {
  const R = (el) => el.getBoundingClientRect()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 50))
  const nav = document.querySelector('nav[aria-label="لوحة التحكم"]')
  if (!nav) return { nav: false }
  const controls = [...nav.querySelectorAll('a, button')]
  const b = R(nav)
  const port = { left: b.left + nav.clientLeft, right: b.left + nav.clientLeft + nav.clientWidth }
  const ratio = (el) => { const r = R(el); const w = Math.max(0, Math.min(r.right, port.right) - Math.max(r.left, port.left)); return r.width ? w / r.width : 0 }
  const strip = getComputedStyle(nav).overflowX !== 'visible'
  const cur = nav.querySelector('[aria-current="page"]')
  const flags = [nav.hasAttribute('data-more-start'), nav.hasAttribute('data-more-end')]
  const out = { w: innerWidth, mode: strip ? 'strip' : 'rail', links: controls.map((c) => c.textContent.trim()).join(' '), over: nav.scrollWidth - nav.clientWidth, scrollLeft: Math.round(nav.scrollLeft), flags: flags.map(Number).join(''), geo: strip ? [ratio(controls[0]) < 0.99, ratio(controls[controls.length - 1]) < 0.99].map(Number).join('') : 'n/a', mask: getComputedStyle(nav).maskImage !== 'none', pageScroll: [Math.round(scrollX), Math.round(scrollY)], docOverflow: document.documentElement.scrollWidth - innerWidth }
  if (cur) {
    const r = R(cur)
    out.current = cur.textContent.trim()
    if (strip) {
      out.curIn = r.left >= port.left - 0.5 && r.right <= port.right + 0.5
      out.curVisibleShare = Math.round(ratio(cur) * 100)
      out.curClearOfFade = (!flags[1] || r.left >= port.left + 40 - 0.5) && (!flags[0] || r.right <= port.right - 40 + 0.5)
      out.curGap = [Math.round(r.left - port.left), Math.round(port.right - r.right)]
    }
  }
  return out
}

const tests = {
  // Rail to strip and back (a window narrowed past 1280px, a tablet turned to portrait).
  async resize() {
    const out = {}
    for (const id of ['team', 'settings', 'home']) {
      const { page, context, errors } = await open(id, { width: 1440, height: 900 })
      const steps = []
      steps.push(['1440 load', await page.evaluate(MEASURE)])
      await page.setViewportSize({ width: 800, height: 900 }); await sleep(400)
      steps.push(['-> 800', await page.evaluate(MEASURE)])
      await page.setViewportSize({ width: 360, height: 800 }); await sleep(400)
      steps.push(['-> 360', await page.evaluate(MEASURE)])
      await page.setViewportSize({ width: 1440, height: 900 }); await sleep(400)
      steps.push(['-> 1440', await page.evaluate(MEASURE)])
      await page.setViewportSize({ width: 768, height: 1024 }); await sleep(400)
      steps.push(['-> 768x1024', await page.evaluate(MEASURE)])
      await page.screenshot({ path: path.join(outDir, `resize-${id}-768.png`), clip: { x: 0, y: 0, width: 768, height: 200 } })
      out[id] = { steps, errors }
      await context.close()
    }
    // and the other way: a phone load, then wide, then a phone again
    const { page, context, errors } = await open('team', { width: 360, height: 800 })
    const steps = [['360 load', await page.evaluate(MEASURE)]]
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(400)
    steps.push(['-> 1440', await page.evaluate(MEASURE)])
    await page.setViewportSize({ width: 360, height: 800 }); await sleep(400)
    steps.push(['-> 360', await page.evaluate(MEASURE)])
    out['team-from-phone'] = { steps, errors }
    await context.close()
    return out
  },

  // Client-side navigation: the strip follows the route.
  async navigate() {
    const { page, context, errors } = await open('home', { width: 360, height: 800 })
    const steps = [['/admin load', await page.evaluate(MEASURE)]]
    await page.locator('nav').getByRole('link', { name: 'الفريق' }).click()
    await page.waitForURL(/\/admin\/team$/); await page.locator('h1', { hasText: 'الفريق' }).first().waitFor().catch(() => {}); await sleep(500)
    steps.push(['nav click -> team', await page.evaluate(MEASURE)])
    await page.goBack(); await page.waitForURL(/\/admin$/); await sleep(800)
    steps.push(['back -> /admin', await page.evaluate(MEASURE)])
    await page.getByRole('link', { name: 'فتح الإحصاءات' }).click()
    await page.waitForURL(/\/admin\/stats$/); await sleep(800)
    steps.push(['main link -> stats', await page.evaluate(MEASURE)])
    await page.locator('nav').getByRole('link', { name: 'المحتوى' }).click()
    await page.waitForURL(/\/admin\/content$/); await sleep(800)
    steps.push(['nav click -> content', await page.evaluate(MEASURE)])
    // a screen under an entry: content -> a collection, the current link stays
    await page.locator('main a').first().click(); await sleep(1200)
    steps.push([`main link -> ${new URL(page.url()).pathname}`, await page.evaluate(MEASURE)])
    await context.close()
    return { steps, errors }
  },

  // A role change while the screen is open (auth-js re-emits SIGNED_IN on a tab refocus; the role is read again).
  async role() {
    const out = {}
    for (const [from, to, id] of [['owner', 'editor', 'home'], ['editor', 'owner', 'home-editor'], ['owner', 'operations', 'orders']]) {
      let answer = from
      const { page, context, errors } = await open(id, { width: 360, height: 800 }, {
        role: from,
        routes: async (p) => {
          await p.route('**/rest/v1/rpc/current_staff_role', (route) => {
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' } })
            return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(answer) })
          })
        },
      })
      const steps = [[`${from} load`, await page.evaluate(MEASURE)]]
      // scroll the strip to its far end, as a user might, then the role changes
      await page.evaluate(() => { const n = document.querySelector('nav'); n.scrollLeft = -n.scrollWidth })
      await sleep(300)
      steps.push(['strip at its end', await page.evaluate(MEASURE)])
      answer = to
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
      await page.waitForFunction((t) => { const n = document.querySelector('nav'); return n && n.textContent.includes(t === 'editor' ? 'المحتوى' : 'البريد') && (t !== 'editor' || !n.textContent.includes('البريد')) && (t !== 'operations' || !n.textContent.includes('المحتوى')) }, to, { timeout: 15000 }).catch(() => {})
      await sleep(500)
      steps.push([`-> ${to}`, await page.evaluate(MEASURE)])
      out[`${from}->${to}@${id}`] = { steps, errors }
      await context.close()
    }
    return out
  },

  // Keyboard: Tab through the skip link and the nav, as a keyboard user does; each focused control's ring is measured
  // where the browser left it (the strip scrolls to a focused link by itself).
  async keyboard() {
    const out = {}
    for (const [id, width, height] of [['home', 360, 800], ['team', 360, 800], ['home', 1440, 900], ['settings', 1280, 720]]) {
      const { page, context, errors } = await open(id, { width, height })
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
      await page.mouse.move(5, 5)
      const steps = []
      await page.keyboard.press('Tab')
      for (let i = 0; i < 13; i++) {
        const m = await page.evaluate(async () => {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          await new Promise((r) => setTimeout(r, 60))
          const el = document.activeElement
          if (!el || el === document.body) return null
          const R = (e) => e.getBoundingClientRect()
          const cs = getComputedStyle(el)
          const ext = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)
          const b = R(el)
          const ring = { left: b.left - ext, right: b.right + ext, top: b.top - ext, bottom: b.bottom + ext }
          // the nearest ancestor that clips
          let p = el.parentElement
          while (p && p !== document.body) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') break; p = p.parentElement }
          let clip = ''
          let fade = ''
          if (p && p !== document.body) {
            const pb = R(p)
            const box = { left: pb.left + p.clientLeft, right: pb.left + p.clientLeft + p.clientWidth, top: pb.top + p.clientTop, bottom: pb.top + p.clientTop + p.clientHeight }
            clip = (ring.left < box.left - 0.5 ? 'L' + Math.round(box.left - ring.left) : '') + (ring.right > box.right + 0.5 ? 'R' + Math.round(ring.right - box.right) : '') + (ring.top < box.top - 0.5 ? 'T' + Math.round(box.top - ring.top) : '') + (ring.bottom > box.bottom + 0.5 ? 'B' + Math.round(ring.bottom - box.bottom) : '')
            if (p.tagName === 'NAV' && getComputedStyle(p).maskImage !== 'none') {
              if (p.hasAttribute('data-more-end') && ring.left < box.left + 40) fade += `end:${Math.round(box.left + 40 - ring.left)}px `
              if (p.hasAttribute('data-more-start') && ring.right > box.right - 40) fade += `start:${Math.round(ring.right - (box.right - 40))}px`
            }
          }
          const off = ring.left < 0 || ring.right > innerWidth || ring.top < 0 || ring.bottom > innerHeight
          return `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 18)} ring ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}${el.matches(':focus-visible') ? '' : ' NOT-FOCUS-VISIBLE'}${clip ? ' CLIPPED ' + clip : ''}${fade ? ' FADED ' + fade : ''}${off ? ' OFF-VIEWPORT' : ''} scrollLeft ${Math.round(document.querySelector('nav')?.scrollLeft ?? 0)}`
        })
        steps.push(m)
        if (i === 0 || i === 3 || i === 11) await page.screenshot({ path: path.join(outDir, `kbd-${id}-${width}-${i}.png`), clip: { x: 0, y: 0, width, height: Math.min(height, width < 1280 ? 220 : height) } })
        await page.keyboard.press('Tab')
      }
      out[`${id}@${width}x${height}`] = { steps, errors }
      await context.close()
    }
    return out
  },

  // A cold load: the web fonts arrive after the role (no preload; the shell draws nothing until the role is known),
  // so the strip's one scroll to the current link is computed with the fallback font's widths.
  async fonts() {
    const out = {}
    for (const id of ['team', 'settings', 'security', 'orders', 'store']) {
      for (const delay of [0, 1500]) {
        const { page, context, errors } = await open(id, { width: 360, height: 800 }, {
          routes: async (p, ctx) => {
            if (!delay) return
            await p.route('**/fonts/thmanyah/**', async (route) => { await sleep(delay); return route.continue() })
          },
        })
        await sleep(delay + 500)
        const m = await page.evaluate(MEASURE)
        if (delay) await page.screenshot({ path: path.join(outDir, `fonts-${id}-${delay}.png`), clip: { x: 0, y: 0, width: 360, height: 200 } })
        out[`${id} font delay ${delay}ms`] = { m, errors }
        await context.close()
      }
    }
    return out
  },

  // The rail's height against short laptop viewports (the owner's whole nav).
  async heights() {
    const out = {}
    for (const [w, h] of [[1280, 720], [1366, 657], [1366, 640], [1280, 600], [1024, 768], [1024, 600], [1440, 821], [1440, 900], [1920, 1080]]) {
      const { page, context } = await open('home', { width: w, height: h })
      out[`${w}x${h}`] = await page.evaluate(() => {
        const inner = document.querySelector('header').firstElementChild
        const nav = document.querySelector('nav')
        const so = nav.querySelector('button').getBoundingClientRect()
        return { tallBy: inner.scrollHeight - inner.clientHeight, signOutBottom: Math.round(so.bottom), vh: innerHeight, sideways: inner.scrollWidth - inner.clientWidth }
      })
      await context.close()
    }
    return out
  },

  // The skip link, focused, over the night rail or bar.
  async skip() {
    const out = {}
    for (const [w, h] of [[360, 800], [1440, 900]]) {
      const { page, context } = await open('home', { width: w, height: h })
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('Tab')
      out[w] = await page.evaluate(() => {
        const el = document.activeElement
        const cs = getComputedStyle(el)
        const b = el.getBoundingClientRect()
        const under = document.elementsFromPoint(b.left - 5, b.top + b.height / 2).map((e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0].replace(/^.*__([^_]+)__.*$/, '$1') : '')).slice(0, 3)
        return { text: el.textContent.trim(), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`, bg: cs.backgroundColor, box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], under }
      })
      await page.screenshot({ path: path.join(outDir, `skip-${w}.png`), clip: { x: Math.max(0, w - 400), y: 0, width: Math.min(400, w), height: 120 } })
      await context.close()
    }
    return out
  },

  // The strip's one scroll to the current link, logged with the state of the web fonts at that moment.
  async fonts2() {
    const out = {}
    for (const id of ['team', 'settings', 'security']) {
      for (const delay of [0, 2000]) {
        const { page, context, errors } = await open(id, { width: 360, height: 800 }, {
          routes: async (p) => {
            await p.addInitScript(() => {
              window.__scrolls = []
              const orig = Element.prototype.scrollBy
              Element.prototype.scrollBy = function (...a) {
                window.__scrolls.push({ t: Math.round(performance.now()), tag: this.tagName, arg: JSON.stringify(a[0]), fonts: document.fonts.status, sans: document.fonts.check('500 17px "Thmanyah Sans"') })
                return orig.apply(this, a)
              }
              window.__fontsDone = null
              document.fonts.ready.then(() => { window.__fontsDone = Math.round(performance.now()) })
            })
            if (delay) await p.route('**/fonts/thmanyah/**', async (route) => { await sleep(delay); return route.continue() })
          },
        })
        await sleep(delay + 800)
        const m = await page.evaluate(MEASURE)
        const log = await page.evaluate(() => ({ scrolls: window.__scrolls, fontsDone: window.__fontsDone, fontEntries: performance.getEntriesByType('resource').filter((e) => e.name.includes('/fonts/')).map((e) => `${e.name.split('/').pop()} start ${Math.round(e.startTime)} end ${Math.round(e.responseEnd)}`) }))
        if (delay) await page.screenshot({ path: path.join(outDir, `fonts2-${id}-${delay}.png`), clip: { x: 0, y: 0, width: 360, height: 160 } })
        out[`${id} delay ${delay}`] = { m: `sl${m.scrollLeft} flags${m.flags} cur=${m.current} in=${m.curIn} share=${m.curVisibleShare} clear=${m.curClearOfFade} gap=${m.curGap}`, log, errors }
        await context.close()
      }
    }
    return out
  },

  // The skip link, focused by the keyboard, over the night bar or rail.
  async skip2() {
    const out = {}
    for (const [w, h] of [[360, 800], [1440, 900]]) {
      const { page, context } = await open('home', { width: w, height: h })
      await page.evaluate(() => document.activeElement?.blur())
      let found = null
      for (let i = 0; i < 4 && !found; i++) {
        await page.keyboard.press('Tab')
        found = await page.evaluate(() => (document.activeElement?.classList.contains('skip-link') ? true : null))
      }
      await sleep(200)
      out[w] = await page.evaluate(() => {
        const el = document.activeElement
        const cs = getComputedStyle(el)
        const b = el.getBoundingClientRect()
        const hit = document.elementsFromPoint(b.left - 6, b.top + b.height / 2).map((e) => e.tagName.toLowerCase() + ':' + getComputedStyle(e).backgroundColor).slice(0, 3)
        return { focused: el.className, text: el.textContent.trim(), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`, bg: cs.backgroundColor, color: cs.color, box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], outside: hit }
      })
      await page.screenshot({ path: path.join(outDir, `skip2-${w}.png`), clip: { x: Math.max(0, w - 360), y: 0, width: Math.min(360, w), height: 110 } })
      await context.close()
    }
    return out
  },

  // Keyboard at a tablet's portrait width and just under the rail's breakpoint.
  async kbd768() {
    const out = {}
    for (const [id, width, height] of [['team', 768, 1024], ['home', 1023, 768]]) {
      const { page, context, errors } = await open(id, { width, height })
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
      const steps = []
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab')
        const m = await page.evaluate(async () => {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          const el = document.activeElement
          const nav = document.querySelector('nav')
          if (!el || !nav.contains(el)) return null
          const b = el.getBoundingClientRect(), nb = nav.getBoundingClientRect()
          const cut = Math.round(Math.max(0, nb.left - b.left) + Math.max(0, b.right - nb.right))
          const faded = (nav.hasAttribute('data-more-end') && b.left < nb.left + 40) || (nav.hasAttribute('data-more-start') && b.right > nb.right - 40)
          return `${el.textContent.trim()} cut ${cut}px${faded ? ' under-fade' : ''} sl ${Math.round(nav.scrollLeft)}`
        })
        if (m) steps.push(m)
      }
      out[`${id}@${width}`] = { steps, errors }
      await context.close()
    }
    return out
  },

  // The sign-out's ring in the phone strip, reached by the keyboard.
  async signout() {
    const out = {}
    for (const [w, h] of [[360, 800], [768, 1024]]) {
      const { page, context } = await open('home', { width: w, height: h })
      await page.evaluate(() => { const links = [...document.querySelectorAll('nav a')]; links[links.length - 1].focus() })
      await page.keyboard.press('Tab')
      await sleep(300)
      out[w] = await page.evaluate(() => {
        const el = document.activeElement, nav = document.querySelector('nav')
        const b = el.getBoundingClientRect(), nb = nav.getBoundingClientRect(), cs = getComputedStyle(el)
        const ext = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)
        return { focused: el.textContent.trim(), ringTop: Math.round(b.top - ext), stripTop: Math.round(nb.top), ringBottom: Math.round(b.bottom + ext), stripBottom: Math.round(nb.bottom), clippedTopPx: Math.max(0, Math.round(nb.top - (b.top - ext))) }
      })
      const b = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      await page.screenshot({ path: path.join(outDir, `signout-${w}.png`), clip: { x: Math.max(0, b.x - 20), y: Math.max(0, b.y - 30), width: Math.min(w - Math.max(0, b.x - 20), b.w + 40), height: b.h + 60 } })
      await context.close()
    }
    return out
  },

  // The rail on a short Windows-like viewport with classic scrollbars: a viewport shot of the rail and its tab.
  async sbshot() {
    const sb = await chromium.launch({ executablePath, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--lang=en-US'] })
    const out = {}
    for (const [w, h] of [[1366, 657], [1366, 625], [1280, 720]]) {
      const screen = screens.get('team')
      const world = buildWorld(data, { role: 'owner', scenario: {} })
      const mock = createMock({ world, now: nowMs })
      const context = await sb.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce', serviceWorkers: 'block' })
      await context.clock.setFixedTime(new Date(nowMs))
      await context.addInitScript(({ key, session }) => { try { localStorage.setItem(key, JSON.stringify(session)) } catch {} }, { key: storageKey, session: world.session() })
      await context.route('**/*', async (route) => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); if (url.hostname === 'mock.supabase.invalid') return mock.handle(route); return route.abort('blockedbyclient') })
      const page = await context.newPage()
      await page.goto(`${base}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.locator('nav[aria-label="لوحة التحكم"]').waitFor({ timeout: 60000 })
      await page.evaluate(async () => { await document.fonts.ready })
      await sleep(800)
      out[`${w}x${h}`] = await page.evaluate(() => {
        const inner = document.querySelector('header').firstElementChild
        const cur = document.querySelector('nav [aria-current="page"]')
        const ib = inner.getBoundingClientRect(), cb = cur.getBoundingClientRect()
        return { tallBy: inner.scrollHeight - inner.clientHeight, scrollbar: inner.offsetWidth - inner.clientWidth, tabLeft: Math.round(cb.left), railLeft: Math.round(ib.left), gapTabToPage: Math.round(cb.left - ib.left) }
      })
      await page.screenshot({ path: path.join(outDir, `sbshot-${w}x${h}.png`), clip: { x: w - 330, y: 0, width: 330, height: h }, fullPage: false })
      await context.close()
    }
    await sb.close()
    return out
  },
}

try {
  for (const [name, fn] of Object.entries(tests)) {
    if (only && !only.includes(name)) continue
    try {
      results[name] = await fn()
    } catch (error) {
      results[name] = { failed: String(error.stack ?? error).slice(0, 800) }
    }
    writeFileSync(path.join(outDir, 'driver.json'), JSON.stringify(results, null, 2))
    console.log(`done ${name}`)
  }
} finally {
  await browser.close().catch(() => {})
  stop()
}
writeFileSync(path.join(outDir, 'driver.json'), JSON.stringify(results, null, 2))
console.log('driver finished')
process.exit(0)
