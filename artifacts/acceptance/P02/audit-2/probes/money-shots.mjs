// Screenshots of the store, cart, checkout and a policy, as they are now.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire('C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/package.json')
const { chromium } = require('@playwright/test')
const S = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/8b41f5ec-81b9-4bb0-86c3-948bb143d742/scratchpad/money/'
const tag = process.argv[2] ?? 'before'
mkdirSync(S, { recursive: true })
const browser = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)))
  for (const [route, name] of [['/store', 'store'], ['/store/demo-khous', 'product'], ['/cart', 'cart-empty'], ['/policies/privacy', 'policy']]) {
    await page.goto('http://localhost:3000' + route, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${S}${tag}-${w}-${name}.png`, fullPage: true })
  }
  // One item in the cart, then the cart and the checkout.
  await page.goto('http://localhost:3000/store/demo-khous', { waitUntil: 'load' })
  await page.waitForTimeout(800)
  const add = page.getByRole('button', { name: /أضف|السلة/ }).first()
  if (await add.count()) await add.click()
  await page.waitForTimeout(600)
  for (const [route, name] of [['/cart', 'cart'], ['/checkout', 'checkout']]) {
    await page.goto('http://localhost:3000' + route, { waitUntil: 'load' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${S}${tag}-${w}-${name}.png`, fullPage: true })
  }
  console.log(w, 'console errors:', errors.length, errors.slice(0, 3))
  await context.close()
}
await browser.close()
