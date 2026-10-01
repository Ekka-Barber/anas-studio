import { expect, test } from '@playwright/test'

/**
 * JavaScript off (DESIGN.md: everything is visible without it). The three
 * pages that carry script-only widgets, and the header, still give a visitor
 * what they came for: the rooms inline, the photos as links to the files, the
 * posts as links, and the contact page's channels and services. The widgets
 * that need script (the menu button, the filters) hide themselves with
 * `@media (scripting: none)`. A phone is the hard case: with script it shows
 * the menu button, not the inline rooms. Reduced motion is on so a tile's
 * entrance (a clip-path that opens over its first second) cannot cover the
 * link while it is clicked.
 */

const WIDTH = 375
test.use({ javaScriptEnabled: false, reducedMotion: 'reduce', viewport: { width: WIDTH, height: 800 } })

const ROOMS = ['/started', '/built', '/passed', '/shelf', '/book', '/journal', '/scenes', '/contact']

test('the header lists every room inline, within the screen, and offers no menu button', async ({ page }) => {
  await page.goto('/contact')
  await expect(page.getByRole('button', { name: 'القائمة' })).toBeHidden()
  await expect(page.locator('dialog[aria-label="قائمة التنقل"]')).toBeHidden()
  await expect(page.getByRole('link', { name: 'أنس، الرئيسية' })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' })
  for (const href of ROOMS) {
    const link = nav.locator(`a[href="${href}"]`)
    await expect(link).toBeVisible()
    const box = (await link.boundingBox())!
    // The row wraps; a room never runs off the edge of the screen.
    expect(box.x, `${href} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${href} ends inside the screen`).toBeLessThanOrEqual(WIDTH)
  }
  await expect(nav.locator('a[href="/contact"]')).toHaveAttribute('aria-current', 'page')

  await nav.locator('a[href="/scenes"]').click()
  await expect(page).toHaveURL(/\/scenes\/?$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('المَشاهد lists every photo as a link to the file and offers no filter', async ({ page }) => {
  await page.goto('/scenes')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('group', { name: 'تصفية المشاهد' })).toBeHidden()

  const photos = page.getByRole('list', { name: 'الصور' }).locator('a[href]')
  expect(await photos.count()).toBeGreaterThan(1)
  await expect(photos.first()).toBeVisible()
  // A tile far down the grid is shown too: nothing waits for a scroll to reveal it.
  await expect(photos.last()).toBeVisible()

  const href = (await photos.first().getAttribute('href'))!
  await photos.first().click()
  expect(page.url()).toContain(href)
})

test('المجلس lists its posts as links, or says there are none yet', async ({ page }) => {
  await page.goto('/journal')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('group', { name: 'التصنيفات' })).toBeHidden()

  const posts = page.getByRole('region', { name: 'التدوينات' }).getByRole('link')
  if ((await posts.count()) > 0) {
    await expect(posts.first().getByRole('heading', { level: 2 })).toBeVisible()
    await expect(posts.last()).toBeVisible()
    await posts.first().click()
    await expect(page).toHaveURL(/\/journal\/[^/]+\/?$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  } else {
    await expect(page.getByText('لم تُنشر أول تدوينة بعد.')).toBeVisible()
    await expect(page.getByRole('link', { name: /إلى الغرف/ })).toHaveAttribute('href', '/#rooms')
  }
})

test('تواصل shows the form but cannot send, and keeps the channels and services', async ({ page }) => {
  await page.goto('/contact')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The form is on the page; a native submit would put the message in the address bar, so it is off.
  for (const label of ['الاسم', 'البريد الإلكتروني', 'الرسالة']) await expect(page.getByLabel(label)).toBeVisible()
  await expect(page.getByRole('button', { name: /أرسل/ })).toBeDisabled()
  // Playwright's text engine skips <noscript>, so the notice is found by its element.
  await expect(page.locator('noscript p')).toHaveText('الإرسال يحتاج JavaScript؛ راسلني عبر القنوات المجاورة.')
  await expect(page.locator('noscript p')).toBeVisible()

  // The channels it points to are real links.
  const channels = page.getByRole('list', { name: 'قنوات التواصل' }).getByRole('link')
  expect(await channels.count()).toBeGreaterThan(0)
  for (const channel of await channels.all()) {
    await expect(channel).toBeVisible()
    await expect(channel).toHaveAttribute('href', /^(https?:|tel:|mailto:)/)
  }

  // Each service's «اطلب جلسة» is a link to the form.
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  const requests = page.getByRole('link', { name: /اطلب جلسة/ })
  expect(await requests.count()).toBeGreaterThan(0)
  for (const request of await requests.all()) await expect(request).toHaveAttribute('href', '#contact-form')
  await requests.first().click()
  await expect(page).toHaveURL(/#contact-form$/)
})
