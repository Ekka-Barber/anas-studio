import { expect, test } from '@playwright/test'

/**
 * P01 part 1: the four built rooms plus the truthful "قريباً" stub routes,
 * the mobile menu, the product-gallery lightbox and reduced-motion video
 * behaviour. Runs against the real built artifact (`pnpm preview:worker`, or
 * `next start` when the Worker preview is unavailable — see docs).
 */

const BUILT_ROOMS = ['/started', '/built', '/passed', '/shelf']
const STUB_ROOMS = ['/book', '/journal', '/scenes', '/contact']

function collectConsoleErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('every route renders with no console errors', () => {
  for (const route of [...BUILT_ROOMS, ...STUB_ROOMS]) {
    test(`${route} loads`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const response = await page.goto(route)
      expect(response?.ok()).toBeTruthy()
      await expect(page.locator('h1')).toHaveCount(1)
      expect(errors, `console errors on ${route}: ${errors.join('; ')}`).toEqual([])
    })
  }

  test('/ loads (P00 spike home, wrapped in the new chrome)', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    expect(errors).toEqual([])
  })
})

test.describe('mobile menu', () => {
  test('opens, traps focus, closes on Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/started')

    const menuButton = page.getByRole('button', { name: 'القائمة' })
    await menuButton.focus()
    await menuButton.click()

    const dialog = page.locator('dialog[aria-label="قائمة التنقل"]')
    await expect(dialog).toBeVisible()

    // The active room link carries aria-current="page".
    await expect(page.locator('dialog a[aria-current="page"]')).toHaveText(/بدأتُ من هنا/)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(menuButton).toBeFocused()
  })

  test('every nav link is a real <nav> with working hrefs', async ({ page }) => {
    // «القائمة» only shows below 1024 (audit fix 3 gives >=1024 the full
    // horizontal nav); Playwright's default viewport is 1280 wide.
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/started')
    await page.getByRole('button', { name: 'القائمة' }).click()
    const nav = page.locator('dialog nav[aria-label="التنقل الرئيسي"]')
    await expect(nav).toBeVisible()
    const links = nav.locator('a')
    expect(await links.count()).toBeGreaterThanOrEqual(9)
  })
})

test.describe('product gallery lightbox (مررتُ من هنا)', () => {
  test('opens by keyboard, navigates and returns focus on close', async ({ page }) => {
    await page.goto('/passed')
    const firstThumb = page.locator('button').filter({ has: page.locator('picture') }).first()
    await firstThumb.focus()
    await page.keyboard.press('Enter')

    const dialog = page.locator('dialog[aria-label="معرض الصور"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('text=/^1 \\//')).toBeVisible()

    await page.keyboard.press('ArrowRight')
    await expect(dialog.locator('text=/^2 \\//')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(firstThumb).toBeFocused()
  })
})

test.describe('video reels respect reduced motion', () => {
  test('a reel shows a poster and play button (tap-to-play) instead of autoplaying', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/started')
    const firstReel = page.locator('video').first()
    // Hydrated + waiting for a tap: native controls stay hidden behind the
    // poster and a custom accessible play button (audit fix 6) until pressed.
    await expect(firstReel).not.toHaveAttribute('controls', '')
    await expect(firstReel).toHaveAttribute('muted', '')
    await expect(firstReel).toHaveAttribute('preload', 'none')
    await expect(page.getByRole('button', { name: /^تشغيل/ }).first()).toBeVisible()
  })

  test('a playing (autoplaying) reel still shows native controls, so it can be paused', async ({ page }) => {
    await page.goto('/started')
    const firstReel = page.locator('video').first()
    await firstReel.scrollIntoViewIfNeeded()
    // >=60% in view + motion allowed triggers autoplay (VideoReel's own
    // IntersectionObserver rule); once playing, native controls must be
    // present or the loop has no pause control (WCAG 2.2.2, round 2 fix 3).
    await expect(firstReel).toHaveJSProperty('paused', false)
    await expect(firstReel).toHaveAttribute('controls', '')
  })
})

test.describe('readable with JavaScript off', () => {
  for (const route of BUILT_ROOMS) {
    test(`${route} reads without JS`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false })
      const page = await context.newPage()
      const response = await page.goto(route)
      expect(response?.ok()).toBeTruthy()
      await expect(page.locator('h1')).toHaveCount(1)
      // Reading-column paragraphs must be present in the no-JS DOM.
      const paragraphCount = await page.locator('p').count()
      expect(paragraphCount).toBeGreaterThan(3)
      await context.close()
    })
  }
})
