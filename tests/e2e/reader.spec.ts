import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * P02: the book preview on /book, a 4:5 Arabic hardcover. The closed book
 * loads nothing until it is opened, and opening never moves the page; the
 * reader then fetches only the approved preview (never a whole book), turns
 * in Arabic order (← is the next page) through endpapers and parts that start
 * on left-hand pages, keeps canvases to the spreads around the reader, fades
 * without motion, turns one page at a time on a phone, has a reading view and
 * full screen, and says so when the file fails. Synthetic fixtures
 * (tests/fixtures/reader/) cover one page, an odd count and a corrupt file.
 *
 * The preview's spreads: [cover] [endpaper | 1 الإهداء] [blank | 2 المقدمة]
 * [3 | 4 «صورة الروضة»] [5 | end] [blank | endpaper] [back].
 */

const manifest = JSON.parse(readFileSync(path.resolve('content/book-source-manifest.json'), 'utf8')) as {
  output: { url: string; sha256: string }
}
const PREVIEW = manifest.output.url
const FIXTURES = path.resolve('tests/fixtures/reader')

function watchRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (request) => urls.push(new URL(request.url()).pathname))
  return urls
}

async function openBook(page: Page) {
  await page.goto('/book#pages')
  await page.getByRole('button', { name: 'افتح الكتاب' }).click()
  await expect(page.getByRole('group', { name: 'صفحات من خوص' })).toBeVisible()
}

const where = (page: Page) => page.locator('#pages [aria-live="polite"]')

async function drawnCanvases(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('#pages canvas')].filter((canvas) => (canvas as HTMLCanvasElement).width > 0).length)
}

/** The leaves on screen (page-flip hides the others), right to left, with their corner hints and box. */
function shownLeaves(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#pages .stf__item')]
      .filter((leaf) => getComputedStyle(leaf).display !== 'none')
      .map((leaf) => {
        const box = leaf.getBoundingClientRect()
        return {
          kind: leaf.dataset.kind,
          corner: leaf.hasAttribute('data-corner'),
          cornerBack: leaf.hasAttribute('data-corner-back'),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }
      })
      .sort((a, b) => b.x - a.x),
  )
}

/** The turn has ended: page-flip is at rest again. */
async function atRest(page: Page) {
  await expect(page.locator('#pages .stf__parent')).not.toHaveAttribute('data-turning')
}

/** Brings the whole book on screen, so a click lands where it aims. */
async function bookInView(page: Page) {
  await page.getByRole('group', { name: 'صفحات من خوص' }).evaluate((book) => {
    const box = book.getBoundingClientRect()
    window.scrollBy({ top: box.top - (window.innerHeight - box.height) / 2, behavior: 'instant' })
  })
}

/** Records every text the page label shows from now on. */
async function recordLabels(page: Page) {
  await where(page).evaluate((label) => {
    const seen: string[] = []
    ;(window as unknown as { labels: string[] }).labels = seen
    new MutationObserver(() => seen.push(label.textContent ?? '')).observe(label, { childList: true, subtree: true, characterData: true })
  })
}

const recordedLabels = (page: Page) => page.evaluate(() => (window as unknown as { labels: string[] }).labels)

test.describe('the book preview', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the published preview is the approved export, byte for byte', () => {
    const bytes = readFileSync(path.resolve('public/book/khous-preview.pdf'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.output.sha256)
    expect(bytes.includes(Buffer.from('@gmail'))).toBe(false)
  })

  test('closed, it loads nothing; open, it fetches only the preview and reads right to left', async ({ page }) => {
    const urls = watchRequests(page)
    await page.goto('/book#pages')
    await expect(page.getByRole('button', { name: 'افتح الكتاب' })).toBeVisible()
    expect(urls.filter((url) => /\.pdf$|pdf\.worker|page-flip/.test(url))).toEqual([])

    await page.getByRole('button', { name: 'افتح الكتاب' }).click()
    const book = page.getByRole('group', { name: 'صفحات من خوص' })
    await expect(book).toBeFocused()
    // It opens itself from the cover: the endpaper on the right, the dedication on the left.
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await expect.poll(() => drawnCanvases(page)).toBeGreaterThanOrEqual(1)

    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/3–4 \/ 5/)
    // Bound on the right: page 3 is the right-hand page, page 4 faces it on the left.
    const left = (n: number) => page.locator(`#pages [data-page="${n}"]`).evaluate((leaf) => leaf.getBoundingClientRect().left)
    expect(await left(3)).toBeGreaterThan(await left(4))
    await page.keyboard.press('ArrowRight')
    await expect(where(page)).toHaveText(/2 \/ 5/)
    await page.keyboard.press('End')
    await expect(where(page)).toHaveText(/5 \/ 5/)
    await expect(page.locator('#pages').getByRole('link', { name: 'النسخ', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /التالية/ }).click()
    await expect(where(page)).toHaveText('نهاية الصفحات المتاحة')
    await page.getByRole('button', { name: /التالية/ }).click()
    await expect(page.getByRole('button', { name: /التالية/ })).toBeDisabled()

    await page.getByLabel('انتقل إلى').selectOption({ label: 'المقدمة' })
    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)
    expect(await drawnCanvases(page)).toBeLessThanOrEqual(6)

    const pdfs = urls.filter((url) => url.endsWith('.pdf'))
    expect(pdfs.length).toBeGreaterThan(0)
    expect(new Set(pdfs)).toEqual(new Set([PREVIEW]))
  })

  test('opening keeps the page still, the closed book centred on the stage', async ({ page }) => {
    await page.goto('/book#pages')
    const height = () => page.locator('#pages').evaluate((section) => Math.round(section.getBoundingClientRect().height))
    const closed = await height()
    const centre = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const box = el.getBoundingClientRect()
        return Math.round(box.left + box.width / 2)
      })
    const stage = await centre('#pages [class*="reader-module"][class*="book"]')
    expect(Math.abs((await centre('#pages [class*="closedBook"]')) - stage)).toBeLessThanOrEqual(2)
    await page.getByRole('button', { name: 'افتح الكتاب' }).click()
    await expect(where(page)).toHaveText(/1 \/ 5/)
    expect(Math.abs((await height()) - closed)).toBeLessThanOrEqual(2)
    // Closed again on its back cover, the book stands in the middle, and nothing scrolls sideways.
    await page.keyboard.press('End')
    await expect(where(page)).toHaveText(/5 \/ 5/)
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText('نهاية الصفحات المتاحة')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('button', { name: /التالية/ })).toBeDisabled()
    await expect.poll(async () => Math.abs((await centre('#pages [data-kind="back"]')) - stage)).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  })

  test('a part under the closed book opens the book at that part', async ({ page }) => {
    await page.goto('/book#pages')
    await page.getByRole('button', { name: 'من فصل «صورة الروضة»' }).click()
    await expect(where(page)).toHaveText(/3–4 \/ 5/)
  })

  test('the pages carry their text, for selection and screen readers', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 5/)
    // Screen readers get each page's text in reading order.
    const spoken = page.locator('#pages [data-page="1"] .visually-hidden')
    await expect(spoken).toContainText('إلى الأبواب التي أُغلقت منذ أعوام')
    await expect(page.locator('#pages [data-page="1"] .textLayer')).toHaveAttribute('aria-hidden', 'true')
    // The selectable layer has its lam-alef ligatures back in order.
    const selectable = () => page.evaluate(() => [...document.querySelectorAll('#pages .textLayer')].map((layer) => layer.textContent).join(' '))
    await expect.poll(selectable).toContain('الإهداء')
    expect(await selectable()).not.toMatch(/األ/)
  })

  test('a drag from the left page to the right turns to the next spread', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 5/)
    const box = (await page.getByRole('group', { name: 'صفحات من خوص' }).boundingBox())!
    const y = box.y + box.height * 0.85
    await page.mouse.move(box.x + box.width * 0.2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.55, y, { steps: 8 })
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 8 })
    await page.mouse.up()
    await expect(where(page)).toHaveText(/2 \/ 5/)
  })

  test('without motion a turn is a short fade, never a rotation', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 5/)
    // Record the book's fade as it happens (it lasts about 150ms).
    await page.locator('#pages [class*="flip"]').first().evaluate((el) => {
      const seen: string[] = []
      ;(window as unknown as { fadeLog: string[] }).fadeLog = seen
      new MutationObserver(() => seen.push(el.hasAttribute('data-fading') ? 'out' : 'in')).observe(el, { attributeFilter: ['data-fading'] })
    })
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/2 \/ 5/, { timeout: 600 })
    // The book dipped out for the turn, then came back in.
    await expect.poll(() => page.evaluate(() => (window as unknown as { fadeLog: string[] }).fadeLog)).toEqual(['out', 'in'])
    await context.close()
  })

  test('a resize redraws the pages at the new size', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 5/)
    await expect.poll(() => drawnCanvases(page)).toBeGreaterThanOrEqual(1)
    const widthOf = () => page.evaluate(() => Math.max(...[...document.querySelectorAll('#pages canvas')].map((canvas) => (canvas as HTMLCanvasElement).width)))
    const before = await widthOf()
    await page.setViewportSize({ width: 900, height: 900 })
    await expect.poll(widthOf).not.toBe(before)
  })

  test('full screen, then back', async ({ page }) => {
    await openBook(page)
    await page.getByRole('button', { name: 'ملء الشاشة' }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await page.getByRole('button', { name: 'الخروج من ملء الشاشة' }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  })

  test('the reading view opens at the page in view and ends with the way to the editions', async ({ page }) => {
    await openBook(page)
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/2 \/ 5/)
    await page.getByRole('button', { name: 'عرض للقراءة' }).click()
    const sheets = page.getByRole('list', { name: 'صفحات من خوص' })
    await expect(sheets.getByRole('listitem')).toHaveCount(5)
    await expect(page.locator('#pages [data-page="2"]')).toBeInViewport()
    // At reading size: a sheet 880px wide on a laptop.
    expect(await page.locator('#pages [data-page="2"]').evaluate((sheet) => Math.round(sheet.getBoundingClientRect().width))).toBe(880)
    await page.locator('#pages').getByRole('link', { name: 'النسخ', exact: true }).click()
    await expect(page).toHaveURL(/#editions$/)
  })

  test('an odd page count and a single page still make a book', async ({ page }) => {
    await page.route(`**${PREVIEW}`, (route) => route.fulfill({ contentType: 'application/pdf', body: readFileSync(path.join(FIXTURES, 'three-pages.pdf')) }))
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 3/)
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/2 \/ 3/)
    await page.keyboard.press('ArrowLeft')
    await expect(where(page)).toHaveText(/3 \/ 3/)
    await expect(page.locator('#pages').getByRole('link', { name: 'النسخ', exact: true })).toBeVisible()

    await page.unroute(`**${PREVIEW}`)
    await page.route(`**${PREVIEW}`, (route) => route.fulfill({ contentType: 'application/pdf', body: readFileSync(path.join(FIXTURES, 'one-page.pdf')) }))
    await page.goto('about:blank')
    await openBook(page)
    await expect(where(page)).toHaveText(/1 \/ 1/)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('#pages').getByRole('link', { name: 'النسخ', exact: true })).toBeVisible()
  })

  test('a corrupt or unreachable file says so, and a retry opens the book', async ({ page }) => {
    await page.route(`**${PREVIEW}`, (route) => route.fulfill({ contentType: 'application/pdf', body: readFileSync(path.join(FIXTURES, 'corrupt.pdf')) }))
    await page.goto('/book#pages')
    await page.getByRole('button', { name: 'افتح الكتاب' }).click()
    await expect(page.locator('#pages').getByRole('alert')).toContainText('تعذّر فتح الصفحات.')

    await page.unroute(`**${PREVIEW}`)
    await page.route(`**${PREVIEW}`, (route) => route.abort('internetdisconnected'))
    await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
    await expect(page.locator('#pages').getByRole('alert')).toContainText('تعذّر فتح الصفحات.')
    await expect(page.getByRole('link', { name: 'فتح الصفحات ملفاً (PDF)' })).toHaveAttribute('href', PREVIEW)

    await page.unroute(`**${PREVIEW}`)
    await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
    await expect(where(page)).toHaveText(/1 \/ 5/)
  })

  test('a click on a corner turns that page, and closing the book slides it with the turn', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await atRest(page)
    await bookInView(page)
    // Near the bottom outer corner of the left or the right page of the spread.
    const corner = async (side: 'left' | 'right') => {
      const [right, left] = await shownLeaves(page)
      const leaf = side === 'left' ? left! : right!
      await page.mouse.click(side === 'left' ? leaf.x + 12 : leaf.x + leaf.width - 12, leaf.y + leaf.height - 12)
    }

    await corner('left')
    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)
    await atRest(page)
    await corner('right')
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await atRest(page)

    // At the first spread the endpaper's corner closes the book, and the book
    // slides to the middle while the board swings, not after it.
    const book = page.locator('#pages .stf__parent')
    await expect(book).toHaveAttribute('data-at', 'open')
    await corner('right')
    await page.waitForTimeout(150)
    expect(await book.evaluate((el) => ({ turning: el.hasAttribute('data-turning'), at: (el as HTMLElement).dataset.at }))).toEqual({
      turning: true,
      at: 'front',
    })
    await expect(where(page)).toHaveText('الغلاف')
    await atRest(page)
  })
})

test.describe('one page at a time, by hand', () => {
  test.use({ viewport: { width: 390, height: 794 } })

  test('a click turns by the half it is on, and never stops on an empty leaf', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await atRest(page)
    await bookInView(page)
    await recordLabels(page)
    const clickAt = async (fraction: number) => {
      const [leaf] = await shownLeaves(page)
      await page.mouse.click(leaf!.x + leaf!.width * fraction, leaf!.y + leaf!.height * 0.3)
    }
    const landsOn = async (label: string | RegExp) => {
      await expect(where(page)).toHaveText(label)
      await atRest(page)
      const kinds = (await shownLeaves(page)).map((leaf) => leaf.kind)
      expect(kinds).toHaveLength(1)
      expect(['blank', 'endpaper']).not.toContain(kinds[0])
    }

    // The left half is the next page: 1 to 5, then the end of the preview.
    for (const label of [/المقدمة\s*2 \/ 5/, /3 \/ 5/, /4 \/ 5/, /5 \/ 5/, 'نهاية الصفحات المتاحة']) {
      await clickAt(0.25)
      await landsOn(label)
    }
    // The right half is the previous page, back to the dedication.
    for (const label of [/5 \/ 5/, /4 \/ 5/, /3 \/ 5/, /المقدمة\s*2 \/ 5/, /الإهداء\s*1 \/ 5/]) {
      await clickAt(0.75)
      await landsOn(label)
    }
    // Either side of the middle, not page-flip's own 40/60 split.
    await clickAt(0.45)
    await landsOn(/المقدمة\s*2 \/ 5/)
    await clickAt(0.55)
    await landsOn(/الإهداء\s*1 \/ 5/)
    expect(await recordedLabels(page)).not.toContain('')
  })

  test('a drag that would stop on the blank back carries on to the next page', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await atRest(page)
    await bookInView(page)
    await recordLabels(page)
    const [leaf] = await shownLeaves(page)
    const y = leaf!.y + leaf!.height * 0.95
    await page.mouse.move(leaf!.x + leaf!.width * 0.03, y)
    await page.mouse.down()
    await page.mouse.move(leaf!.x + leaf!.width * 0.5, y, { steps: 8 })
    await page.mouse.move(leaf!.x + leaf!.width * 0.98, y, { steps: 8 })
    await page.mouse.up()

    // Every 150ms for 2.5s after the release: the label and, at rest, the leaf on screen.
    const samples = await page.evaluate(
      () =>
        new Promise<{ label: string; turning: boolean; kinds: string[] }[]>((resolve) => {
          const out: { label: string; turning: boolean; kinds: string[] }[] = []
          const sample = () =>
            out.push({
              label: document.querySelector('#pages [aria-live="polite"]')?.textContent ?? '',
              turning: document.querySelector('#pages .stf__parent')?.hasAttribute('data-turning') ?? false,
              kinds: [...document.querySelectorAll<HTMLElement>('#pages .stf__item')]
                .filter((el) => getComputedStyle(el).display !== 'none')
                .map((el) => el.dataset.kind ?? ''),
            })
          const timer = window.setInterval(sample, 150)
          window.setTimeout(() => {
            window.clearInterval(timer)
            resolve(out)
          }, 2500)
        }),
    )
    expect(samples.length).toBeGreaterThanOrEqual(15)
    expect(samples.map((s) => s.label)).not.toContain('')
    const atRestKinds = samples.filter((s) => !s.turning).flatMap((s) => s.kinds)
    expect(atRestKinds).not.toContain('blank')
    expect(atRestKinds).not.toContain('endpaper')

    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)
    await atRest(page)
    expect((await shownLeaves(page)).map((shown) => shown.kind)).toEqual(['page'])
    expect(await recordedLabels(page)).not.toContain('')
  })

  test('the corner hints: forward on page 1, both ways from page 2', async ({ page }) => {
    await openBook(page)
    await expect(where(page)).toHaveText(/الإهداء\s*1 \/ 5/)
    await expect.poll(() => shownLeaves(page)).toMatchObject([{ kind: 'page', corner: true, cornerBack: false }])
    await page.getByRole('button', { name: /التالية/ }).click()
    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)
    await atRest(page)
    await expect.poll(() => shownLeaves(page)).toMatchObject([{ kind: 'page', corner: true, cornerBack: true }])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })

  test('the book turns one page at a time, and the reading view zooms', async ({ page }) => {
    await page.goto('/book#pages')
    await page.getByRole('button', { name: 'افتح الكتاب' }).click()
    await expect(where(page)).toHaveText(/1 \/ 5/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    // The blank back of the dedication is not a step of its own.
    await page.getByRole('button', { name: 'التالية' }).tap()
    await expect(where(page)).toHaveText(/المقدمة\s*2 \/ 5/)

    await page.getByRole('button', { name: 'عرض للقراءة' }).click()
    const sheets = page.getByRole('list', { name: 'صفحات من خوص' })
    await expect(sheets.getByRole('listitem')).toHaveCount(5)
    await expect(page.getByText('كبّر الصفحة بإصبعين لقراءة أوضح.')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  })
})

test('without JavaScript the closed book links to the preview itself', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/book')
  await expect(page.getByRole('link', { name: 'افتح الصفحات (PDF)' })).toHaveAttribute('href', PREVIEW)
  const response = await page.request.get(PREVIEW)
  expect(response.headers()['content-type']).toContain('application/pdf')
  await context.close()
})
