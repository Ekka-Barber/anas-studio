// P04 part 2 end-to-end: post lifecycle, taxonomy publishing, room
// edit/preview/publish/restore, the social links in the site settings (C09),
// the scenes gallery (C05), and version-conflict handling, against
// `next dev` and the local Supabase stack. Uses the same local-only owner
// pattern as `auth.spec.ts`. D32: documents open at `edit?id=`, the draft
// preview is an admin page, and publishing requests a site rebuild (the
// public pages under `next dev` render live data, so a publish shows at once).
import { expect, test } from '@playwright/test'

import { Client } from 'pg'

import { typeset } from '../../src/lib/format'

import { anonClient, createOwner, restoreLive, signInByCode, SITE_ORIGIN, status, tomorrowRiyadhLocal } from './helpers'

const CONFLICT_MESSAGE = 'تغيّر هذا المستند منذ فتحته. نصّك محفوظ هنا؛ حمّل آخر نسخة ثم أعد التعديل.'
/** `src/admin/richtext.ts`'s `TEXT_FORMAT_BOLD`: bit 0 of Lexical's format bitmask. */
const TEXT_FORMAT_BOLD = 1
const BOLD_WORD = 'مهم'
const COVER_IMAGE_ID = '01-started-mothers-kitchen'
/** A committed image that is not among the scenes. */
const SCENE_IMAGE_ID = 'started-street-4'

async function isPublished(collection: string, docId: string): Promise<boolean> {
  const { data, error } = await anonClient()
    .from('published_documents')
    .select('doc_id')
    .eq('collection', collection)
    .eq('doc_id', docId)
  if (error) throw new Error(`isPublished: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * What a test must undo whether it passes or fails (S21.2): each edit test
 * registers the SQL that puts its document back, and afterEach runs it. A failed
 * test then never leaves test content published, or saved as the draft the
 * next run's editor opens.
 */
const cleanups: Array<() => Promise<void>> = []
test.afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((run) => run()))
})

/** Takes a document off the site through SQL (archive_document needs a publisher's JWT). */
async function unpublish(collection: string, docId: string): Promise<void> {
  const db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  try {
    await db.query('delete from public.published_documents where collection = $1::public.content_collection and doc_id = $2', [
      collection,
      docId,
    ])
    await db.query('update public.content_versions set publish_at = null where collection = $1::public.content_collection and doc_id = $2', [
      collection,
      docId,
    ])
  } finally {
    await db.end()
  }
}

interface RichTextNode {
  type: string
  text?: string
  format?: number
  children?: RichTextNode[]
}

/** Depth-first search for a `text` node with the given text and a bold format bit. */
function findBoldText(node: RichTextNode, text: string): boolean {
  if (node.type === 'text' && node.text === text) return ((node.format ?? 0) & TEXT_FORMAT_BOLD) !== 0
  return (node.children ?? []).some((child) => findBoldText(child, text))
}

async function createAndPublishTaxonomy(
  page: import('@playwright/test').Page,
  slug: string,
  kind: 'category' | 'tag',
  label: string,
): Promise<void> {
  await page.goto('/admin/content/taxonomies')
  await page.getByLabel('معرّف جديد').fill(slug)
  await page.getByRole('button', { name: 'جديد' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/content/taxonomies/edit\\?id=${slug}$`))
  if (kind === 'tag') await page.getByLabel('النوع').selectOption('tag')
  await page.getByLabel('التسمية').fill(label)
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
}

/** Creates a visible post with a body under `category`, publishes it and returns its document id. */
async function publishPost(
  page: import('@playwright/test').Page,
  { slug, title, category }: { slug: string; title: string; category: string },
): Promise<string> {
  await page.goto('/admin/content/posts')
  await page.getByRole('button', { name: 'جديد' }).click()
  await expect(page).toHaveURL(/\/admin\/content\/posts\/edit\?id=[0-9a-f-]{36}$/)
  const docId = page.url().match(/id=([0-9a-f-]{36})$/)?.[1]
  if (!docId) throw new Error('No post id in URL')
  await page.getByLabel('المعرّف').fill(slug)
  await page.getByLabel('العنوان').fill(title)
  await page.getByLabel('مقتطف').fill('مقتطف الاختبار')
  await page.getByLabel('الكاتب').fill('الكاتب')
  const editor = page.getByLabel('محرر النص المنسق')
  await editor.click()
  await editor.pressSequentially('نص المقال الثاني')
  await page.getByLabel(category).check()
  await page.getByLabel('ظاهر').check()
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  return docId
}

test('post lifecycle: taxonomies, rich text, relations, cover, schedule, publish, archive, restore', async ({
  page,
  browser,
}) => {
  // Three taxonomies, two posts and the public journal on top of the lifecycle.
  test.setTimeout(180_000)
  const email = await createOwner('ناشر الاختبار')
  await signInByCode(page, email)

  const stamp = Date.now()
  const categoryLabel = `فئة الاختبار ${stamp}`
  const tagLabel = `وسم الاختبار ${stamp}`
  await createAndPublishTaxonomy(page, `e2e-category-${stamp}`, 'category', categoryLabel)
  await createAndPublishTaxonomy(page, `e2e-tag-${stamp}`, 'tag', tagLabel)

  await page.goto('/admin/content/posts')
  await page.getByRole('button', { name: 'جديد' }).click()
  await expect(page).toHaveURL(/\/admin\/content\/posts\/edit\?id=[0-9a-f-]{36}$/)
  const docId = page.url().match(/id=([0-9a-f-]{36})$/)?.[1]
  if (!docId) throw new Error('No post id in URL')
  cleanups.push(() => unpublish('posts', docId))

  const title = `مقال الاختبار ${stamp}`
  await page.getByLabel('المعرّف').fill(`e2e-post-${stamp}`)
  await page.getByLabel('العنوان').fill(title)
  await page.getByLabel('مقتطف').fill('مقتطف الاختبار')
  await page.getByLabel('الكاتب').fill('الكاتب')

  const editor = page.getByLabel('محرر النص المنسق')
  await editor.click()
  await editor.pressSequentially(BOLD_WORD)
  await editor.press('Control+a')
  await page.getByRole('button', { name: 'غامق' }).click()

  await page.getByLabel(categoryLabel).check()
  await page.getByLabel(tagLabel).check()

  await page.getByRole('button', { name: 'إضافة صورة' }).click()
  await page.getByLabel('صورة الغلاف').fill(COVER_IMAGE_ID)

  await page.getByLabel('ظاهر').check()

  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(false)

  // Schedule for tomorrow (Riyadh time): still absent, list shows مجدول.
  await page.getByLabel('موعد الجدولة').fill(tomorrowRiyadhLocal())
  await page.getByRole('button', { name: 'جدولة' }).click()
  await expect(page.getByText('جدولة: تم بنجاح.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(false)

  await page.goto('/admin/content/posts')
  const row = page.getByRole('row', { name: new RegExp(title) })
  await expect(row.getByText('مجدول', { exact: false })).toBeVisible()
  await row.getByRole('link', { name: title }).click()

  // Cancel the schedule, then publish: present, with the bold word stored.
  await page.getByRole('button', { name: 'إلغاء الجدولة' }).click()
  await expect(page.getByText('إلغاء الجدولة: تم بنجاح.')).toBeVisible()

  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(true)

  const { data: published, error: publishedError } = await anonClient()
    .from('published_documents')
    .select('data')
    .eq('collection', 'posts')
    .eq('doc_id', docId)
    .single()
  if (publishedError || !published) throw new Error(`published read: ${publishedError?.message}`)
  const body = (published.data as { body: { root: RichTextNode } }).body
  expect(findBoldText(body.root, BOLD_WORD)).toBe(true)

  // The journal (P01, C16): a second post in a second category, then the public
  // list, its category filter and the article page read both published posts.
  const secondCategory = `فئة ثانية ${stamp}`
  const secondTitle = `مقال ثانٍ ${stamp}`
  await createAndPublishTaxonomy(page, `e2e-category-b-${stamp}`, 'category', secondCategory)
  const secondDocId = await publishPost(page, { slug: `e2e-post-b-${stamp}`, title: secondTitle, category: secondCategory })
  cleanups.push(() => unpublish('posts', secondDocId))
  // `next dev` answers a generateStaticParams page from the params it cached, so
  // a new slug is a 404 until it has seen it (I38); the static export has no such cache.
  await expect
    .poll(async () => (await fetch(`${SITE_ORIGIN}/journal/e2e-post-${stamp}`)).status, { timeout: 60_000 })
    .toBe(200)
  const journalContext = await browser.newContext()
  try {
    const journal = await journalContext.newPage()
    await journal.goto('/journal')
    // Newest first: the second post is the lead card, and both posts are listed.
    await expect(journal.getByRole('main').locator('ol > li').first()).toContainText(secondTitle)
    await expect(journal.getByRole('heading', { name: title })).toBeVisible()
    // The filter is a client component: click again until it has hydrated.
    const toggle = journal.getByRole('group', { name: 'التصنيفات' }).getByRole('button', { name: categoryLabel })
    await expect(async () => {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    await expect(journal.getByRole('heading', { name: title })).toBeVisible()
    await expect(journal.getByRole('heading', { name: secondTitle })).toHaveCount(0)
    // The article page: title, the bold word, the author and the category.
    await journal.getByRole('link', { name: new RegExp(title) }).click()
    await expect(journal).toHaveURL(new RegExp(`/journal/e2e-post-${stamp}$`))
    await expect(journal.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(journal.locator('article strong', { hasText: BOLD_WORD })).toBeVisible()
    await expect(journal.getByText('الكاتب', { exact: true })).toBeVisible()
    await expect(journal.getByText(categoryLabel, { exact: true })).toBeVisible()
  } finally {
    await journalContext.close()
  }
  // Back to the first post for the archive and restore steps.
  await page.goto(`/admin/content/posts/edit?id=${docId}`)

  // Archive: absent again.
  await page.getByRole('button', { name: 'أرشفة' }).click()
  await expect(page.getByText('أرشفة: تم بنجاح.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(false)

  // Restore the earlier version from the history, publish: present again.
  const historyTable = page.locator('table')
  await historyTable.locator('tbody tr').last().getByRole('button', { name: 'استعادة' }).click()
  await expect(historyTable.locator('tbody tr')).toHaveCount(2)

  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(true)

  // Archive it at the end.
  await page.getByRole('button', { name: 'أرشفة' }).click()
  await expect(page.getByText('أرشفة: تم بنجاح.')).toBeVisible()
  expect(await isPublished('posts', docId)).toBe(false)
})

test('room: edit, preview, publish, restore (requires pnpm db:import)', async ({ page, context, browser }) => {
  const email = await createOwner('محرر الغرف')
  await signInByCode(page, email)

  // The version live before this test edits anything: the one it restores at
  // the end (the oldest row can predate the current room fields, D39).
  const liveAtStart = new Client({ connectionString: status.DB_URL })
  await liveAtStart.connect()
  const live = await liveAtStart.query<{ seq: number }>(
    "select seq from public.published_documents where collection = 'rooms' and doc_id = 'started'",
  )
  await liveAtStart.end()
  const originalSeq = String(live.rows[0]!.seq)
  cleanups.push(() => restoreLive('rooms', 'started', Number(originalSeq)))

  await page.goto('/admin/content/rooms/edit?id=started')
  const heroLine = page.getByLabel('سطر البداية')
  const original = await heroLine.inputValue()
  // The site typesets Anas's punctuation (D39), so the page shows this form.
  const originalOnPage = typeset(original)
  expect(original.length).toBeGreaterThan(0)
  const updated = `سطر معدّل ${Date.now()}`
  await heroLine.fill(updated)

  // Move the second movement (2018) up, ahead of the first (2013). Scoped to
  // each item's own direct div (`> div`) and its trailing button row
  // (`.last()`), because a movement also nests a `paragraphs` field with its
  // own "أعلى" buttons per paragraph.
  const movementsGroup = page.getByRole('group', { name: 'المحطّات' })
  const movementItems = movementsGroup.locator('> div')
  const secondItem = movementItems.nth(1)
  const secondYear = await secondItem.locator('input[id$="-year"]').inputValue()
  await secondItem.getByRole('button', { name: 'أعلى' }).last().click()
  await expect(movementItems.first().locator('input[id$="-year"]')).toHaveValue(secondYear)

  // Hide the second reel (45-animated-pottery-signature), one of the seven the
  // page shows.
  const reelsGroup = page.getByRole('group', { name: 'المقاطع' })
  await reelsGroup.getByRole('checkbox', { name: 'إخفاء' }).nth(1).check()

  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()

  // The draft preview is an admin page (D32): the saved draft, drawn with the
  // public room's own view.
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('link', { name: 'معاينة' }).click()
  const preview = await popupPromise
  await preview.waitForLoadState()
  await expect(preview).toHaveURL(/\/admin\/preview\?id=started$/)
  await expect(preview.getByText('معاينة المسودة', { exact: false })).toBeVisible()
  await expect(preview.getByText(updated)).toBeVisible()
  await preview.close()

  // The public page still shows the published line.
  const visitorContext = await browser.newContext()
  const visitorPage = await visitorContext.newPage()
  await visitorPage.goto('/started')
  await expect(visitorPage.getByText(originalOnPage)).toBeVisible()
  await visitorContext.close()

  // Publishing asks for a site rebuild (finance.site_builds, read as the
  // local superuser).
  const db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  await db.query('update finance.site_builds set requested_at = null where id = 1')
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح. يظهر التعديل على الموقع خلال دقائق.')).toBeVisible()
  const requested = await db.query<{ requested_at: Date | null }>('select requested_at from finance.site_builds')
  expect(requested.rows[0]!.requested_at).not.toBeNull()
  await db.end()

  const publishedContext = await browser.newContext()
  const publishedPage = await publishedContext.newPage()
  await publishedPage.goto('/started')
  await expect(publishedPage.getByText(updated)).toBeVisible()
  await expect(publishedPage.locator('#year-0-title')).toHaveText(secondYear)
  // The picture moves with its year (it is the movement's own field), and
  // the hidden film is gone while its sibling stays.
  await expect(publishedPage.locator('#year-0 img[src*="31-murady-french-toast-banana"]')).toHaveCount(1)
  await expect(publishedPage.locator('source[src*="45-animated-pottery-signature"]')).toHaveCount(0)
  await expect(publishedPage.locator('source[src*="44-animated-kitchen"]')).toHaveCount(1)
  await publishedContext.close()

  // Restore the version that was live at the start and publish it: the
  // database is left as found.
  const historyTable = page.locator('table')
  await historyTable
    .locator('tbody tr')
    .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${originalSeq}$`) }) })
    .getByRole('button', { name: 'استعادة' })
    .click()
  await expect(heroLine).toHaveValue(original)
  // The edit was saved, so nothing is offered as unsaved work after the
  // restore (the copy a save removed once came back and was offered here).
  await expect(page.getByText('يوجد تعديل غير محفوظ محليًا لهذا المستند.')).toHaveCount(0)

  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  const restoredContext = await browser.newContext()
  const restoredPage = await restoredContext.newPage()
  await restoredPage.goto('/started')
  await expect(restoredPage.getByText(originalOnPage)).toBeVisible()
  await restoredContext.close()
})

test('editor: a local copy is offered before anything is editable, survives a reload, and leaves on تجاهل or opens on استرجاع (requires pnpm db:import)', async ({
  page,
}) => {
  const email = await createOwner('محرر النسخة المحلية')
  await signInByCode(page, email)

  // Same key and shape as CollectionForm's autosave; no userId, like a copy
  // written before the field existed, which is offered to whoever opens it.
  const key = 'anasaq:draft:rooms:started'
  const localLine = `سطر محلي ${Date.now()}`
  const seed = () =>
    page.evaluate(
      ({ storageKey, line }) =>
        window.localStorage.setItem(storageKey, JSON.stringify({ baseSeq: 1, data: { heroLine: line }, savedAt: Date.now() })),
      { storageKey: key, line: localLine },
    )
  const stored = () => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key)
  const offer = page.getByRole('heading', { name: 'يوجد تعديل غير محفوظ محليًا لهذا المستند.' })
  const heroLine = page.getByLabel('سطر البداية')

  await page.goto('/admin/content/rooms/edit?id=started')
  await expect(heroLine).toBeVisible()
  await seed()
  await page.reload()
  await expect(offer).toBeVisible()
  // Nothing can be edited or saved over the copy while it is on offer.
  await expect(heroLine).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toHaveCount(0)

  // A reload is not an answer: the copy is offered again and still stored.
  await page.reload()
  await expect(offer).toBeVisible()
  expect(await stored()).not.toBeNull()

  // تجاهل removes the copy and opens the saved version.
  await page.getByRole('button', { name: 'تجاهل', exact: true }).click()
  await expect(offer).toHaveCount(0)
  await expect(heroLine).toBeVisible()
  await expect(heroLine).not.toHaveValue(localLine)
  await expect.poll(stored).toBeNull()

  // استرجاع opens the form with the copy's text; nothing is saved.
  await seed()
  await page.reload()
  await expect(offer).toBeVisible()
  await page.getByRole('button', { name: 'استرجاع', exact: true }).click()
  await expect(offer).toHaveCount(0)
  await expect(heroLine).toHaveValue(localLine)
  await page.evaluate((storageKey) => window.localStorage.removeItem(storageKey), key)
})

test('social links: edit, add, reorder and publish; the footer and contact page follow (requires pnpm db:import)', async ({
  page,
  browser,
}) => {
  const email = await createOwner('محرر الروابط')
  await signInByCode(page, email)

  // The version live before this test edits anything: the one it restores at the end.
  const liveAtStart = new Client({ connectionString: status.DB_URL })
  await liveAtStart.connect()
  const live = await liveAtStart.query<{ seq: number }>(
    "select seq from public.published_documents where collection = 'site_settings' and doc_id = 'site'",
  )
  await liveAtStart.end()
  const originalSeq = String(live.rows[0]!.seq)
  cleanups.push(() => restoreLive('site_settings', 'site', Number(originalSeq)))

  await page.goto('/admin/content/site_settings/edit?id=site')
  const socialGroup = page.getByRole('group', { name: 'روابط التواصل' })
  const items = socialGroup.locator('> div')
  await expect(items).toHaveCount(4)
  const readItem = async (index: number) => ({
    network: await items.nth(index).getByLabel('الشبكة').inputValue(),
    handle: await items.nth(index).getByLabel('المعرّف').inputValue(),
    href: await items.nth(index).getByLabel('الرابط').inputValue(),
  })
  const original = [await readItem(0), await readItem(1), await readItem(2), await readItem(3)]

  // Change the first channel's handle and link.
  const stamp = Date.now()
  const edited = { ...original[0]!, handle: `@e2e.${stamp}`, href: `https://www.instagram.com/e2e.${stamp}` }
  await items.nth(0).getByLabel('المعرّف').fill(edited.handle)
  await items.nth(0).getByLabel('الرابط').fill(edited.href)

  // Add a fifth channel. A link that is not https is refused before publishing.
  const added = { network: 'يوتيوب', handle: `@yt.${stamp}`, href: `https://www.youtube.com/@yt.${stamp}` }
  await socialGroup.getByRole('button', { name: 'أضف عنصرًا' }).click()
  await expect(items).toHaveCount(5)
  await items.nth(4).getByLabel('الشبكة').fill(added.network)
  await items.nth(4).getByLabel('المعرّف').fill(added.handle)
  await items.nth(4).getByLabel('الرابط').fill(added.href.replace('https:', 'http:'))
  // The error names the item and its field (AUDIT-2 FIX-admin-3).
  await expect(page.getByText(/^روابط التواصل › 5 › الرابط: الرابط غير صالح./)).toBeVisible()
  await items.nth(4).getByLabel('الرابط').fill(added.href)
  await expect(page.getByText('هناك مشاكل في البيانات:')).toHaveCount(0)

  // Move it up one place, ahead of the fourth.
  await items.nth(4).getByRole('button', { name: 'أعلى' }).click()
  await expect(items.nth(3).getByLabel('الشبكة')).toHaveValue(added.network)
  const expected = [edited, original[1]!, original[2]!, added, original[3]!]

  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // Under next dev the public pages render the published data at once: the
  // change shows with no code change.
  const visitorContext = await browser.newContext()
  const visitor = await visitorContext.newPage()
  await visitor.goto('/contact')
  const tiles = visitor.getByRole('list', { name: 'قنوات التواصل' }).locator('a:has(span[dir="ltr"])')
  await expect(tiles).toHaveCount(expected.length)
  for (const [index, link] of expected.entries()) {
    await expect(tiles.nth(index)).toHaveAttribute('href', link.href)
    await expect(tiles.nth(index).locator('span').first()).toHaveText(link.network)
    await expect(tiles.nth(index).locator('span[dir="ltr"]')).toHaveText(link.handle)
  }
  const footerLink = visitor.locator('footer').getByRole('link', { name: `${edited.network}: ${edited.handle}`, exact: true })
  await expect(footerLink).toHaveAttribute('href', edited.href)
  await expect(footerLink).toHaveText(edited.handle)
  await visitorContext.close()

  // Restore the version that was live at the start and publish it: the
  // database is left as found.
  await page
    .locator('table tbody tr')
    .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${originalSeq}$`) }) })
    .getByRole('button', { name: 'استعادة' })
    .click()
  await expect(items).toHaveCount(4)
  await expect(items.nth(0).getByLabel('المعرّف')).toHaveValue(original[0]!.handle)
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  const restoredContext = await browser.newContext()
  const restoredPage = await restoredContext.newPage()
  await restoredPage.goto('/contact')
  await expect(restoredPage.getByRole('list', { name: 'قنوات التواصل' }).locator('a:has(span[dir="ltr"])')).toHaveCount(4)
  await expect(
    restoredPage.locator('footer').getByRole('link', { name: `${original[0]!.network}: ${original[0]!.handle}`, exact: true }),
  ).toHaveAttribute('href', original[0]!.href)
  await restoredContext.close()
})

test('book page, home doors and contact page: edit and publish; the pages follow (requires pnpm db:import)', async ({
  page,
  browser,
}) => {
  const email = await createOwner('محرر الصفحات')
  await signInByCode(page, email)

  // The versions live before this test edits anything: the ones it restores at the end.
  const liveAtStart = new Client({ connectionString: status.DB_URL })
  await liveAtStart.connect()
  const live = await liveAtStart.query<{ collection: string; seq: number }>(
    "select collection, seq from public.published_documents where (collection, doc_id) in (('rooms', 'book'), ('site_settings', 'site'))",
  )
  await liveAtStart.end()
  const bookSeq = live.rows.find((row) => row.collection === 'rooms')!.seq
  const siteSeq = live.rows.find((row) => row.collection === 'site_settings')!.seq
  cleanups.push(() => restoreLive('rooms', 'book', bookSeq))
  cleanups.push(() => restoreLive('site_settings', 'site', siteSeq))
  const stamp = Date.now()

  // The book page (D44): rename the first character.
  await page.goto('/admin/content/rooms/edit?id=book')
  const characters = page.getByRole('group', { name: 'الشخصيات' }).locator('> div')
  await expect(characters).toHaveCount(4)
  const character = `شخصية ${stamp}`
  await characters.nth(0).getByLabel('الاسم').fill(character)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // The home doors and the contact page: rename the first door, move the last
  // one (تواصل) up a place, and retitle the services.
  await page.goto('/admin/content/site_settings/edit?id=site')
  const doors = page.getByRole('group', { name: 'أبواب الغرف' }).locator('> div')
  await expect(doors).toHaveCount(8)
  const door = `باب ${stamp}`
  await doors.nth(0).getByLabel('العنوان', { exact: true }).fill(door)
  const lastTitle = await doors.nth(7).getByLabel('العنوان', { exact: true }).inputValue()
  await doors.nth(7).getByRole('button', { name: 'أعلى' }).click()
  await expect(doors.nth(6).getByLabel('العنوان', { exact: true })).toHaveValue(lastTitle)
  const servicesTitle = `استشارات ${stamp}`
  await page.getByRole('group', { name: 'صفحة التواصل' }).getByLabel('عنوان الاستشارات').fill(servicesTitle)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // Under next dev the public pages render the published data at once.
  const visitorContext = await browser.newContext()
  const visitor = await visitorContext.newPage()
  await visitor.goto('/book')
  await expect(visitor.locator('#characters h3').first()).toHaveText(character)
  await visitor.goto('/')
  const doorTitles = visitor.locator('ol li a[data-tone] h3')
  await expect(doorTitles).toHaveCount(8)
  await expect(doorTitles.nth(0)).toHaveText(door)
  await expect(doorTitles.nth(6)).toHaveText(lastTitle)
  await visitor.goto('/contact')
  await expect(visitor.locator('#services-title')).toHaveText(servicesTitle)
  await visitorContext.close()
})

test('scenes: add, move first, hide and publish; the scenes page follows (requires pnpm db:import)', async ({
  page,
  browser,
}) => {
  const email = await createOwner('محرر المشاهد')
  await signInByCode(page, email)

  // The version live before this test edits anything: the one it restores at the end.
  const liveAtStart = new Client({ connectionString: status.DB_URL })
  await liveAtStart.connect()
  const live = await liveAtStart.query<{ seq: number }>(
    "select seq from public.published_documents where collection = 'scenes' and doc_id = 'gallery'",
  )
  await liveAtStart.end()
  const originalSeq = String(live.rows[0]!.seq)
  cleanups.push(() => restoreLive('scenes', 'gallery', Number(originalSeq)))

  // The gallery is one fixed document under المحتوى.
  await page.goto('/admin/content')
  await page.getByRole('link', { name: 'المَشاهد' }).click()
  await page.getByRole('row', { name: /المَشاهد/ }).getByRole('link').click()
  await expect(page).toHaveURL(/\/admin\/content\/scenes\/edit\?id=gallery$/)

  const photos = page.getByRole('group', { name: 'الصور' })
  const items = photos.locator('> div')
  await expect(items).toHaveCount(19)
  const firstCaption = await items.nth(0).getByLabel('التعليق').inputValue()
  expect(firstCaption.length).toBeGreaterThan(0)

  // Add a photo from the committed images, filed under رحلات: the one
  // category with no photo yet, so the page has no filter for it until now.
  const caption = `مشهد الاختبار ${Date.now()}`
  await photos.getByRole('button', { name: 'أضف عنصرًا' }).click()
  await expect(items).toHaveCount(20)
  const added = items.nth(19)
  await added.getByLabel('الصورة').fill(SCENE_IMAGE_ID)
  await added.getByLabel('التصنيف').selectOption('رحلات')
  await added.getByLabel('التعليق').fill(caption)
  await expect(page.getByText('هناك مشاكل في البيانات:')).toHaveCount(0)

  // Move it first, one place at a time, then hide the photo that was first.
  for (let index = 19; index > 0; index -= 1) {
    await items.nth(index).getByRole('button', { name: 'أعلى' }).click()
  }
  await expect(items.nth(0).getByLabel('التعليق')).toHaveValue(caption)
  await expect(items.nth(1).getByLabel('التعليق')).toHaveValue(firstCaption)
  await items.nth(1).getByRole('checkbox', { name: 'إخفاء' }).check()

  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // Under next dev the public page renders the published gallery at once.
  const tiles = (visitor: import('@playwright/test').Page) => visitor.getByRole('button', { name: /^تكبير:/ })
  const filters = (visitor: import('@playwright/test').Page) => visitor.getByRole('group', { name: 'تصفية المشاهد' })
  const visitorContext = await browser.newContext()
  const visitor = await visitorContext.newPage()
  await visitor.goto('/scenes')
  await expect(tiles(visitor)).toHaveCount(19)
  await expect(tiles(visitor).first()).toHaveAccessibleName(`تكبير: ${caption}`)
  await expect(tiles(visitor).first().locator(`img[src*="${SCENE_IMAGE_ID}"]`)).toHaveCount(1)
  await expect(visitor.getByRole('button', { name: `تكبير: ${firstCaption}`, exact: true })).toHaveCount(0)
  await expect(filters(visitor).getByRole('button', { name: 'رحلات' })).toBeVisible()
  await visitorContext.close()

  // Restore the version that was live at the start and publish it: the
  // database is left as found.
  await page
    .locator('table tbody tr')
    .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${originalSeq}$`) }) })
    .getByRole('button', { name: 'استعادة' })
    .click()
  await expect(items).toHaveCount(19)
  await expect(items.nth(0).getByLabel('التعليق')).toHaveValue(firstCaption)
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  const restoredContext = await browser.newContext()
  const restored = await restoredContext.newPage()
  await restored.goto('/scenes')
  await expect(tiles(restored)).toHaveCount(19)
  await expect(tiles(restored).first()).toHaveAccessibleName(`تكبير: ${firstCaption}`)
  await expect(restored.getByText(caption)).toHaveCount(0)
  await expect(filters(restored).getByRole('button', { name: 'رحلات' })).toHaveCount(0)
  await restoredContext.close()
})

test('a stale save is rejected with a conflict message and keeps the typed text', async ({ browser }) => {
  const email = await createOwner('مالك التعارض')
  const context1 = await browser.newContext()
  const context2 = await browser.newContext()
  const page1 = await context1.newPage()
  const page2 = await context2.newPage()

  await signInByCode(page1, email)
  await page1.goto('/admin/content/posts')
  await page1.getByRole('button', { name: 'جديد' }).click()
  await page1.getByLabel('المعرّف').fill(`e2e-conflict-${Date.now()}`)
  await page1.getByLabel('العنوان').fill('نسخة أولى')
  await page1.getByLabel('مقتطف').fill('مقتطف الاختبار')
  await page1.getByLabel('الكاتب').fill('الكاتب')
  await page1.getByRole('button', { name: 'حفظ' }).click()
  await expect(page1.getByText('تم الحفظ.')).toBeVisible()
  const docUrl = page1.url()

  await signInByCode(page2, email)
  await page2.goto(docUrl)
  await expect(page2.getByLabel('العنوان')).toHaveValue('نسخة أولى')

  await page1.getByLabel('العنوان').fill('نسخة ثانية من التبويب الأول')
  await page1.getByRole('button', { name: 'حفظ' }).click()
  await expect(page1.getByText('تم الحفظ.')).toBeVisible()

  const staleTitle = 'نسخة ثانية من التبويب الثاني'
  await page2.getByLabel('العنوان').fill(staleTitle)
  await page2.getByRole('button', { name: 'حفظ' }).click()
  await expect(page2.getByText(CONFLICT_MESSAGE)).toBeVisible()
  await expect(page2.getByLabel('العنوان')).toHaveValue(staleTitle)

  await context1.close()
  await context2.close()
})
