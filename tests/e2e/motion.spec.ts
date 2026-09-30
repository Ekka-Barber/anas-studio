import { expect, test, type Page } from '@playwright/test'

/**
 * Audit 2 (artifacts/acceptance/P02/audit-2/FINDINGS.md, A1–A3): the scroll
 * reveals really play. `src/components/weave/motion.ts` holds a reveal below
 * the fold with a 1ms `Element.animate` and plays it with a longer one as it
 * scrolls in; the spec wraps `Element.prototype.animate` to count both, per
 * element (React's development double run holds an element twice).
 *
 * - The story pages, on a first visit: not marked as seen, reveals held, and
 *   every held reveal played by the end of the page. On `next dev` this is
 *   what failed before the fix: StrictMode's second run took every first
 *   visit for a return.
 * - The cart, checkout and policy pages stay still apart from their title's
 *   short fade.
 * - A page seen before comes back without its entrances, and its reveals
 *   still play.
 * - Without motion nothing is held, played or entered.
 *
 * It runs against `next dev` (the default baseURL) and the static export
 * (PLAYWRIGHT_BASE_URL=http://localhost:4010).
 */

type Reveals = { held: Set<Element>; played: Set<Element> }

const STORY = ['/', '/book', '/built', '/started', '/passed', '/shelf', '/scenes', '/contact', '/store', '/store/demo-khous']
const CALM = ['/cart', '/checkout', '/policies/privacy']

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const reveals: Reveals = { held: new Set(), played: new Set() }
    Object.assign(window, { reveals })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (keyframes, options) {
      const duration = typeof options === 'number' ? options : options?.duration
      if (duration === 1) reveals.held.add(this)
      else if (typeof duration === 'number' && duration > 1) reveals.played.add(this)
      return animate.call(this, keyframes, options)
    }
  })
})

/** Elements held, elements played, and held elements not played yet. */
function counts(page: Page) {
  return page.evaluate(() => {
    const { held, played } = (window as unknown as { reveals: Reveals }).reveals
    return { holds: held.size, plays: played.size, unplayed: [...held].filter((el) => !played.has(el)).length }
  })
}

function resetCounts(page: Page) {
  return page.evaluate(() => {
    const { held, played } = (window as unknown as { reveals: Reveals }).reveals
    held.clear()
    played.clear()
  })
}

/** React has hydrated the page (its nodes carry their fibers), so MotionLayer has run. */
async function hydrated(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Object.keys(document.querySelector('main') ?? {}).some((key) => key.startsWith('__reactFiber$'))))
    .toBe(true)
}

/** Scrolls to the end as a reader would: steps of 0.6 of the viewport, 200ms apart. */
async function scrollToEnd(page: Page) {
  for (let step = 0; step < 100; step++) {
    const end = await page.evaluate(() => {
      const bottom = document.documentElement.scrollHeight - window.innerHeight
      if (window.scrollY >= bottom - 1) return true
      window.scrollTo({ top: Math.min(window.scrollY + window.innerHeight * 0.6, bottom), behavior: 'instant' })
      return false
    })
    if (end) return
    await page.waitForTimeout(200)
  }
  throw new Error('the page never reached its end')
}

/** Waits for a smooth scroll (the site's `scroll-behavior`) to come to rest. */
async function scrollSettled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const y = window.scrollY
            window.setTimeout(() => resolve(window.scrollY === y), 300)
          }),
      ),
    )
    .toBe(true)
}

const entranceAnimations = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-enter]')].map((el) => getComputedStyle(el).animationName))

const seen = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-seen'))

test.describe('a first visit plays the reveals', () => {
  for (const path of STORY) {
    test(`${path}: reveals below the fold are held, then each one plays`, async ({ page }) => {
      const response = await page.goto(path)
      // The demo product exists only in the local seed; every other page must be there (a 404 fails below).
      const missing = Boolean(
        response?.status() === 404 || (await page.locator('main h1').first().textContent())?.includes('هذا الطريق'),
      )
      test.skip(path === '/store/demo-khous' && missing, `${path} is not in this build (the local seed's demo product)`)
      expect(missing, `${path} is not in this build (the woven 404)`).toBe(false)

      // Once MotionLayer has held something it has run (twice on dev), and a first visit is not a return.
      await expect.poll(async () => (await counts(page)).holds).toBeGreaterThan(0)
      expect(await seen(page)).toBe(false)

      await scrollToEnd(page)
      await expect.poll(async () => (await counts(page)).unplayed).toBe(0)
      const { holds, plays } = await counts(page)
      expect(plays).toBeGreaterThanOrEqual(holds)
    })
  }
})

test.describe('the money and policy pages stay calm', () => {
  for (const path of CALM) {
    test(`${path}: no reveal, and the title only fades in briefly`, async ({ page }) => {
      await page.goto(path)
      await hydrated(page)
      await scrollToEnd(page)
      expect(await counts(page)).toEqual({ holds: 0, plays: 0, unplayed: 0 })

      const title = page.locator('main h1')
      await expect(title).toHaveAttribute('data-enter', '')
      await expect(title).toHaveAttribute('data-fx', 'fade')
      const animation = await title.evaluate((h1) => {
        const style = getComputedStyle(h1)
        return { name: style.animationName, seconds: parseFloat(style.animationDuration) }
      })
      expect(animation.name).toBe('motion-fade')
      expect(animation.seconds).toBeGreaterThan(0)
      expect(animation.seconds).toBeLessThanOrEqual(0.3)
    })
  }
})

test('a page seen before comes back without its entrances, and its reveals still play', async ({ page }) => {
  await page.goto('/started')
  await expect.poll(async () => (await counts(page)).holds).toBeGreaterThan(0)
  await scrollToEnd(page)
  await expect.poll(async () => (await counts(page)).unplayed).toBe(0)

  // A real link, so a client navigation: the same document and the same visit.
  await page.getByRole('link', { name: /الغرفة التالية/ }).click()
  await expect(page).toHaveURL(/\/built$/)
  await expect(page.getByRole('heading', { level: 1, name: 'بنيتُ هنا' })).toBeVisible()
  // The new page scrolls to its top smoothly; the way back starts once it is there.
  await scrollSettled(page)
  await resetCounts(page)

  await page.goBack()
  await expect(page).toHaveURL(/\/started$/)
  await expect(page.locator('html')).toHaveAttribute('data-seen', '')
  const entrances = await entranceAnimations(page)
  expect(entrances.length).toBeGreaterThan(0)
  expect(entrances.every((name) => name === 'none')).toBe(true)

  await scrollToEnd(page)
  await expect.poll(async () => (await counts(page)).plays).toBeGreaterThan(0)
})

test.describe('without motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('/started holds, plays and enters nothing', async ({ page }) => {
    await page.goto('/started')
    await hydrated(page)
    await scrollToEnd(page)
    expect(await counts(page)).toEqual({ holds: 0, plays: 0, unplayed: 0 })
    const entrances = await entranceAnimations(page)
    expect(entrances.length).toBeGreaterThan(0)
    expect(entrances.every((name) => name === 'none')).toBe(true)
  })
})
