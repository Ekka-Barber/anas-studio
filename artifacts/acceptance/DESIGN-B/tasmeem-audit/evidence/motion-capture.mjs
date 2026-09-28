import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { chromium } = require('@playwright/test')
const out = process.argv[2]
const browser = await chromium.launch()
const res = {}
for (const [w, h] of [[1440, 900], [360, 800]]) {
  for (const route of ['/', '/started', '/book', '/scenes']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'no-preference' })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3000' + route, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(120)
    const an = await page.evaluate(() => document.getAnimations().map(a => { const t = a.effect.getTiming(); const g = a.effect.target; return { n: a.animationName || 'waapi', el: (g.getAttribute('data-fx') || '') + ' ' + (String(g.className).replace(/[a-z-]+-module__\w+__/g, '').slice(0, 24) || g.tagName), dur: t.duration, delay: t.delay, ease: t.easing } }))
    const name = route === '/' ? 'home' : route.slice(1)
    if (w === 1440 || route === '/') {
      await page.screenshot({ path: `${out}/${name}-${w}-t120ms.png` })
      await page.waitForTimeout(380)
      await page.screenshot({ path: `${out}/${name}-${w}-t500ms.png` })
    }
    // scroll once through, capture the waapi reveals as they play
    const rev = await page.evaluate(async () => {
      const seen = []
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.7) {
        scrollTo(0, y); await new Promise(r => setTimeout(r, 90))
        for (const a of document.getAnimations()) { const t = a.effect.getTiming(); if (a.playState === 'running') seen.push(`${t.duration}|${t.easing}|${a.effect.getKeyframes().map(k => k.clipPath || k.transform || k.opacity).join('>')}`) }
      }
      return [...new Set(seen)]
    })
    res[`${name}@${w}`] = { entrances: an, reveals: rev }
    await ctx.close()
  }
}
await browser.close()
console.log(JSON.stringify(res, null, 1))
