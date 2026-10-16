// Photographs the P12 comp: each view at the widths given, full page, after the fonts are in.
// usage: node shoot.mjs   (Playwright resolved from the repository's node_modules)
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(join(here, '../../../../package.json'))
const { chromium } = require('@playwright/test')
await import('./server.mjs')

const shots = [
  ['board', 1440, 1000],
  ['card', 1440, 1560],
  ['projects', 1440, 900],
  ['overview', 1440, 900],
  ['board', 360, 800],
  ['card', 360, 2300],
]
const browser = await chromium.launch()
const problems = []
for (const [view, width, height] of shots) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  page.on('console', (m) => m.type() === 'error' && problems.push(`${view}@${width}: ${m.text()}`))
  page.on('requestfailed', (r) => problems.push(`${view}@${width}: failed ${r.url()}`))
  await page.goto(`http://127.0.0.1:4317/#${view}`)
  await page.evaluate(() => document.fonts.ready)
  // Overflow check: nothing may push the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) problems.push(`${view}@${width}: page overflows by ${overflow}px`)
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
  await page.screenshot({ path: join(here, `p12-${view}-${width}.png`), fullPage: view !== 'card' })
  console.log(view, width, 'fonts:', fonts.join(', '))
  await page.close()
}
await browser.close()
console.log(problems.length ? problems.join('\n') : 'no console errors, no failed requests, no overflow')
process.exit(0)
