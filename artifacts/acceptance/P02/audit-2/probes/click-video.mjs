// Records corner clicks (left = next, right = previous) for frame review.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = 'C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME'
const require = createRequire(`${root}/package.json`)
const { chromium } = require('@playwright/test')
const out = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/8b41f5ec-81b9-4bb0-86c3-948bb143d742/scratchpad/clicks'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const marks = {}
for (const [width, height] of [[1440, 900], [390, 794]]) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', recordVideo: { dir: out, size: { width, height } } })
  const t0 = Date.now()
  const page = await context.newPage()
  await page.goto('http://localhost:3000/book', { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: 'body > header, [data-tone="aub"]:has(> nav[aria-label="أقسام الكتاب"]) { position: static !important; }' })
  await page.getByRole('button', { name: 'افتح الكتاب' }).click()
  await page.waitForTimeout(3000)
  // Put the page's bottom 40px above the fold.
  await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('.stf__item')].find((e) => getComputedStyle(e).display !== 'none')
    window.scrollTo({ top: window.scrollY + leaf.getBoundingClientRect().bottom - innerHeight + 60, behavior: 'instant' })
  })
  await page.waitForTimeout(500)
  const log = []
  const click = async (side) => {
    const r = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('.stf__item')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect())
      return { l: Math.min(...shown.map((q) => q.left)), r: Math.max(...shown.map((q) => q.right)), b: Math.max(...shown.map((q) => q.bottom)) }
    })
    const x = side === 'left' ? r.l + 18 : r.r - 18
    const y = r.b - 18
    await page.mouse.move(x, y - 80)
    await page.mouse.move(x, y, { steps: 6 })
    await page.waitForTimeout(500)
    const before = await page.locator('[aria-live="polite"]').innerText()
    const t = (Date.now() - t0) / 1000
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(1500)
    await page.mouse.move(width / 2, 20)
    await page.waitForTimeout(300)
    const after = await page.locator('[aria-live="polite"]').innerText()
    log.push({ side, t: +t.toFixed(2), before: before.replace(/\s+/g, ' '), after: after.replace(/\s+/g, ' ') })
  }
  await click('left')
  await click('left')
  await click('right')
  await click('right')
  marks[`${width}`] = { video: await page.video().path(), log }
  await context.close()
}
await browser.close()
writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 1))
console.log(JSON.stringify(marks, null, 1))
