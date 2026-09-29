// CLEANUP-1 acceptance, admin half (kept as evidence; not part of the test suite). As a fresh local
// owner on the dev server (:3000), at 360 and 1440: the social links list and
// the scenes gallery form. Every changed control is exercised and the form is
// left unsaved, so the database is untouched. Usage, from the repo root:
//   node <this file> <shotDir>
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const repo = process.cwd()
const require = createRequire(`${repo}/package.json`)
const { chromium, expect: baseExpect } = require('@playwright/test')
const { createOwner, readCodeFromMailpit, SENT_MESSAGE } = await import(pathToFileURL(`${repo}/tests/e2e/helpers.ts`).href)

const expect = baseExpect.configure({ timeout: 60_000 })
const shotDir = process.argv[2]
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const browser = await chromium.launch()
const report = []

for (const width of [360, 1440]) {
  const context = await browser.newContext({
    baseURL: 'http://localhost:3000',
    viewport: { width, height: width < 600 ? 800 : 900 },
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
  })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const errors = []
  const failed = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`))
  const r = { width }
  try {
    const email = await createOwner(`قبول ${width}`)
    await page.goto('/admin/sign-in')
    await page.getByLabel('البريد الإلكتروني').fill(email)
    await page.getByRole('button', { name: 'أرسل الرمز' }).click()
    await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
    await page.getByLabel('رمز الدخول').fill(await readCodeFromMailpit(email))
    await page.getByRole('button', { name: 'تحقق' }).click()
    await expect(page).toHaveURL(/\/admin$/)

    // Social links (C09).
    await page.goto('/admin/content/site_settings/edit?id=site')
    const social = page.getByRole('group', { name: 'روابط التواصل' })
    const links = social.locator('> div')
    await expect(links).toHaveCount(4)
    const networks = () => links.evaluateAll((els) => els.map((el) => el.querySelector('input')?.value ?? ''))
    r.socialAtLoad = await networks()
    await social.getByRole('button', { name: 'أضف عنصرًا' }).click()
    await expect(links).toHaveCount(5)
    await links.nth(4).getByLabel('الشبكة').fill('يوتيوب')
    await links.nth(4).getByLabel('المعرّف').fill('@test')
    await links.nth(4).getByLabel('الرابط').fill('http://youtube.com/test')
    await expect(page.getByText(/social\.4\.href/)).toBeVisible()
    r.httpRefused = true
    await links.nth(4).getByLabel('الرابط').fill('https://youtube.com/test')
    await expect(page.getByText('هناك مشاكل في البيانات:')).toHaveCount(0)
    await links.nth(4).getByRole('button', { name: 'أعلى' }).click()
    r.socialAfterUp = await networks()
    await links.nth(3).getByRole('button', { name: 'أسفل' }).click()
    r.socialAfterDown = await networks()
    await links.nth(4).getByRole('button', { name: 'حذف' }).click()
    await expect(links).toHaveCount(4)
    r.socialAfterRemove = await networks()
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await social.scrollIntoViewIfNeeded()
    r.socialOverflow = await overflow(page)
    await social.screenshot({ path: `${shotDir}/admin-social-${width}.png` })

    // Scenes gallery (C05).
    await page.goto('/admin/content')
    await page.getByRole('link', { name: 'المَشاهد' }).click()
    await page.getByRole('row', { name: /المَشاهد/ }).getByRole('link').click()
    await expect(page).toHaveURL(/\/admin\/content\/scenes\/edit\?id=gallery$/)
    const photos = page.getByRole('group', { name: 'الصور' })
    const items = photos.locator('> div')
    await expect(items).toHaveCount(19)
    const firstCaption = await items.nth(0).getByLabel('التعليق').inputValue()
    r.categoryOptions = await items.nth(0).getByLabel('التصنيف').locator('option').allInnerTexts()
    await photos.getByRole('button', { name: 'أضف عنصرًا' }).click()
    await expect(items).toHaveCount(20)
    const added = items.nth(19)
    await added.getByLabel('التصنيف').selectOption('رحلات')
    await added.getByLabel('التعليق').fill('لقطة القبول')
    await added.getByRole('button', { name: 'أعلى' }).click()
    await expect(items.nth(18).getByLabel('التعليق')).toHaveValue('لقطة القبول')
    await items.nth(18).getByRole('button', { name: 'أسفل' }).click()
    await expect(items.nth(19).getByLabel('التعليق')).toHaveValue('لقطة القبول')
    await items.nth(0).getByLabel('التصنيف').selectOption('مشاريع')
    await expect(items.nth(0).getByLabel('التصنيف')).toHaveValue('مشاريع')
    await items.nth(0).getByRole('checkbox', { name: 'إخفاء' }).check()
    await expect(items.nth(0).getByRole('checkbox', { name: 'إخفاء' })).toBeChecked()
    await items.nth(0).getByLabel('التعليق').fill('   ')
    await expect(page.getByText('هناك مشاكل في البيانات:')).toBeVisible()
    r.blankCaptionRefused = true
    await items.nth(0).getByLabel('التعليق').fill(firstCaption)
    await items.nth(0).getByRole('checkbox', { name: 'إخفاء' }).uncheck()
    await items.nth(19).getByRole('button', { name: 'حذف' }).click()
    await expect(items).toHaveCount(19)
    r.scenesOverflow = await overflow(page)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    const top = await page.getByRole('heading', { level: 1 }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    const bottom = await items.nth(1).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY)
    await page.screenshot({ path: `${shotDir}/admin-scenes-${width}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, top - 24), width, height: bottom - top + 48 } })
    r.ok = true
  } catch (error) {
    r.ok = false
    r.error = String(error).slice(0, 1500)
    await page.screenshot({ path: `${shotDir}/../admin-failure-${width}.png` }).catch(() => {})
  }
  r.consoleErrors = errors
  r.failedResponses = failed
  report.push(r)
  await context.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 1))
