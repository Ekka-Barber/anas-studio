// Why no reveal plays: data-seen, holds, and the animate() calls on first load.
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/package.json')
const { chromium } = require('@playwright/test')
const base = process.argv[2] ?? 'http://localhost:3000'
const browser = await chromium.launch()
for (const route of ['/started', '/']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__calls = []
    const orig = Element.prototype.animate
    Element.prototype.animate = function (k, o) {
      window.__calls.push(typeof o === 'number' ? o : o?.duration)
      return orig.call(this, k, o)
    }
  })
  await page.goto(base + route, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  const a = await page.evaluate(() => ({
    seen: document.documentElement.hasAttribute('data-seen'),
    calls: window.__calls.length,
    holds: window.__calls.filter((d) => d === 1).length,
    enterRunning: document.getAnimations().filter((x) => x.animationName?.startsWith('motion-')).length,
    reduced: matchMedia('(prefers-reduced-motion: no-preference)').matches,
  }))
  await page.evaluate(() => window.scrollTo({ top: 2500, behavior: 'instant' }))
  await page.waitForTimeout(800)
  const b = await page.evaluate(() => window.__calls.filter((d) => d > 1).length)
  console.log(base, route, JSON.stringify(a), 'played after scroll:', b)
  await context.close()
}
await browser.close()
