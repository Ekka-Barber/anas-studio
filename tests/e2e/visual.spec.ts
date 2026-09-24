import { expect, test } from '@playwright/test'

/**
 * Screenshot evidence for DESIGN-AUDIT.md's responsive/no-overflow checks:
 * every P01 room at 360/768/1024/1440, with JS on and JS off, saved under
 * `artifacts/acceptance/P01/screenshots/`.
 */

const ROOMS: { route: string; slug: string }[] = [
  { route: '/started', slug: 'started' },
  { route: '/built', slug: 'built' },
  { route: '/passed', slug: 'passed' },
  { route: '/shelf', slug: 'shelf' },
]

const WIDTHS = [360, 768, 1024, 1440]
const OUT_DIR = 'artifacts/acceptance/P01/screenshots'

for (const { route, slug } of ROOMS) {
  for (const width of WIDTHS) {
    test(`${slug} @ ${width}px — JS on, no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      // `loading="lazy"` images below the fold need a real scroll pass to
      // start fetching before a full-page screenshot captures them.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 800) {
          window.scrollTo(0, y)
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForLoadState('networkidle')

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `horizontal overflow on ${route} at ${width}px`).toBeLessThanOrEqual(1)

      await page.screenshot({ path: `${OUT_DIR}/${slug}-${width}-js.png`, fullPage: true })
    })
  }

  test(`${slug} — JS off, readable`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 768, height: 1000 } })
    const page = await context.newPage()
    await page.goto(route)
    await expect(page.locator('h1')).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/${slug}-768-nojs.png`, fullPage: true })
    await context.close()
  })
}
