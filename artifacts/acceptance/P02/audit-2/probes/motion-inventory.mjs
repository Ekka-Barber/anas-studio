// Motion inventory: for every public page, what moves on open and while scrolling.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const require = createRequire('C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/package.json')
const { chromium } = require('@playwright/test')
const S = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/8b41f5ec-81b9-4bb0-86c3-948bb143d742/scratchpad/'
const routes = ['/', '/book', '/built', '/started', '/passed', '/shelf', '/scenes', '/journal', '/store', '/store/demo-khous', '/cart', '/checkout', '/contact', '/policies/privacy', '/no-such-page']
const browser = await chromium.launch()
const rows = []
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'no-preference' })
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.__played = []
      const orig = Element.prototype.animate
      Element.prototype.animate = function (k, o) {
        const d = typeof o === 'number' ? o : o?.duration
        if (d > 1) window.__played.push({ y: Math.round(this.getBoundingClientRect().top + scrollY), tag: this.tagName })
        return orig.call(this, k, o)
      }
    })
    await page.goto('http://localhost:3000' + route, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    const onOpen = await page.evaluate(() => ({
      enter: document.querySelectorAll('[data-enter]').length,
      cssAnims: document.getAnimations().filter((a) => a.animationName?.startsWith('motion-')).length,
    }))
    // Scroll to the end in steps, as a reader would.
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < height; y += Math.round(h * 0.6)) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
      await page.waitForTimeout(220)
    }
    await page.waitForTimeout(600)
    const r = await page.evaluate((vh) => {
      const H = document.documentElement.scrollHeight
      const hooks = [...document.querySelectorAll('[data-reveal],[data-enter],.motion-scrub,.motion-expand')]
      const ys = hooks.map((el) => el.getBoundingClientRect().top + scrollY)
      const played = window.__played.map((p) => p.y)
      const screens = Math.ceil(H / vh)
      let still = 0
      const stillAt = []
      // A screen (below the first) where nothing moves while scrolling.
      for (let s = 1; s < screens; s++) {
        const a = s * vh
        const b = a + vh
        const moves = played.some((y) => y >= a && y < b) || [...document.querySelectorAll('.motion-scrub,.motion-expand')].some((el) => { const t = el.getBoundingClientRect().top + scrollY; return t >= a && t < b })
        if (!moves) { still++; stillAt.push(s) }
      }
      // Top-level blocks of main with no motion hook inside.
      const main = document.querySelector('main')
      const blocks = main ? [...main.children] : []
      const quiet = blocks
        .filter((b) => b.getBoundingClientRect().height > 120 && !b.matches('[data-reveal],[data-enter]') && !b.querySelector('[data-reveal],[data-enter],.motion-scrub,.motion-expand'))
        .map((b) => (b.querySelector('h1,h2,h3')?.textContent ?? b.id ?? b.tagName).trim().slice(0, 30))
      return {
        screens,
        reveal: document.querySelectorAll('[data-reveal]').length,
        scrub: document.querySelectorAll('.motion-scrub,.motion-expand').length,
        played: played.length,
        stillScreens: `${still}/${Math.max(screens - 1, 0)}`,
        quiet,
      }
    }, h)
    rows.push({ w, route, ...onOpen, ...r })
    await context.close()
  }
}
await browser.close()
writeFileSync(S + 'motion-inventory.json', JSON.stringify(rows, null, 1))
for (const r of rows) console.log(`${String(r.w).padEnd(5)} ${r.route.padEnd(18)} open:${String(r.enter).padStart(2)} reveal:${String(r.reveal).padStart(3)} played:${String(r.played).padStart(3)} scrub:${r.scrub} screens:${String(r.screens).padStart(2)} still:${r.stillScreens.padEnd(6)} quiet:[${r.quiet.join(' | ')}]`)
