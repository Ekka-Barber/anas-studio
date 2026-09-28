// Audit-2 reader checks: middle taps, a drag that would stop on a blank, the
// slide during a corner click that closes the book, and the corner hints.
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/package.json')
const { chromium } = require('@playwright/test')
const S = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/8b41f5ec-81b9-4bb0-86c3-948bb143d742/scratchpad/'
const browser = await chromium.launch()
const where = (page) => page.locator('[aria-live="polite"]').innerText().then((t) => t.replace(/\s+/g, ' '))
const leafBox = (page) =>
  page.evaluate(() => {
    const r = [...document.querySelectorAll('.stf__item')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect())
    return { l: Math.min(...r.map((q) => q.left)), r: Math.max(...r.map((q) => q.right)), t: Math.min(...r.map((q) => q.top)), b: Math.max(...r.map((q) => q.bottom)) }
  })
async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://localhost:3000/book', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'افتح الكتاب' }).click()
  await page.waitForTimeout(3200)
  await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('.stf__item')].find((e) => getComputedStyle(e).display !== 'none')
    window.scrollTo({ top: window.scrollY + leaf.getBoundingClientRect().bottom - innerHeight + 60, behavior: 'instant' })
  })
  await page.waitForTimeout(400)
  return page
}

// 390: taps at 45% and 55% of the page width (either side of the middle).
{
  const page = await open(390, 794)
  const b = await leafBox(page)
  const y = (b.t + b.b) / 2
  const log = [await where(page)]
  for (const f of [0.45, 0.45, 0.55, 0.55, 0.55, 0.45]) {
    await page.mouse.click(b.l + (b.r - b.l) * f, y)
    await page.waitForTimeout(1400)
    log.push(`${f} → ${await where(page)}`)
  }
  console.log('390 middle taps:', log.join(' | '))
  // A drag by hand from the bottom-left corner across the page: page 1 → (blank skipped) → page 2.
  const before = await where(page)
  await page.mouse.move(b.l + 12, b.b - 12)
  await page.mouse.down()
  await page.mouse.move(b.l + (b.r - b.l) * 0.6, b.b - 60, { steps: 12 })
  await page.mouse.move(b.r - 10, b.b - 30, { steps: 12 })
  await page.mouse.up()
  const seen = []
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(200)
    seen.push(await where(page))
  }
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.stf__item')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.kind + (e.dataset.page ?? '')))
  console.log('390 drag from', before, '→ labels over 2.4s:', [...new Set(seen)].join(' / '), '→ shown', kinds.join())
  // Both hints on page 2.
  const hints = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('.stf__item')].find((e) => getComputedStyle(e).display !== 'none')
    return { next: leaf.hasAttribute('data-corner'), back: leaf.hasAttribute('data-corner-back') }
  })
  console.log('390 hints on', kinds.join(), JSON.stringify(hints))
  await page.screenshot({ path: S + 'hints-390.png' })
  await page.close()
}

// 1440: a click on the endpaper's corner closes the book; the slide starts with the turn.
{
  const page = await open(1440, 900)
  const b = await leafBox(page)
  await page.mouse.move(b.r - 20, b.b - 20, { steps: 4 })
  await page.waitForTimeout(300)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(150)
  const during = await page.evaluate(() => ({ at: document.querySelector('.stf__parent').dataset.at, turning: document.querySelector('.stf__parent').hasAttribute('data-turning') }))
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => document.querySelector('.stf__parent').dataset.at)
  console.log('1440 corner close: during', JSON.stringify(during), 'after', after, await where(page))
  // Open again by the cover's corner (left half), and check the slide back.
  const c = await leafBox(page)
  await page.mouse.move(c.l + 20, c.b - 20, { steps: 4 })
  await page.waitForTimeout(300)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(150)
  const during2 = await page.evaluate(() => document.querySelector('.stf__parent').dataset.at)
  await page.waitForTimeout(1500)
  console.log('1440 corner open: during', during2, 'after', await where(page))
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: S + 'hints-1440.png' })
  await page.close()
}
await browser.close()
