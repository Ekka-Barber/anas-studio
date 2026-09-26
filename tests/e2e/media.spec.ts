// P05 round 1: the media upload end to end at the HTTP level, against the
// local Supabase stack: the `admin` Edge Function issues the ticket and the
// signed upload URLs, the parts go straight to Storage, and `media-complete`
// checks them and promotes the WebP derivatives to the public bucket (D32).
// P05 round 2: the browser screens against `next dev`
// (PLAYWRIGHT_BASE_URL=http://localhost:3000) — the library, the upload
// dialog (crop in the browser, EXIF removed by re-encode), the picker on a
// content form, folders, the where-used guard and deletion. Image bytes are
// generated with Sharp in the test; the server never uses Sharp.
import { createHash } from 'node:crypto'
import { mkdirSync, appendFileSync } from 'node:fs'
import path from 'node:path'

import { Client } from 'pg'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'

import { anonClient, createOwner, createStaff, functionUrl, signInByCode, staffAccessToken, status } from './helpers'

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

interface SignedPart {
  part: string
  path: string
  token: string
}

/** Calls the `admin` Edge Function as the staff member the token belongs to. */
function adminCall(request: APIRequestContext, token: string | null, body: unknown) {
  return request.post(functionUrl('admin'), {
    headers: { apikey: status.PUBLISHABLE_KEY, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    data: body as object,
  })
}

async function createTicket(request: APIRequestContext, token: string, declared: unknown) {
  const response = await adminCall(request, token, { action: 'media-ticket', declaration: declared })
  return {
    response,
    body: (await response.json()) as {
      ok: boolean
      data?: { ticketId: string; bucket: string; parts: SignedPart[] }
      error?: { code: string; message: string }
    },
  }
}

/** Uploads one part to its signed Storage URL, as the browser does. */
async function putPart(parts: SignedPart[], part: string, body: Buffer, contentType = 'image/webp'): Promise<boolean> {
  const signed = parts.find((p) => p.part === part)
  if (!signed) throw new Error(`putPart: no signed URL for ${part}`)
  const { error } = await anonClient()
    .storage.from('media-private')
    .uploadToSignedUrl(signed.path, signed.token, body, { contentType })
  return error === null
}

async function complete(request: APIRequestContext, token: string, ticketId: string) {
  const response = await adminCall(request, token, { action: 'media-complete', ticketId })
  const json = (await response.json().catch(() => ({}))) as { ok: boolean; data?: { id: string }; error?: { code: string; message: string } }
  return { status: response.status(), json }
}

/** A public-bucket object's URL (what the site and the library render). */
function publicUrl(key: string): string {
  return `${status.API_URL}/storage/v1/object/public/media-public/${key}`
}

test.beforeAll(async () => {
  // Prove the stack is the local one before anything runs.
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
  const parts = ticket.body.data!.parts
  expect(ticket.body.data!.bucket).toBe('media-private')
  expect(parts.every((p) => p.path.startsWith(`quarantine/${ticketId}/`))).toBe(true)

  expect(await putPart(parts, 'original', original, 'image/jpeg')).toBe(true)
  for (const [index, width] of WIDTHS.entries()) {
    expect(await putPart(parts, `w${width}`, derivatives[index]!)).toBe(true)
  }

  const done = await complete(request, token, ticketId)
  expect(done.status).toBe(201)
  expect(done.json.data?.id).toBe(ticketId)

  // A second completion is refused and must not delete the first one's objects.
  expect((await complete(request, token, ticketId)).status).toBe(410)
  // A late upload to a staging path never reaches the public object.
  await putPart(parts, 'w360', derivatives[1]!)
  const kept = await request.get(publicUrl(`m/${ticketId}/360.webp`))
  expect((await sharp(await kept.body()).metadata()).width).toBe(360)

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

  // Storage serves what the function wrote: WebP, cached for a year. (The
  // bucket accepts only image/webp and only the service role writes to it,
  // after the magic-byte check, so no other type can be served from it.)
  for (const width of [360, 1800]) {
    const image = await request.get(publicUrl(`m/${ticketId}/${width}.webp`))
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/webp')
    expect(image.headers()['cache-control']).toContain('max-age=31536000')
  }

  // The original is never public, and neither is anything outside the public bucket.
  expect((await request.get(`${status.API_URL}/storage/v1/object/public/media-private/originals/${ticketId}`)).ok()).toBe(false)
  expect((await request.get(publicUrl(`m/${ticketId}/foo.webp`))).ok()).toBe(false)
  expect((await request.get(publicUrl(`originals/${ticketId}`))).ok()).toBe(false)
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
  const parts = ticket.body.data!.parts

  // The private bucket accepts the upload as image/jpeg; only the magic-byte
  // check at completion can tell it is HTML.
  expect(await putPart(parts, 'original', html, 'image/jpeg')).toBe(true)
  expect(await putPart(parts, 'w100', webp)).toBe(true)

  const failed = await complete(request, token, ticketId)
  expect(failed.status).toBe(422)
  expect(failed.json.error?.message).toBeTruthy()

  // Completion claims the ticket once: a failed ticket cannot be retried, so
  // a valid JPEG swapped in afterwards never completes. The browser starts a
  // new ticket instead.
  const padded = Buffer.concat([jpeg, Buffer.alloc(html.length - jpeg.length)])
  await putPart(parts, 'original', padded, 'image/jpeg')
  expect((await complete(request, token, ticketId)).status).toBe(410)

  // Nothing was ever promoted to the public bucket, and the staged parts are gone.
  expect((await request.get(publicUrl(`m/${ticketId}/100.webp`))).ok()).toBe(false)
  const postgres = new Client({ connectionString: status.DB_URL })
  await postgres.connect()
  try {
    const staged = await postgres.query(
      "select name from storage.objects where bucket_id = 'media-private' and name = $1",
      [`quarantine/${ticketId}/100.webp`],
    )
    expect(staged.rows).toEqual([])
  } finally {
    await postgres.end()
  }
})

test('more bytes than declared are refused at completion; nothing goes public', async ({ request }) => {
  const { email } = await createStaff('editor')
  const token = await staffAccessToken(email)
  const { declared, original, derivatives } = await imageDeclaration()

  const short = await createTicket(request, token, {
    ...declared,
    original: { ...declared.original, bytes: declared.original.bytes - 60 },
  })
  expect(short.response.status()).toBe(201)
  const ticketId = short.body.data!.ticketId
  const parts = short.body.data!.parts
  expect(await putPart(parts, 'original', original, 'image/jpeg')).toBe(true)
  for (const [index, width] of WIDTHS.entries()) {
    expect(await putPart(parts, `w${width}`, derivatives[index]!)).toBe(true)
  }
  const refused = await complete(request, token, ticketId)
  expect(refused.status).toBe(422)
  expect(refused.json.error?.code).toBe('SIZE_MISMATCH')
  expect((await request.get(publicUrl(`m/${ticketId}/360.webp`))).ok()).toBe(false)
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
  const expiredComplete = await complete(request, ownerToken, freshId)
  expect(expiredComplete.status).toBe(410)
})

test('no token is 401; an operations token is 403', async ({ request }) => {
  const anonymous = await adminCall(request, null, { action: 'media-ticket', declaration: {} })
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
  const derivative = await request.get(publicUrl(`m/${id}/1200.webp`))
  expect(derivative.status()).toBe(200)
  const metadata = await sharp(await derivative.body()).metadata()
  expect(metadata.format).toBe('webp')
  expect(metadata.width).toBe(1200)
  expect(metadata.height).toBe(1200)
  expect(metadata.exif).toBeUndefined()

  // 2. Reuse it on the built room's intro vignette, through the picker.
  await page.goto('/admin/content/rooms/edit?id=built')
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

  // The public room shows the library image from the public bucket.
  const builtHtml = await (await request.get('/built')).text()
  expect(builtHtml).toContain(`/storage/v1/object/public/media-public/m/${id}/1200.webp`)
  expect((await request.get(publicUrl(`m/${id}/1200.webp`))).status()).toBe(200)

  // 3. Where-used lists the room — twice: the live document and the latest
  // (draft) version both reference the image — and blocks deletion.
  await page.goto('/admin/media')
  await page.getByRole('button', { name: new RegExp(probeName) }).click()
  const usedLinks = page.getByRole('link', { name: 'بنيتُ هنا' })
  await expect(usedLinks).toHaveCount(2)
  await expect(usedLinks.first()).toHaveAttribute('href', '/admin/content/rooms/edit?id=built')
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
  expect((await request.get(publicUrl(`m/${tempId}/360.webp`))).ok()).toBe(false)

  // 6. A file over 15 MiB is refused in the browser, before any request.
  const uploadRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/admin') || req.url().includes('/storage/v1/object/upload')) {
      uploadRequests.push(req.url())
    }
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
  await page.goto('/admin/content/rooms/edit?id=built')
  const historyTable = page.locator('table')
  await historyTable.locator('tbody tr').last().getByRole('button', { name: 'استعادة' }).click()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  const restoredHtml = await (await request.get('/built')).text()
  expect(restoredHtml).not.toContain(`/m/${id}/`)
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
    const parts = ticket.body.data!.parts
    expect(await putPart(parts, 'original', original, 'image/jpeg')).toBe(true)
    for (const [widthIndex, width] of WIDTHS.entries()) {
      expect(await putPart(parts, `w${width}`, derivatives[widthIndex]!)).toBe(true)
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

    await page.goto('/admin/content/rooms/edit?id=built')
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
