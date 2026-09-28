import { expect, test, type Page } from '@playwright/test'

/**
 * The public site in direction B (D39): every page renders cleanly, the
 * menu, the scenes filter and lightbox, the films, the book's contents strip
 * and the contact form work by mouse and keyboard, content reads without
 * JavaScript, and no placeholder copy ships.
 */

const ROUTES = ['/', '/started', '/built', '/passed', '/shelf', '/book', '/journal', '/scenes', '/contact', '/store']
const ROOMS = ['/started', '/built', '/passed', '/shelf']

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('every page renders with one h1 and no console errors', () => {
  for (const route of ROUTES) {
    test(`${route} loads`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const response = await page.goto(route)
      expect(response?.ok()).toBeTruthy()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator('main#main')).toHaveCount(1)
      // Placeholders from the design stage never reach the site (D39).
      await expect(page.getByText(/بانتظار أنس|مكان صورة|لم يُرفع بعد/)).toHaveCount(0)
      expect(errors, `console errors on ${route}: ${errors.join('; ')}`).toEqual([])
    })
  }

  test('an unknown path is the woven 404', async ({ page }) => {
    const response = await page.goto('/no-such-room')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('لم يُبنَ بعد')
    await expect(page.getByRole('navigation', { name: 'طرق مبنية' }).getByRole('link')).toHaveCount(7)
  })
})

test.describe('header and menu', () => {
  test('the menu opens as a modal, marks the room, closes on Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/started')
    const menuButton = page.getByRole('button', { name: 'القائمة' })
    await menuButton.focus()
    await menuButton.click()

    const dialog = page.locator('dialog[aria-label="قائمة التنقل"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('a[aria-current="page"]')).toHaveText(/بدأتُ من هنا/)
    expect(await dialog.getByRole('navigation', { name: 'التنقل الرئيسي' }).getByRole('link').count()).toBeGreaterThanOrEqual(9)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(menuButton).toBeFocused()
  })

  test('from 1024px the rooms are inline and the current one is marked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/built')
    await expect(page.getByRole('button', { name: 'القائمة' })).toBeHidden()
    // The closed menu is not in the accessibility tree, so this is the inline row.
    const inline = page.getByRole('navigation', { name: 'التنقل الرئيسي' })
    await expect(inline.getByRole('link', { name: 'بنيتُ هنا' })).toHaveAttribute('aria-current', 'page')
  })

  test('the skip link jumps to the page content', async ({ page }) => {
    await page.goto('/passed')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'انتقل إلى المحتوى' })
    await expect(skip).toBeFocused()
    await skip.press('Enter')
    await expect(page).toHaveURL(/#main$/)
  })
})

test.describe('films play only when asked', () => {
  test('a film shows its poster and a play button, then plays with its own controls', async ({ page }) => {
    await page.goto('/started')
    const film = page.locator('video').first()
    await expect(film).toHaveAttribute('preload', 'none')
    await expect(film).not.toHaveAttribute('controls', '')
    const play = page.getByRole('button', { name: /^تشغيل:/ }).first()
    await play.scrollIntoViewIfNeeded()
    await play.click()
    await expect(film).toHaveAttribute('controls', '')
    await expect(film).toHaveJSProperty('paused', false)
  })
})

test.describe('المَشاهد', () => {
  test('the filter narrows the grid and says which filter is on', async ({ page }) => {
    await page.goto('/scenes')
    const tiles = page.getByRole('list', { name: 'الصور' }).getByRole('listitem')
    const all = await tiles.count()
    const filter = page.getByRole('group', { name: 'تصفية المشاهد' }).getByRole('button', { name: 'مشاريع' })
    await filter.click()
    await expect(filter).toHaveAttribute('aria-pressed', 'true')
    const some = await tiles.count()
    await expect(page.getByRole('status').filter({ hasText: 'مشاريع:' })).toHaveText(/^مشاريع: (صورة واحدة|صورتان|\d+ صورة|\d+ صور)$/)
    expect(some).toBeGreaterThan(0)
    expect(some).toBeLessThan(all)
  })

  test('the lightbox opens by keyboard, steps in Arabic order and returns focus', async ({ page }) => {
    await page.goto('/scenes')
    const first = page.getByRole('button', { name: /^تكبير:/ }).first()
    await first.focus()
    await page.keyboard.press('Enter')
    const viewer = page.locator('dialog[aria-label="عارض الصور"]')
    await expect(viewer).toBeVisible()
    await expect(viewer.getByText(/^1 \//)).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(viewer.getByText(/^2 \//)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    await expect(first).toBeFocused()
  })
})

test.describe('كتبتُ هنا', () => {
  test('cover B, and the contents strip jumps to its sections', async ({ page }) => {
    await page.goto('/book')
    await expect(page.locator('img[src*="khous-cover-b"]').first()).toBeVisible()
    await expect(page.locator('img[src*="khous-standing-b"]')).toHaveCount(1)
    await page.getByRole('navigation', { name: 'أقسام الكتاب' }).getByRole('link', { name: 'صور' }).click()
    await expect(page).toHaveURL(/#photos$/)
    await expect(page.getByRole('heading', { name: 'صور' })).toBeInViewport()
  })
})

test.describe('تواصل', () => {
  test('an empty send names each missing field and focuses the first', async ({ page }) => {
    await page.goto('/contact')
    await page.getByRole('button', { name: /أرسل/ }).click()
    await expect(page.getByText('اكتب اسمك.')).toBeVisible()
    await expect(page.getByText('اكتب بريدك الإلكتروني.')).toBeVisible()
    await expect(page.getByText('اكتب رسالتك.')).toBeVisible()
    await expect(page.getByLabel('الاسم')).toBeFocused()
    await expect(page.getByLabel('الاسم')).toHaveAttribute('aria-invalid', 'true')
  })

  test('a service opens the form with its name in the message', async ({ page }) => {
    await page.goto('/contact')
    await page.getByRole('link', { name: /اطلب جلسة/ }).first().click()
    await expect(page.getByLabel('الرسالة')).toHaveValue(/بناء القائمة/)
    await expect(page.getByLabel('الرسالة')).toBeFocused()
  })
})

test.describe('readable with JavaScript off', () => {
  for (const route of ['/', ...ROOMS, '/book']) {
    test(`${route} reads without JS`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false })
      const page = await context.newPage()
      const response = await page.goto(route)
      expect(response?.ok()).toBeTruthy()
      await expect(page.locator('h1')).toHaveCount(1)
      expect(await page.locator('main p').count()).toBeGreaterThan(3)
      // Films stay playable: the browser's own controls stand in.
      for (const video of await page.locator('video').all()) await expect(video).toHaveAttribute('controls', '')
      await context.close()
    })
  }
})
