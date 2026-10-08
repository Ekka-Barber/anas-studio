import { randomUUID } from 'node:crypto'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { collections, documentTitle, isRoomSlug, ROOM_DOC_LABELS, schemaFor, SCENES_DOC_ID } from '../../src/admin/collections'
import { POLICY_DOC_IDS, POLICY_DOC_LABELS, policySchema } from '../../src/admin/collections/policies'
import { SCENE_CAPTION_ERROR, sceneFields, scenesSchema } from '../../src/admin/collections/scenes'
import {
  SOCIAL_HANDLE_ERROR,
  SOCIAL_HREF_ERROR,
  SOCIAL_NETWORK_ERROR,
  siteSettingsStoredSchema,
} from '../../src/admin/collections/site-settings'
import { tables, type TableKey } from '../../src/admin/tables'
import { altSibling, defaultsForFields, equalData, type Field, schemaFromFields, withDefaults, withPickedImage } from '../../src/admin/fields'
import { postFields } from '../../src/admin/collections/posts'
import { galleryPhotoFields, PHOTO_ALT_ERROR, roomSchemas, startedMovementFields, startedRoomSchema } from '../../src/admin/collections/rooms'
import { homeFields } from '../../src/admin/collections/site-settings'
import { PublishBar } from '../../src/components/admin/PublishBar'
import { SCENE_CATEGORIES } from '../../src/content/scenes'
import { ARCHIVE_CONFIRM, HIDDEN_LIVE_STATUS, liveStatus, POLICY_PUBLISH_NOTE, successMessage } from '../../src/lib/admin-publish'
import { formatMediaRef } from '../../src/lib/media-ref'
import content from '../../content/initial-content.json'

const ROOM_SLUGS = ['started', 'built', 'passed', 'shelf', 'book'] as const

const siteSettingsData = { nav: content.nav, footer: content.footer, home: content.home, contactPage: content.contactPage }

const contactDoc = (whatsapp: string) => ({
  ...siteSettingsData,
  contact: { email: 'hello@anas.studio', whatsapp },
})

describe('schemaFor: the real content fixture', () => {
  it('parses the site_settings document', () => {
    expect(() => schemaFor('site_settings', 'site').parse(siteSettingsData)).not.toThrow()
  })

  it('still parses the already-published settings after the optional P06 seo/contact groups were added', () => {
    const result = schemaFor('site_settings', 'site').safeParse(siteSettingsData)
    expect(result.success).toBe(true)
  })

  it('accepts the new optional groups when present, and partial groups are refused', () => {
    const withNew = {
      ...siteSettingsData,
      seo: { title: 'استوديو أنس', description: 'وصف' },
      contact: { email: 'hello@anas.studio', whatsapp: '0501234567' },
    }
    expect(schemaFor('site_settings', 'site').safeParse(withNew).success).toBe(true)

    const partial = { ...siteSettingsData, contact: { email: 'hello@anas.studio' } }
    expect(schemaFor('site_settings', 'site').safeParse(partial).success).toBe(false)
  })

  it.each(ROOM_SLUGS)('parses the %s room document', (slug) => {
    const room = (content.rooms as Record<string, unknown>)[slug]
    expect(() => schemaFor('rooms', slug).parse(room)).not.toThrow()
  })

  it('throws for an unknown room slug', () => {
    expect(() => schemaFor('rooms', 'not-a-room')).toThrow('Unknown room')
  })
})

describe('schemaFor: rejects malformed data', () => {
  it('rejects a paragraphs field of the wrong type', () => {
    const bad = structuredClone(content.rooms.started)
    // @ts-expect-error deliberately wrong type for the test
    bad.pullLines = 'not an array'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('the site_settings gate rejects a junk whatsapp and a junk email', () => {
    expect(schemaFor('site_settings', 'site').safeParse(contactDoc('not-a-number')).success).toBe(false)
    expect(
      schemaFor('site_settings', 'site')
        .safeParse({ ...siteSettingsData, contact: { email: 'nope', whatsapp: '0501234567' } })
        .success,
    ).toBe(false)
  })

  it('the site_settings gate accepts every everyday Saudi mobile spelling', () => {
    for (const whatsapp of ['050-123-4567', '501234567', '+966 50 123 4567', '٠٥٠١٢٣٤٥٦٧', '(050) 123 4567']) {
      expect(schemaFor('site_settings', 'site').safeParse(contactDoc(whatsapp)).success).toBe(true)
    }
  })

  it('the lenient stored schema parses a stored document whose whatsapp is junk (loader safety)', () => {
    expect(siteSettingsStoredSchema.safeParse(contactDoc('junk')).success).toBe(true)
  })

  it('rejects an unknown image id', () => {
    const bad = structuredClone(content.rooms.started)
    ;(bad.movements[0] as Record<string, unknown>).vignette = 'not-a-real-image-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('accepts a media-library id for an image field (P05)', () => {
    const doc = structuredClone(content.rooms.started)
    ;(doc.movements[0] as Record<string, unknown>).vignette = randomUUID()
    expect(schemaFor('rooms', 'started').safeParse(doc).success).toBe(true)
  })

  it('rejects an unknown video id', () => {
    const bad = structuredClone(content.rooms.started)
    bad.media.reels[0]!.id = 'not-a-real-video-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('has no room slug field: nothing reads it, and a stored one is ignored, not validated', () => {
    const stored = { ...structuredClone(content.rooms.started), slug: 'Not A Valid Slug!' }
    expect(schemaFor('rooms', 'started').safeParse(stored).success).toBe(true)
    for (const fields of Object.values(collections.rooms.fields)) {
      expect(fields.map((field) => field.name)).not.toContain('slug')
    }
  })

  it('rejects a document missing a required field', () => {
    const bad = structuredClone(content.rooms.started) as Record<string, unknown>
    delete bad.roomLabel
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })
})

describe('site_settings social links (C09)', () => {
  const link = (href: string, network = 'إكس', handle = '@anasa.aq') => ({ network, handle, href })
  const withSocial = (social: unknown[]) => ({ ...siteSettingsData, social })
  const publishMessages = (data: unknown) => {
    const result = schemaFor('site_settings', 'site').safeParse(data)
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('the published document from before the list (no `social`) still validates', () => {
    expect('social' in siteSettingsData).toBe(false)
    expect(publishMessages(siteSettingsData)).toEqual([])
  })

  it('the four real links pass, in the document the import writes', () => {
    expect(content.social).toHaveLength(4)
    expect(publishMessages(withSocial(content.social))).toEqual([])
  })

  it.each(['http://x.com/anasa.aq', 'javascript:alert(1)', 'data:text/html,hi', '/contact', 'x.com/anasa.aq', ''])(
    'refuses the link %j at publish',
    (href) => {
      expect(publishMessages(withSocial([link('https://x.com/anasa.aq'), link(href)]))).toEqual([
        `social.1.href: ${SOCIAL_HREF_ERROR}`,
      ])
    },
  )

  it('refuses an empty network or handle at publish', () => {
    expect(publishMessages(withSocial([link('https://x.com/anasa.aq', ' ', '')]))).toEqual([
      `social.0.network: ${SOCIAL_NETWORK_ERROR}`,
      `social.0.handle: ${SOCIAL_HANDLE_ERROR}`,
    ])
  })

  it('an empty list is valid, and the stored schema keeps a bad link so no page fails on it', () => {
    expect(publishMessages(withSocial([]))).toEqual([])
    expect(siteSettingsStoredSchema.safeParse(withSocial([link('javascript:alert(1)', '', '')])).success).toBe(true)
  })
})

describe('the scenes collection (C05)', () => {
  const photo = (overrides: Record<string, unknown> = {}) => ({ ...content.scenes[0]!, ...overrides })
  const publishMessages = (data: unknown) => {
    const result = schemaFor('scenes', SCENES_DOC_ID).safeParse(data)
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('is one fixed document, titled المَشاهد', () => {
    expect(SCENES_DOC_ID).toBe('gallery')
    expect(documentTitle('scenes', SCENES_DOC_ID, { items: [] })).toBe('المَشاهد')
  })

  it('the 19 photos the import writes pass at publish', () => {
    expect(content.scenes).toHaveLength(19)
    expect(publishMessages({ items: content.scenes })).toEqual([])
  })

  it('offers exactly Anas’s five categories, and publish refuses any other', () => {
    expect(sceneFields.find((field) => field.name === 'category')).toMatchObject({
      type: 'select',
      options: ['أماكن', 'مشاريع', 'منتجات', 'رحلات', 'خلف الكواليس'],
    })
    for (const category of SCENE_CATEGORIES) expect(publishMessages({ items: [photo({ category })] })).toEqual([])
    for (const category of ['سفر', 'places', '', 'أماكن ']) {
      const messages = publishMessages({ items: [photo(), photo({ category })] })
      expect(messages, category).toHaveLength(1)
      expect(messages[0]).toMatch(/^items\.1\.category: /)
    }
  })

  it('refuses an empty caption (the tile’s name) and an unknown image, and takes a library image', () => {
    expect(publishMessages({ items: [photo({ caption: '  ' })] })).toEqual([`items.0.caption: ${SCENE_CAPTION_ERROR}`])
    expect(publishMessages({ items: [photo({ image: '' })] })).toEqual(['items.0.image: معرّف صورة غير معروف.'])
    expect(publishMessages({ items: [photo({ image: randomUUID() })] })).toEqual([])
  })

  it('a malformed photo is refused, never thrown on', () => {
    expect(scenesSchema.safeParse({ items: [{ image: 'street4-street-sign', category: 'أماكن', caption: 5 }] }).success).toBe(false)
    expect(scenesSchema.safeParse({}).success).toBe(false)
  })

  it('keeps a hidden photo in the data (the loader drops it from the page)', () => {
    const parsed = scenesSchema.parse({ items: [photo({ hidden: true }), photo()] })
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0]!.hidden).toBe(true)
    expect(parsed.items[1]!.hidden).toBeUndefined()
  })
})

describe('hideable lists', () => {
  it('accepts an item marked hidden, and the loader-style filter drops it', () => {
    const bad = structuredClone(content.rooms.started)
    // @ts-expect-error `hidden` is the hideable-list addition, not on the base type
    bad.movements[0].hidden = true
    const parsed = schemaFor('rooms', 'started').parse(bad) as { movements: Array<{ hidden?: boolean }> }
    expect(parsed.movements[0]!.hidden).toBe(true)
    const visible = parsed.movements.filter((item) => !item.hidden)
    expect(visible).toHaveLength(content.rooms.started.movements.length - 1)
  })

  it('the real fixture hides only the films D39 leaves out, and shows the five with children', () => {
    const hidden: string[] = []
    for (const slug of ROOM_SLUGS) {
      JSON.stringify((content.rooms as Record<string, unknown>)[slug], (_key, value: unknown) => {
        if (value && typeof value === 'object' && (value as { hidden?: unknown }).hidden === true) {
          hidden.push((value as { id: string }).id)
        }
        return value
      })
    }
    // The guardians consented (owner, 2026-10-01): the five films with children are
    // in the started room and shown.
    const startedReels = content.rooms.started.media.reels
    expect(startedReels.filter((reel) => reel.id.includes('-kid-')).map((reel) => reel.id)).toEqual([
      '46-kid-picnic-jam',
      '47-kid-bisht-honey-jar',
      '48-kid-supermarket-tomato-pesto',
      '49-kid-hotel-breakfast',
      '50-kid-cafe-croissant-jam',
    ])
    expect(hidden.sort()).toEqual([
      'arm-modern-black-gold-dessert_HD',
      'arm-modern-layered-drink_HD',
      'arm-modern-red-drink_HD',
      'raha-branch-walkthrough',
    ])
  })
})

// ---------------------------------------------------------------------------
// P07 round 2: the three new field types, the policies collection and the
// store table configs.

const p07Fields = [
  { name: 'count', label: 'العدد', type: 'number', min: 0, max: 100 },
  { name: 'price', label: 'السعر', type: 'money' },
  { name: 'fee', label: 'الرسوم', type: 'money', min: 0, nullable: true },
  { name: 'at', label: 'الوقت', type: 'datetime', nullable: true },
] as const satisfies Field[]
const p07Schema = schemaFromFields(p07Fields)

describe('the number, money and datetime field types (P07 round 2)', () => {
  it('accepts integers within their bounds', () => {
    expect(p07Schema.safeParse({ count: 5, price: 6999, fee: 0, at: null }).success).toBe(true)
    expect(p07Schema.safeParse({ count: 0, price: 1, fee: null, at: null }).success).toBe(true)
    expect(p07Schema.safeParse({ count: 7, price: 10000000, fee: 0, at: '2026-03-05T07:00:00.000Z' }).success).toBe(true)
  })

  it('rejects out-of-bounds and non-integer numbers, and a money of 0 without min 0', () => {
    expect(p07Schema.safeParse({ count: -1, price: 100, fee: 0, at: null }).success).toBe(false)
    expect(p07Schema.safeParse({ count: 101, price: 100, fee: 0, at: null }).success).toBe(false)
    expect(p07Schema.safeParse({ count: 1.5, price: 100, fee: 0, at: null }).success).toBe(false)
    expect(p07Schema.safeParse({ count: 1, price: 0, fee: 0, at: null }).success).toBe(false)
    expect(p07Schema.safeParse({ count: 1, price: 10000001, fee: 0, at: null }).success).toBe(false)
  })

  it('rejects a datetime that is not a parseable ISO timestamp', () => {
    expect(p07Schema.safeParse({ count: 1, price: 1, fee: 0, at: 'ليس تاريخًا' }).success).toBe(false)
  })
})

describe('the date field type (P08 round 11c)', () => {
  const dayFields = [
    { name: 'day', label: 'اليوم', type: 'date', nullable: true },
    { name: 'due', label: 'الموعد', type: 'date' },
  ] as const satisfies Field[]
  const days = schemaFromFields(dayFields)

  it('accepts a real calendar day, and null only where the field is nullable', () => {
    expect(days.safeParse({ day: '2026-10-03', due: '2024-02-29' }).success).toBe(true)
    expect(days.safeParse({ day: null, due: '2030-01-01' }).success).toBe(true)
    expect(days.safeParse({ day: '2026-10-03', due: null }).success).toBe(false)
  })

  it('refuses what is not a day: a time, a five-digit year, an impossible date, an empty text', () => {
    for (const bad of ['', '2026-02-30', '2026-13-01', '20261-01-01', '2026-10-03T00:00:00Z', '03/10/2026', 'ليس يومًا']) {
      const result = days.safeParse({ day: null, due: bad })
      expect(result.success, bad).toBe(false)
      expect(result.error?.issues[0]?.message, bad).toBe('تاريخ غير صالح.')
    }
  })

  it('starts as null when nullable and as an empty text otherwise', () => {
    expect(defaultsForFields(dayFields)).toEqual({ day: null, due: '' })
  })
})

describe('the policies collection (P07 round 2)', () => {
  const lexicalBody = {
    root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'نص السياسة', format: 0 }] }] },
  }

  it('has exactly the four fixed documents, labelled', () => {
    expect([...POLICY_DOC_IDS]).toEqual(['store', 'delivery', 'refund', 'privacy'])
    expect(POLICY_DOC_LABELS).toEqual({
      store: 'سياسة المتجر',
      delivery: 'سياسة التوصيل',
      refund: 'سياسة الاسترجاع',
      privacy: 'سياسة الخصوصية',
    })
  })

  it('parses exactly the shape the demo seed wrote, and refuses a missing title', () => {
    expect(policySchema.safeParse({ title: 'سياسة المتجر', body: lexicalBody }).success).toBe(true)
    expect(schemaFor('policies', 'store').safeParse({ title: 'سياسة', body: lexicalBody }).success).toBe(true)
    expect(policySchema.safeParse({ body: lexicalBody }).success).toBe(false)
  })

  it('documentTitle uses the title, falling back to the fixed label', () => {
    expect(documentTitle('policies', 'store', { title: 'شروطي' })).toBe('شروطي')
    expect(documentTitle('policies', 'delivery', undefined)).toBe('سياسة التوصيل')
  })
})

// The granted column lists, read out of
// supabase/migrations/20260927160000_catalog_and_checkout.sql (insert and
// update grants) and 20261002100000_payment_core.sql (the variants' preorder
// columns gained, `digital_asset` lost): a config whose `toRow` outputs
// anything else writes a column the migrations never granted. The availability
// sign-ups are read-only (`public.notifications` grants `select` alone): no column.
const GRANTED: Record<TableKey, readonly string[]> = {
  products: ['slug', 'title', 'summary', 'body', 'cover_image', 'status', 'sort_order'],
  variants: [
    'product_id',
    'sku',
    'title',
    'fulfillment',
    'price_halalas',
    'enabled',
    'stock',
    'low_stock_threshold',
    'preorder',
    'preorder_capacity',
    'preorder_ships_on',
    'preorder_note',
    'sort_order',
  ],
  'shipping-rates': ['city_key', 'name_ar', 'fee_halalas', 'enabled', 'sort_order'],
  coupons: [
    'code',
    'kind',
    'percent_bp',
    'amount_halalas',
    'starts_at',
    'ends_at',
    'min_subtotal_halalas',
    'usage_limit',
    'product_ids',
    'enabled',
  ],
  customers: ['name', 'phone'],
  notifications: [],
}

describe('the table configs (P07 round 2)', () => {
  // `toRow`'s key set is what matters here; null stands in for every value.
  const emptyValues = (fields: readonly Field[]): Record<string, unknown> =>
    Object.fromEntries(fields.map((field) => [field.name, null]))

  it.each(Object.keys(GRANTED) as TableKey[])('%s writes only columns the migration grants', (key) => {
    const config = tables[key]
    const row = config.toRow(emptyValues(config.fields as readonly Field[]))
    for (const column of Object.keys(row)) {
      expect(GRANTED[key], `${key}: ${column}`).toContain(column)
    }
  })

  it('customers: no insert, name and phone only, email read-only', () => {
    const config = tables.customers
    expect(config.insert).toBe(false)
    expect(Object.keys(config.toRow({ name: 'اسم', phone: '0501234567' })).sort()).toEqual(['name', 'phone'])
    expect(config.readOnly).toEqual(['email'])
  })

  it("customers: one link per row, to that customer's orders, the address in the fragment and never in a query string (P08 round 11a)", () => {
    const link = tables.customers.rowLink?.({ email: 'Buyer+1@example.com' })
    expect(link).toEqual({ href: '/admin/orders#q=Buyer%2B1%40example.com', label: 'طلباته' })
    expect(link?.href).not.toContain('?')
    expect(tables.customers.rowLink?.({ email: null })).toBeNull()
    // No other table has one.
    for (const key of Object.keys(tables) as TableKey[]) {
      if (key !== 'customers') expect(tables[key].rowLink, key).toBeUndefined()
    }
  })

  it('a coupon percentage maps to basis points in both directions, and the unused value is null', () => {
    const config = tables.coupons
    expect(config.toRow({ kind: 'percent', percent: 1250, amount_halalas: null })).toMatchObject({
      percent_bp: 1250,
      amount_halalas: null,
    })
    expect(config.toRow({ kind: 'fixed', percent: null, amount_halalas: 6950 })).toMatchObject({
      percent_bp: null,
      amount_halalas: 6950,
    })
    expect(config.fromRow?.({ percent_bp: 1250, amount_halalas: null, kind: 'percent' })).toMatchObject({ percent: 1250 })
  })

  it('a variant upper-cases its sku and sends null stock for a digital one', () => {
    const config = tables.variants
    expect(config.toRow({ sku: ' abc-1 ', fulfillment: 'digital', stock: 3 })).toMatchObject({
      sku: 'ABC-1',
      stock: null,
    })
    expect(config.toRow({ sku: 'ABC-1', fulfillment: 'signed', stock: 3 })).toMatchObject({ sku: 'ABC-1', stock: 3 })
  })

  it("a variant sends the preorder flag always, and its three fields only while it is on (the table's check)", () => {
    const config = tables.variants
    const on = {
      sku: 'ABC-1',
      fulfillment: 'physical',
      stock: 3,
      preorder: true,
      preorder_capacity: 40,
      preorder_ships_on: '2030-01-01',
      preorder_note: '  يصلك بعد الطباعة ',
    }
    expect(config.toRow(on)).toMatchObject({ preorder: true, preorder_capacity: 40, preorder_ships_on: '2030-01-01', preorder_note: 'يصلك بعد الطباعة' })
    // A digital preorder keeps its null stock.
    expect(config.toRow({ ...on, fulfillment: 'digital' })).toMatchObject({ stock: null, preorder: true, preorder_capacity: 40 })
    // Off: false and null for the three, whatever the hidden fields still hold, and for a form that never touched them.
    const off = { preorder: false, preorder_capacity: null, preorder_ships_on: null, preorder_note: null }
    expect(config.toRow({ ...on, preorder: false })).toMatchObject(off)
    expect(config.toRow({ sku: 'A', fulfillment: 'physical', stock: 1 })).toMatchObject(off)
    // A date field the owner cleared is null, never an empty text the column would refuse.
    expect(config.toRow({ ...on, preorder_ships_on: '' })).toMatchObject({ preorder_ships_on: null })
    // The loaded row keeps the stored preorder fields for the form.
    expect(config.fromRow?.({ ...on, stock: null })).toMatchObject({ stock: 0, preorder: true, preorder_ships_on: '2030-01-01' })
  })

  it('notifications: a read-only list for owner and operations, newest first, with no form and no edit page (P08 round 11c)', () => {
    const config = tables.notifications
    expect(config).toMatchObject({ table: 'notifications', label: 'طلبات الإشعار', read: 'staff', insert: false, edit: false })
    expect(config.fields).toEqual([])
    expect(config.toRow({ email: 'a@b.co', status: 'pending' })).toEqual({})
    expect(config.order).toEqual([{ column: 'created_at', ascending: false }])
    // The SKU is the row's variant, read as an embedded relation; the address and the SKU read left to right.
    expect(config.listColumns.map((column) => column.key)).toEqual(['email', 'product_variants(sku)', 'status', 'consent_revision', 'created_at', 'confirmed_at'])
    expect(config.listColumns.filter((column) => column.dir === 'ltr').map((column) => column.key)).toEqual(['email', 'product_variants(sku)'])
    const cell = (key: string, row: Record<string, unknown>) => config.listColumns.find((column) => column.key === key)!.text!(row)
    expect(cell('status', { status: 'pending' })).toBe('بانتظار التأكيد')
    expect(cell('status', { status: 'confirmed' })).toBe('مؤكَّد')
    expect(cell('status', { status: 'unsubscribed' })).toBe('ألغى الاشتراك')
    expect(cell('status', { status: 'something-new' })).toBe('something-new')
    expect(cell('consent_revision', { consent_revision: 3 })).toBe('3')
    expect(cell('consent_revision', { consent_revision: null })).toBe('بلا')
    expect(cell('product_variants(sku)', { product_variants: { sku: 'BOOK-01' } })).toBe('BOOK-01')
    expect(cell('product_variants(sku)', { product_variants: null })).toBe('لا يوجد')
    // The others keep their edit page.
    for (const key of Object.keys(tables) as TableKey[]) expect(tables[key].edit !== false, key).toBe(key !== 'notifications')
  })

  it('a shipping fee may be zero (money min 0), a price may not', () => {
    expect(tables['shipping-rates'].fields.find((field) => field.name === 'fee_halalas')).toMatchObject({ min: 0 })
    expect(tables.variants.fields.find((field) => field.name === 'price_halalas')).not.toMatchObject({ min: 0 })
  })
})

describe('admin editing fixes (AUDIT-1)', () => {
  it('a room saved with an empty title keeps a title in the list and the editor', () => {
    expect(documentTitle('rooms', 'started', { roomLabel: 'الغرفة الأولى', title: '' })).toBe(ROOM_DOC_LABELS.started)
    expect(documentTitle('rooms', 'started', { roomLabel: 'الغرفة الأولى', title: 'بدأتُ' })).toBe('الغرفة الأولى: بدأتُ')
  })

  it('only the five room slugs are room ids, not keys every object inherits', () => {
    for (const slug of ROOM_SLUGS) expect(isRoomSlug(slug)).toBe(true)
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'not-a-room']) {
      expect(isRoomSlug(bad)).toBe(false)
    }
  })

  it('equalData ignores key order at every depth, but not values or list order', () => {
    expect(equalData({ a: 1, b: { c: [1, { x: 1, y: 2 }], d: 'z' } }, { b: { d: 'z', c: [1, { y: 2, x: 1 }] }, a: 1 })).toBe(true)
    expect(equalData({ a: 1 }, { a: 2 })).toBe(false)
    expect(equalData({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  })

  it('a draft that uses a library image is valid as its id and invalid once resolved, so the preview parses first', () => {
    const id = randomUUID()
    const draft = structuredClone(content.rooms.started)
    ;(draft.movements[0] as Record<string, unknown>).vignette = id
    expect(startedRoomSchema.safeParse(draft).success).toBe(true)
    const resolved = structuredClone(draft)
    ;(resolved.movements[0] as Record<string, unknown>).vignette = formatMediaRef({
      base: `https://media.test/m/${id}`,
      width: 1200,
      height: 800,
      widths: [1200],
    })
    expect(startedRoomSchema.safeParse(resolved).success).toBe(false)
  })
})

describe('a new post starts visible (FABLE-AUDIT F3-6 b)', () => {
  it('opens with «ظاهر» ticked; a boolean that says nothing of it still starts unticked', () => {
    expect(defaultsForFields(collections.posts.fields).visible).toBe(true)
    expect(defaultsForFields([{ name: 'on', label: 'مفعّل', type: 'boolean' }])).toEqual({ on: false })
  })

  it('keeps what a saved post holds: a hidden post stays hidden, one with no value takes the starting one', () => {
    expect(withDefaults(postFields, { visible: false }).visible).toBe(false)
    expect(withDefaults(postFields, { visible: true }).visible).toBe(true)
    expect(withDefaults(postFields, {}).visible).toBe(true)
  })

  it('says a live post it hides is live and hidden, in the list and in the message of «نشر»', () => {
    expect(HIDDEN_LIVE_STATUS).toBe('منشور ومخفي عن الموقع')
    expect(liveStatus({ visible: false, title: 'مقال' })).toBe('منشور ومخفي عن الموقع')
    expect(liveStatus({ visible: true })).toBe('منشور')
    // A document with no such field (a room, a policy) is plainly «منشور».
    for (const data of [{}, { title: 'سياسة' }, null, undefined]) expect(liveStatus(data), JSON.stringify(data)).toBe('منشور')
    expect(successMessage('نشر', { rebuilds: true })).toBe('نشر: تم بنجاح. يظهر التعديل على الموقع خلال دقائق.')
    expect(successMessage('نشر', { rebuilds: true, hidden: true })).toBe('نشر: تم بنجاح. منشور ومخفي عن الموقع: «ظاهر» غير مفعّل.')
    expect(successMessage('جدولة')).toBe('جدولة: تم بنجاح.')
  })
})

describe('a photo that is set needs its alt at publish, and a draft saves without it (FABLE-AUDIT F3-6 c)', () => {
  const issuesOf = (schema: { safeParse: (data: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, data: unknown) => {
    const result = schema.safeParse(data)
    return result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('refuses a blank alt on the passed gallery, the shelf\'s photos and images and the book\'s five kinds of image', () => {
    const passed = structuredClone(content.rooms.passed)
    passed.media.gallery[2]!.alt = ''
    expect(issuesOf(schemaFor('rooms', 'passed'), passed)).toEqual([`media.gallery.2.alt: ${PHOTO_ALT_ERROR}`])

    const shelf = structuredClone(content.rooms.shelf)
    shelf.items.thura.photos[1]!.alt = '   '
    shelf.items.moonlightCup.images[0]!.alt = ''
    expect(issuesOf(schemaFor('rooms', 'shelf'), shelf)).toEqual([
      `items.thura.photos.1.alt: ${PHOTO_ALT_ERROR}`,
      `items.moonlightCup.images.0.alt: ${PHOTO_ALT_ERROR}`,
    ])

    const book = structuredClone(content.rooms.book)
    book.cover.alt = ''
    book.standing.alt = ''
    book.spine.alt = ''
    book.bookmark.alt = ''
    book.photos[3]!.alt = ''
    expect(issuesOf(schemaFor('rooms', 'book'), book)).toEqual(
      ['cover', 'standing', 'spine', 'bookmark', 'photos.3'].map((where) => `${where}.alt: ${PHOTO_ALT_ERROR}`),
    )
    expect(PHOTO_ALT_ERROR).toBe('اكتب الوصف البديل للصورة.')
  })

  // The auditor's B6: the built room's logo is a photo too ({id, alt}), and the picker already fills its alt.
  it('refuses a blank alt on the built room\'s logo (its image is required)', () => {
    const built = structuredClone(content.rooms.built)
    expect(issuesOf(schemaFor('rooms', 'built'), built)).toEqual([])
    built.media.logo.alt = ' '
    expect(issuesOf(schemaFor('rooms', 'built'), built)).toEqual([`media.logo.alt: ${PHOTO_ALT_ERROR}`])
  })

  it('refuses a blank alt on the home portrait, beside it in the settings', () => {
    const settings = structuredClone(siteSettingsData)
    settings.home.portraitAlt = ''
    expect(issuesOf(schemaFor('site_settings', 'site'), settings)).toEqual([`home.portraitAlt: ${PHOTO_ALT_ERROR}`])
  })

  it('saves a draft with the alt blank: the stored schemas the form saves and the loaders read accept it', () => {
    const passed = structuredClone(content.rooms.passed)
    passed.media.gallery[0]!.alt = ''
    expect(roomSchemas.passed.safeParse(passed).success).toBe(true)
    const settings = structuredClone(siteSettingsData)
    settings.home.portraitAlt = ''
    expect(siteSettingsStoredSchema.safeParse(settings).success).toBe(true)
  })

  it('leaves the seeded documents as they are: every image there carries its alt', () => {
    for (const slug of ROOM_SLUGS) expect(issuesOf(schemaFor('rooms', slug), (content.rooms as Record<string, unknown>)[slug]), slug).toEqual([])
    expect(issuesOf(schemaFor('site_settings', 'site'), siteSettingsData)).toEqual([])
  })

  it('finds the alt that goes with an image among its siblings: `alt`, or `<name>Alt` for the home portrait, else none', () => {
    expect(altSibling(galleryPhotoFields, galleryPhotoFields[0])).toBe('alt')
    const portrait = homeFields.find((field) => field.name === 'portrait')!
    expect(altSibling(homeFields, portrait)).toBe('portraitAlt')
    // A cover and a vignette have no alt of their own to fill.
    expect(altSibling(postFields, postFields.find((field) => field.name === 'cover')!)).toBeNull()
    expect(altSibling(startedMovementFields, startedMovementFields.find((field) => field.name === 'vignette')!)).toBeNull()
  })

  it('fills an empty alt from the library\'s when an image is picked, and never replaces words already written', () => {
    expect(withPickedImage({ id: '', alt: '' }, 'id', 'alt', 'media-1', 'كوب مزخرف')).toEqual({ id: 'media-1', alt: 'كوب مزخرف' })
    expect(withPickedImage({ id: 'old', alt: '   ' }, 'id', 'alt', 'media-2', 'كوب مزخرف')).toEqual({ id: 'media-2', alt: 'كوب مزخرف' })
    expect(withPickedImage({ id: 'old', alt: 'وصف كتبه أنس' }, 'id', 'alt', 'media-2', 'كوب مزخرف')).toEqual({ id: 'media-2', alt: 'وصف كتبه أنس' })
    // The library holds no words for it (or the image has no alt field): only the id changes, and the other keys stay.
    expect(withPickedImage({ id: '', alt: '' }, 'id', 'alt', 'media-3', '  ')).toEqual({ id: 'media-3', alt: '' })
    expect(withPickedImage({ portrait: '', tagline: 'x' }, 'portrait', null, 'media-4', 'وصف')).toEqual({ portrait: 'media-4', tagline: 'x' })
    expect(withPickedImage({ portrait: '', portraitAlt: '' }, 'portrait', 'portraitAlt', 'media-5', 'أنس')).toEqual({ portrait: 'media-5', portraitAlt: 'أنس' })
  })
})

describe('the publish bar of a policy and of a document never published (FABLE-AUDIT F3-6 a, d)', () => {
  const bar = (over: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(PublishBar, {
        collection: 'posts',
        docId: 'a-post',
        seq: 2,
        liveSeq: 2,
        scheduledAt: null,
        scheduledSeq: null,
        canPublish: true,
        canArchive: true,
        previewPath: null,
        onChanged: () => {},
        ...over,
      } as never),
    ).replaceAll('<!-- -->', '')

  it('says above «نشر» and «جدولة» that publishing a policy stops buying until the owner approves again', () => {
    expect(POLICY_PUBLISH_NOTE).toBe('نشر تعديل على سياسة معتمدة يوقف الشراء حتى يعيد المالك اعتماد السياسات من الإعدادات.')
    const policy = bar({ collection: 'policies', docId: 'store', canArchive: false })
    expect(policy).toContain(POLICY_PUBLISH_NOTE)
    expect(policy.indexOf(POLICY_PUBLISH_NOTE)).toBeLessThan(policy.indexOf('>نشر<'))
    expect(policy.indexOf(POLICY_PUBLISH_NOTE)).toBeLessThan(policy.indexOf('>جدولة<'))
    expect(bar({})).not.toContain(POLICY_PUBLISH_NOTE)
  })

  it('ends the success message of a policy\'s publish and schedule with that warning, and no other message', () => {
    expect(successMessage('نشر', { rebuilds: true, policy: true })).toBe(`نشر: تم بنجاح. يظهر التعديل على الموقع خلال دقائق. ${POLICY_PUBLISH_NOTE}`)
    expect(successMessage('جدولة', { policy: true })).toBe(`جدولة: تم بنجاح. ${POLICY_PUBLISH_NOTE}`)
    expect(successMessage('أرشفة', { rebuilds: true })).not.toContain(POLICY_PUBLISH_NOTE)
    expect(successMessage('إلغاء الجدولة')).toBe('إلغاء الجدولة: تم بنجاح.')
  })

  it('offers «أرشفة» only for a document that was published, and asks first', () => {
    expect(ARCHIVE_CONFIRM).toBe('أرشفة المستند تزيله من الموقع. متابعة؟')
    expect(bar({ liveSeq: 2 })).toContain('>أرشفة<')
    expect(bar({ liveSeq: null })).not.toContain('>أرشفة<')
    expect(bar({ liveSeq: 2, canArchive: false })).not.toContain('>أرشفة<')
  })
})
