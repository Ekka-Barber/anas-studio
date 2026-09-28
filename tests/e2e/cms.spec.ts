// P04 part 2 end-to-end: post lifecycle, taxonomy publishing, room
// edit/preview/publish/restore, and version-conflict handling, against
// `next dev` and the local Supabase stack. Uses the same local-only owner
// pattern as `auth.spec.ts`. D32: documents open at `edit?id=`, the draft
// preview is an admin page, and publishing requests a site rebuild (the
// public pages under `next dev` render live data, so a publish shows at once).
import { expect, test } from '@playwright/test'

import { Client } from 'pg'

import { typeset } from '../../src/lib/format'

import { anonClient, createOwner, signInByCode, status, tomorrowRiyadhLocal } from './helpers'

const CONFLICT_MESSAGE = 'تغيّر هذا المستند منذ فتحته. نصّك محفوظ هنا؛ حمّل آخر نسخة ثم أعد التعديل.'
/** `src/admin/richtext.ts`'s `TEXT_FORMAT_BOLD`: bit 0 of Lexical's format bitmask. */
const TEXT_FORMAT_BOLD = 1
const BOLD_WORD = 'مهم'
const COVER_IMAGE_ID = '01-started-mothers-kitchen'

async function isPublished(collection: string, docId: string): Promise<boolean> {
  const { data, error } = await anonClient()
    .from('published_documents')
    .select('doc_id')
    .eq('collection', collection)
    .eq('doc_id', docId)
  if (error) throw new Error(`isPublished: ${error.message}`)
  return (data?.length ?? 0) > 0
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

test('post lifecycle: taxonomies, rich text, relations, cover, schedule, publish, archive, restore', async ({
  page,
}) => {
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

  // Hide the second reel (45-animated-pottery-signature), one of the two the
  // page shows (the five with children stay hidden until consent, D39).
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
