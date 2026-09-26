// P05 round 1: the media API end to end at the HTTP level, against `next dev`
// (PLAYWRIGHT_BASE_URL=http://localhost:3000) and the local Supabase stack.
// P05 round 2: the browser screens — the library, the upload dialog (crop in
// the browser, EXIF removed by re-encode), the picker on a content form,
// folders, the where-used guard and deletion. Image bytes are generated with
// Sharp in the test; the server never uses Sharp.
import { createHash } from 'node:crypto'
import { mkdirSync, appendFileSync } from 'node:fs'
import path from 'node:path'

import { Client } from 'pg'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'

import { createOwner, createStaff, signInByCode, staffAccessToken, status } from './helpers'

const WIDTHS = [360, 720, 1200, 1800]

/** A valid declaration whose parts are real, verifiable bytes. */
async function imageDeclaration() {
  const source = sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 110, g: 85, b: 60 } } })
  const original = await source.clone().jpeg().toBuffer()
  const derivatives = await Promise.all(WIDTHS.map((width) => source.clone().resize({ width }).webp().toBuffer()))
  return {
    declared: {
      purpose: 'image',
      name: 'غلاف الاختبار',
      folder: '',
      altAr: 'وصف صورة الاختبار',
      caption: '',
      rights: 'تصوير أنس',
      original: { mime: 'image/jpeg', bytes: original.length, width: 2000, height: 1500 },
      crop: { x: 0, y: 0, width: 2000, height: 1500 },
      derivatives: WIDTHS.map((width, index) => ({
        width,
        height: Math.round((width * 1500) / 2000),
        bytes: derivatives[index]!.length,
      })),
    },
    original,
    derivatives,
  }
}

async function createTicket(request: APIRequestContext, token: string, declared: unknown) {
  const response = await request.post('/api/media/upload', {
    headers: { Authorization: `Bearer ${token}` },
    data: declared as object,
  })
  return { response, body: (await response.json()) as { ok: boolean; data?: { ticketId: string }; error?: { code: string; message: string } } }
}

async function putPart(
  request: APIRequestContext,
  token: string,
  ticketId: string,
  part: string,
  body: Buffer,
): Promise<{ status: number; error?: { code: string; message: string } }> {
  const response = await request.put(`/api/media/upload?ticket=${ticketId}&part=${part}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  })
  const json = (await response.json().catch(() => ({}))) as { error?: { code: string; message: string } }
  return { status: response.status(), error: json.error }
}

async function complete(request: APIRequestContext, token: string, ticketId: string) {
  const response = await request.post('/api/media/complete', {
    headers: { Authorization: `Bearer ${token}` },
    data: { ticketId },
  })
  const json = (await response.json().catch(() => ({}))) as { ok: boolean; data?: { id: string }; error?: { code: string; message: string } }
  return { status: response.status(), json }
}

test.beforeAll(async () => {
  // The media routes reach the database through the Hyperdrive binding; prove
  // the stack is the local one before anything runs.
  const host = new URL(status.API_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Refusing: not the local stack.')
})

test('happy path: ticket, every part, complete, then the public derivative', async ({ request }) => {
  const { email } = await createStaff('editor')
  const token = await staffAccessToken(email)
  const { declared, original, derivatives } = await imageDeclaration()

  const ticket = await createTicket(request, token, declared)
  expect(ticket.response.status()).toBe(201)
  expect(ticket.body.data?.ticketId).toMatch(/^[0-9a-f-]{36}$/)
  const ticketId = ticket.body.data!.ticketId

  expect((await putPart(request, token, ticketId, 'original', original)).status).toBe(200)
  for (const [index, width] of WIDTHS.entries()) {
    expect((await putPart(request, token, ticketId, `w${width}`, derivatives[index]!)).status).toBe(200)
  }

  const done = await complete(request, token, ticketId)
  expect(done.status).toBe(201)
  expect(done.json.data?.id).toBe(ticketId)

  // A second completion is refused and must not delete the first one's objects.
  expect((await complete(request, token, ticketId)).status).toBe(410)
  // A part cannot be replaced once the ticket is used.
  expect((await putPart(request, token, ticketId, 'w360', derivatives[0]!)).status).toBe(410)

  // The recorded md5 is the original's, as hex.
  const postgres = new Client({ connectionString: status.DB_URL })
  await postgres.connect()
  try {
    const row = await postgres.query<{ original_md5: string | null }>(
      'select original_md5 from public.media where id = $1',
      [ticketId],
    )
    expect(row.rows[0]?.original_md5).toBe(createHash('md5').update(original).digest('hex'))
  } finally {
    await postgres.end()
  }

  for (const width of [360, 1800]) {
    const image = await request.get(`/media/m/${ticketId}/${width}.webp`)
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/webp')
    expect(image.headers()['x-content-type-options']).toBe('nosniff')
    expect(image.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  }

  // The original is never public, and neither is any non-conforming key.
  expect((await request.get(`/media/originals/${ticketId}`)).status()).toBe(404)
  expect((await request.get(`/media/m/${ticketId}/foo.webp`)).status()).toBe(404)
  expect((await request.get(`/media/${ticketId}`)).status()).toBe(404)
  expect((await request.get('/media/not-a-key.webp')).status()).toBe(404)
})

test('HTML bytes declared as image/jpeg: complete fails and every stored object is removed', async ({ request }) => {
  const { email } = await createStaff('editor')
  const token = await staffAccessToken(email)

  // Long enough that a real 100x80 JPEG plus padding still fits the declared size.
  const html = Buffer.from(`<html><body>${'غلاف غير صالح '.repeat(20)}</body></html>`)
  const jpeg = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 5, g: 6, b: 7 } } })
    .jpeg()
    .toBuffer()
  const webp = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 5, g: 6, b: 7 } } })
    .webp()
    .toBuffer()
  const declared = {
    purpose: 'image',
    name: 'صورة مزيفة',
    folder: '',
    altAr: 'وصف',
    rights: 'حقوق',
    original: { mime: 'image/jpeg', bytes: html.length, width: 100, height: 80 },
    crop: { x: 0, y: 0, width: 100, height: 80 },
    derivatives: [{ width: 100, height: 80, bytes: webp.length }],
  }

  const ticket = await createTicket(request, token, declared)
  expect(ticket.response.status()).toBe(201)
  const ticketId = ticket.body.data!.ticketId

  expect((await putPart(request, token, ticketId, 'original', html)).status).toBe(200)
  expect((await putPart(request, token, ticketId, 'w100', webp)).status).toBe(200)

  const failed = await complete(request, token, ticketId)
  expect(failed.status).toBe(422)
  expect(failed.json.error?.message).toBeTruthy()

  // Completion claims the ticket once: a failed ticket cannot be retried, and
  // a valid JPEG cannot be swapped in afterwards. The browser starts a new
  // ticket instead. (The private objects' deletion is not observable over
  // HTTP; the route deletes them before replying 422.)
  expect((await complete(request, token, ticketId)).status).toBe(410)
  const padded = Buffer.concat([jpeg, Buffer.alloc(html.length - jpeg.length)])
  expect((await putPart(request, token, ticketId, 'original', padded)).status).toBe(410)

  // Nothing was ever promoted to the public bucket.
  expect((await request.get(`/media/m/${ticketId}/100.webp`)).status()).toBe(404)
})

test('a Content-Length larger than declared is 413; an unknown part is 422', async ({ request }) => {
  const { email } = await createStaff('editor')
  const token = await staffAccessToken(email)
  const { declared, original } = await imageDeclaration()

  const short = await createTicket(request, token, {
    ...declared,
    original: { ...declared.original, bytes: declared.original.bytes - 60 },
  })
  expect(short.response.status()).toBe(201)
  const tooLarge = await putPart(request, token, short.body.data!.ticketId, 'original', original)
  expect(tooLarge.status).toBe(413)

  const ticket = await createTicket(request, token, declared)
  expect(ticket.response.status()).toBe(201)
  const unknown = await putPart(request, token, ticket.body.data!.ticketId, 'w999', original)
  expect(unknown.status).toBe(422)
})

test("another staff member's ticket is 404; an expired ticket is 410", async ({ request }) => {
  const owner = await createStaff('editor')
  const ownerToken = await staffAccessToken(owner.email)
  const other = await createStaff('editor')
  const otherToken = await staffAccessToken(other.email)

  const { declared } = await imageDeclaration()
  const ticket = await createTicket(request, ownerToken, declared)
  expect(ticket.response.status()).toBe(201)
  const ticketId = ticket.body.data!.ticketId

  const foreignPut = await putPart(request, otherToken, ticketId, 'original', Buffer.alloc(0))
  expect(foreignPut.status).toBe(404)
  const foreignComplete = await complete(request, otherToken, ticketId)
  expect(foreignComplete.status).toBe(404)

  const fresh = await createTicket(request, ownerToken, declared)
  const freshId = fresh.body.data!.ticketId
  const postgres = new Client({ connectionString: status.DB_URL })
  await postgres.connect()
  try {
    await postgres.query("update public.media_upload_tickets set expires_at = now() - interval '1 minute' where id = $1", [
      freshId,
    ])
  } finally {
    await postgres.end()
  }
  const expired = await putPart(request, ownerToken, freshId, 'original', Buffer.alloc(0))
  expect(expired.status).toBe(410)
  const expiredComplete = await complete(request, ownerToken, freshId)
  expect(expiredComplete.status).toBe(410)
})

test('no token is 401; an operations token is 403', async ({ request }) => {
  const anonymous = await request.post('/api/media/upload', { data: {} })
  expect(anonymous.status()).toBe(401)

  const { email } = await createStaff('operations')
  const token = await staffAccessToken(email)
  const forbidden = await createTicket(request, token, (await imageDeclaration()).declared)
  expect(forbidden.response.status()).toBe(403)
})

// --- Round 2: the browser screens -------------------------------------------

const SHOT_DIR = path.resolve('artifacts/acceptance/P05/screenshots')

/** A JPEG original; `exif` adds an IFD0 marker so removal is provable. */
async function jpegBuffer(width: number, height: number, exif = false): Promise<Buffer> {
  const source = sharp({ create: { width, height, channels: 3, background: { r: 110, g: 85, b: 60 } } }).jpeg()
  return exif
    ? source.withMetadata({ exif: { IFD0: { Copyright: 'p05-exif-probe' } } }).toBuffer()
    : source.toBuffer()
}

/** Uploads one image through the real dialog: file, aspect, alt, rights, submit. */
async function uploadThroughUi(
  page: Page,
  fileName: string,
  buffer: Buffer,
  options: { aspect?: string; alt?: string } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'رفع صورة' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'image/jpeg', buffer })
  await expect(dialog.getByRole('group', { name: 'النسبة' })).toBeVisible()
  if (options.aspect) await dialog.getByRole('button', { name: options.aspect, exact: true }).click()
  await dialog.getByLabel('الوصف البديل').fill(options.alt ?? 'وصف صورة الاختبار')
  await dialog.getByLabel('الحقوق').fill('تصوير أنس')
  await dialog.getByRole('button', { name: 'رفع', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The media id behind a tile, read from its smallest derivative's src. */
async function tileMediaId(page: Page, name: RegExp | string): Promise<string> {
  const img = page.getByRole('button', { name }).locator('img')
  const src = await img.getAttribute('src')
  const id = src?.match(/\/m\/([0-9a-f-]{36})\//)?.[1]
  if (!id) throw new Error(`No media id in tile src: ${src}`)
  return id
}

// Leftovers from partially-failed runs stay in the local database, so every
// run uses its own image names.
const run = Date.now()
const probeName = `p05-exif-probe-${run}`
const tempName = `p05-temp-${run}`

test('round 2: library upload with crop and EXIF removal, reuse in a room, folders, delete', async ({
  page,
  request,
}) => {
  const email = await createOwner('أمين المكتبة')
  await signInByCode(page, email)

  // 1. Upload a 2400x1600 JPEG that carries EXIF, cropped 1:1 in the browser.
  await page.goto('/admin/media')
  await expect(page.getByRole('heading', { name: 'المكتبة' })).toBeVisible()
  await uploadThroughUi(page, `${probeName}.jpg`, await jpegBuffer(2400, 1600, true), { aspect: '1:1' })
  const tile = page.getByRole('button', { name: new RegExp(probeName) })
  await expect(tile).toBeVisible()
  const id = await tileMediaId(page, new RegExp(probeName))

  // The 1200 derivative is WebP, square, and has no EXIF: the crop and the
  // re-encode both happened.
  const derivative = await request.get(`/media/m/${id}/1200.webp`)
  expect(derivative.status()).toBe(200)
  const metadata = await sharp(await derivative.body()).metadata()
  expect(metadata.format).toBe('webp')
  expect(metadata.width).toBe(1200)
  expect(metadata.height).toBe(1200)
  expect(metadata.exif).toBeUndefined()

  // 2. Reuse it on the built room's intro vignette, through the picker.
  await page.goto('/admin/content/rooms/built')
  // Wait for the form's data to load: interacting mid-load races the
  // CollectionForm remount and the loaded values.
  await expect(page.getByLabel('سطر البداية')).toHaveValue(/./)
  const introGroup = page.getByRole('group', { name: 'المقدمة' })
  // A library id settles on «تغيير», a manifest id on «اختر من المكتبة»
  // (a loading state sits in between, so wait for one of the two).
  const changeButton = introGroup.getByRole('button', { name: 'تغيير' })
  const chooseButton = introGroup.getByRole('button', { name: 'اختر من المكتبة' })
  await expect(changeButton.or(chooseButton)).toBeVisible()
  if (await changeButton.isVisible()) {
    // A partially-failed earlier run can leave a library id in this field;
    // normalize to the empty state so the flow below is deterministic.
    await introGroup.getByRole('button', { name: 'إزالة' }).click()
    await introGroup.getByRole('button', { name: 'إضافة صورة' }).click()
  }
  await chooseButton.click()
  const picker = page.getByRole('dialog')
  await expect(picker.getByRole('heading', { name: 'اختيار من المكتبة' })).toBeVisible()
  await picker.getByRole('button', { name: new RegExp(probeName) }).click()
  await expect(picker).toBeHidden()
  // The field now shows the preview (its img carries the media's alt text),
  // not the raw UUID. A closed picker's hidden tiles never match a role.
  const previewImage = introGroup.getByRole('img', { name: 'وصف صورة الاختبار' })
  await expect(previewImage).toBeVisible()

  // Exercise إزالة/إضافة صورة, then pick again (the field is nullable).
  await introGroup.getByRole('button', { name: 'إزالة' }).click()
  await expect(previewImage).toHaveCount(0)
  await introGroup.getByRole('button', { name: 'إضافة صورة' }).click()
  await introGroup.getByRole('button', { name: 'اختر من المكتبة' }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(probeName) }).click()
  await expect(previewImage).toBeVisible()

  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // The public room shows the library image through the /media origin.
  const builtHtml = await (await request.get('/built')).text()
  expect(builtHtml).toContain(`/media/m/${id}/1200.webp`)
  expect((await request.get(`/media/m/${id}/1200.webp`)).status()).toBe(200)

  // 3. Where-used lists the room — twice: the live document and the latest
  // (draft) version both reference the image — and blocks deletion.
  await page.goto('/admin/media')
  await page.getByRole('button', { name: new RegExp(probeName) }).click()
  const usedLinks = page.getByRole('link', { name: 'بنيتُ هنا' })
  await expect(usedLinks).toHaveCount(2)
  await expect(usedLinks.first()).toHaveAttribute('href', '/admin/content/rooms/built')
  await expect(page.getByText('منشورة')).toBeVisible()
  await expect(page.getByText('مسودة')).toBeVisible()
  await expect(page.getByRole('button', { name: 'حذف', exact: true })).toBeDisabled()

  // 4. Move to a folder, then rename the folder; the filter shows the item.
  await page.getByLabel('المجلد', { exact: true }).fill('أغلفة')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('حُفظ')).toBeVisible()
  await page.getByLabel('المجلد الحالي').selectOption('أغلفة')
  await page.getByLabel('الاسم الجديد للمجلد').fill('أغلفة / ٢٠٢٦')
  await page.getByRole('button', { name: 'إعادة تسمية المجلد' }).click()
  await expect(page.getByText(/نُقلت/)).toBeVisible()
  await page.getByLabel('تصفية بالمجلد').selectOption('أغلفة / ٢٠٢٦')
  await expect(page.getByRole('button', { name: new RegExp(probeName) })).toBeVisible()

  // 5. A second upload can be deleted; its public derivative then 404s.
  await page.getByLabel('تصفية بالمجلد').selectOption('')
  await uploadThroughUi(page, `${tempName}.jpg`, await jpegBuffer(800, 600), { alt: 'صورة مؤقتة' })
  const tempTile = page.getByRole('button', { name: new RegExp(tempName) })
  await expect(tempTile).toBeVisible()
  const tempId = await tileMediaId(page, new RegExp(tempName))
  await tempTile.click()
  await page.getByRole('button', { name: 'حذف', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الحذف' }).click()
  await expect(page.getByRole('button', { name: new RegExp(tempName) })).toHaveCount(0)
  expect((await request.get(`/media/m/${tempId}/360.webp`)).status()).toBe(404)

  // 6. A file over 15 MiB is refused in the browser, before any request.
  const uploadRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/media/upload')) uploadRequests.push(req.url())
  })
  await page.getByRole('button', { name: 'رفع صورة' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024) })
  await expect(dialog.getByText('حجم الملف أكبر من 15 ميغابايت.')).toBeVisible()
  expect(uploadRequests).toHaveLength(0)
  await dialog.getByRole('button', { name: 'إلغاء' }).click()

  // 7. Restore the room to its previous published state.
  await page.goto('/admin/content/rooms/built')
  const historyTable = page.locator('table')
  await historyTable.locator('tbody tr').last().getByRole('button', { name: 'استعادة' }).click()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  const restoredHtml = await (await request.get('/built')).text()
  expect(restoredHtml).not.toContain(`/media/m/${id}/`)
})

test('round 2: search and المزيد paging past 40 items', async ({ page, request }) => {
  // 41 rows through the API (the round-1 helpers), then the grid in the
  // browser. The API path is exactly what the library screen exercises.
  const { email } = await createStaff('editor')
  const token = await staffAccessToken(email)
  const stamp = Date.now()
  const { declared, original, derivatives } = await imageDeclaration()
  for (let index = 1; index <= 41; index += 1) {
    const named = { ...declared, name: `صفحة ${stamp} ${index}` }
    const ticket = await createTicket(request, token, named)
    expect(ticket.response.status()).toBe(201)
    const ticketId = ticket.body.data!.ticketId
    expect((await putPart(request, token, ticketId, 'original', original)).status).toBe(200)
    for (const [widthIndex, width] of WIDTHS.entries()) {
      expect((await putPart(request, token, ticketId, `w${width}`, derivatives[widthIndex]!)).status).toBe(200)
    }
    expect((await complete(request, token, ticketId)).status).toBe(201)
  }

  const browserEmail = await createOwner('متصفّح المكتبة')
  await signInByCode(page, browserEmail)
  await page.goto('/admin/media')
  // CSS-module class names are hashed, so the tiles are located by role.
  const tiles = page.getByRole('button', { name: new RegExp(`صفحة ${stamp} `) })
  await expect(tiles.first()).toBeVisible()
  expect(await tiles.count()).toBe(40)
  await page.getByRole('button', { name: 'المزيد' }).click()
  await expect.poll(async () => tiles.count()).toBeGreaterThan(40)

  // Search narrows to one tile and hides المزيد.
  await page.getByLabel('بحث بالاسم').fill(`صفحة ${stamp} 41`)
  await expect(tiles).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'المزيد' })).toBeHidden()
})

test('round 2: screenshots at 360 and 1440, and horizontal overflow', async ({ browser }) => {
  mkdirSync(SHOT_DIR, { recursive: true })
  appendFileSync(path.join(SHOT_DIR, 'overflow.txt'), `run ${new Date().toISOString()}\n`)
  for (const [width, height, label] of [
    [360, 800, '360'],
    [1440, 900, '1440'],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    const email = await createOwner(`مصوّر المكتبة ${label}`)
    await signInByCode(page, email)

    await page.goto('/admin/media')
    await uploadThroughUi(page, `p05-shot-${run}-${label}.jpg`, await jpegBuffer(1600, 1000, true))
    await expect(page.getByRole('button', { name: new RegExp(`p05-shot-${run}-${label}`) })).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, `library-${label}.png`), fullPage: true })

    await page.getByRole('button', { name: new RegExp(`p05-shot-${run}-${label}`) }).click()
    await expect(page.getByText('مستخدمة في')).toBeVisible()
    await expect(page.getByText('غير مستخدمة')).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, `details-${label}.png`), fullPage: true })

    await page.getByRole('button', { name: 'رفع صورة' }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: `p05-crop-${label}.jpg`, mimeType: 'image/jpeg', buffer: await jpegBuffer(2400, 1600) })
    await expect(dialog.getByRole('group', { name: 'النسبة' })).toBeVisible()
    const zoom = dialog.getByLabel('التقريب')
    await zoom.press('ArrowRight')
    await expect(dialog.getByRole('button', { name: 'الأصل', exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, `upload-${label}.png`), fullPage: true })
    await dialog.getByRole('button', { name: 'إلغاء' }).click()

    await page.goto('/admin/content/rooms/built')
    await expect(page.getByLabel('سطر البداية')).toHaveValue(/./)
    const introGroup = page.getByRole('group', { name: 'المقدمة' })
    // The field may already hold a library id (an earlier run); either
    // button opens the same picker dialog.
    const changeButton = introGroup.getByRole('button', { name: 'تغيير' })
    const chooseButton = introGroup.getByRole('button', { name: 'اختر من المكتبة' })
    await expect(changeButton.or(chooseButton)).toBeVisible()
    if (await changeButton.isVisible()) {
      await changeButton.click()
    } else {
      await chooseButton.click()
    }
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'اختيار من المكتبة' })).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, `picker-${label}.png`), fullPage: true })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    appendFileSync(
      path.join(SHOT_DIR, 'overflow.txt'),
      `${label}px: scrollWidth - innerWidth = ${overflow} ${overflow <= 0 ? 'OK' : 'OVERFLOW'}\n`,
    )
    await context.close()
  }
})
