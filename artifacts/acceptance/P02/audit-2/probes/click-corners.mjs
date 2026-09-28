// Click the bottom corners of the open book and record where it goes.
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/package.json')
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
for (const [w, h] of [[1440, 900], [693, 794], [390, 794]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://localhost:3000/book#pages', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'افتح الكتاب' }).click()
  await page.waitForTimeout(3500)
  const where = () => page.locator('[aria-live="polite"]').innerText()
  const rect = async () =>
    page.evaluate(() => {
      const b = document.querySelector('.stf__block') ?? document.querySelector('[class*="flip"]')
      const r = b.getBoundingClientRect()
      const book = document.querySelector('[class*="stf__parent"]')
      // Visible leaves: page-flip shows them with display block.
      const shown = [...document.querySelectorAll('[class*="stf__item"]')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => {
          const q = el.getBoundingClientRect()
          return { kind: el.dataset.kind, page: el.dataset.page, x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }
        })
      return { block: { x: r.x, y: r.y, w: r.width, h: r.height }, shown, parent: !!book }
    })
  const log = []
  log.push(['start', (await where()).replace(/\s+/g, ' ')])
  const clickCorner = async (side) => {
    const { shown } = await rect()
    // The page on that side of the spread (or the only page in portrait).
    const sorted = [...shown].sort((a, b) => a.x - b.x)
    const target = side === 'left' ? sorted[0] : sorted[sorted.length - 1]
    const x = side === 'left' ? target.x + 20 : target.x + target.w - 20
    const y = target.y + target.h - 20
    await page.mouse.move(x, y - 60)
    await page.mouse.move(x, y, { steps: 5 })
    await page.waitForTimeout(250)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(1400)
    await page.mouse.move(5, 5)
    await page.waitForTimeout(200)
    log.push([`click ${side} (${x},${y}) on ${target.kind}${target.page ?? ''}`, (await where()).replace(/\s+/g, ' ')])
  }
  for (let i = 0; i < 3; i++) await clickCorner('left')
  for (let i = 0; i < 4; i++) await clickCorner('right')
  console.log(`\n== ${w}x${h}`)
  for (const [a, b] of log) console.log(`${a.padEnd(46)} → ${b}`)
  await page.close()
}
await browser.close()
