// CLEANUP-1 acceptance, public half (kept as evidence; not part of the test suite). Against the
// static export served locally, at 360 and 1440: the footer, /contact and
// /scenes, with console errors, failed requests (the favicon among them),
// horizontal overflow, and the scenes filter and lightbox exercised.
// Usage, from the repo root: node <this file> <baseURL> <shotDir>
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium, expect: baseExpect } = require('@playwright/test')

const expect = baseExpect.configure({ timeout: 30_000 })
const [baseURL, shotDir] = process.argv.slice(2)
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
// Lazy photos load as they near the viewport: walk the page once before a full-page shot.
const walk = (p) =>
  p.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    window.scrollTo(0, 0)
  })

const browser = await chromium.launch()
const report = []
for (const width of [360, 1440]) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width < 600 ? 800 : 900 },
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  const failed = []
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()} ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e}`))
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`))
  const r = { width, overflow: {} }
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    r.iconLinks = await page.locator('head link[rel*="icon"]').evaluateAll((els) => els.map((el) => `${el.rel} ${el.getAttribute('href')}`))
    r.iconStatus = {}
    for (const path of ['/favicon.ico', '/icon.svg', '/apple-icon.png']) r.iconStatus[path] = (await page.request.get(path)).status()
    r.overflow['/'] = await overflow(page)
    const footer = page.locator('footer').last()
    r.footerLinks = await footer.getByRole('link').evaluateAll((els) => els.map((el) => `${el.getAttribute('aria-label') ?? el.textContent.trim()} -> ${el.getAttribute('href')}`))
    await footer.scrollIntoViewIfNeeded()
    await footer.screenshot({ path: `${shotDir}/footer-${width}.png` })

    await page.goto('/contact', { waitUntil: 'load' })
    r.overflow['/contact'] = await overflow(page)
    const channels = page.getByRole('list', { name: 'قنوات التواصل' })
    r.contactChannels = await channels.getByRole('link').evaluateAll((els) => els.map((el) => `${el.textContent.replace(/\s+/g, ' ').trim()} -> ${el.getAttribute('href')}`))
    await walk(page)
    await page.screenshot({ path: `${shotDir}/contact-${width}.png`, fullPage: true })

    await page.goto('/scenes', { waitUntil: 'load' })
    r.overflow['/scenes'] = await overflow(page)
    const tiles = page.getByRole('button', { name: /^تكبير:/ })
    r.tiles = await tiles.count()
    const filters = page.getByRole('group', { name: 'تصفية المشاهد' })
    r.filters = await filters.getByRole('button').allInnerTexts()
    await walk(page)
    r.brokenImages = await page.locator('main img').evaluateAll((els) => els.filter((img) => !img.complete || img.naturalWidth === 0).length)
    await page.screenshot({ path: `${shotDir}/scenes-${width}.png`, fullPage: true })
    await filters.getByRole('button', { name: 'مشاريع' }).click()
    r.filterStatus = await page.getByRole('status').filter({ hasText: 'مشاريع' }).innerText()
    r.visibleAfterFilter = await tiles.evaluateAll((els) => els.filter((el) => el.offsetParent !== null).length)
    await filters.getByRole('button', { name: 'الكل' }).click()
    await tiles.first().click()
    const viewer = page.locator('dialog[aria-label="عارض الصور"]')
    await expect(viewer).toBeVisible()
    r.lightboxCaption = (await viewer.innerText()).replace(/\s+/g, ' ').trim().slice(0, 120)
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    r.ok = true
  } catch (error) {
    r.ok = false
    r.error = String(error).slice(0, 1500)
  }
  r.consoleErrors = errors
  r.failedResponses = failed
  report.push(r)
  await context.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 1))
