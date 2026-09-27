import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { documentTitle, schemaFor } from '../../src/admin/collections'
import { POLICY_DOC_IDS, POLICY_DOC_LABELS, policySchema } from '../../src/admin/collections/policies'
import { siteSettingsStoredSchema } from '../../src/admin/collections/site-settings'
import { tables, type TableKey } from '../../src/admin/tables'
import { type Field, schemaFromFields } from '../../src/admin/fields'
import content from '../../content/initial-content.json'

const ROOM_SLUGS = ['started', 'built', 'passed', 'shelf'] as const

const siteSettingsData = { nav: content.nav, footer: content.footer, home: content.home }

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
    bad.vignette.id = 'not-a-real-image-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('accepts a media-library id for an image field (P05)', () => {
    const doc = structuredClone(content.rooms.started)
    doc.vignette.id = randomUUID()
    expect(schemaFor('rooms', 'started').safeParse(doc).success).toBe(true)
  })

  it('rejects an unknown video id', () => {
    const bad = structuredClone(content.rooms.started)
    bad.media.reels[0]!.id = 'not-a-real-video-id'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('rejects a slug with characters outside a-z0-9-', () => {
    const bad = structuredClone(content.rooms.started)
    bad.slug = 'Not A Valid Slug!'
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
  })

  it('rejects a document missing a required field', () => {
    const bad = structuredClone(content.rooms.started) as Record<string, unknown>
    delete bad.roomLabel
    expect(schemaFor('rooms', 'started').safeParse(bad).success).toBe(false)
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

  it('the real fixture has no hidden items to begin with', () => {
    for (const slug of ROOM_SLUGS) {
      const room = (content.rooms as Record<string, unknown>)[slug]
      expect(JSON.stringify(room)).not.toContain('"hidden":true')
    }
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

describe('the policies collection (P07 round 2)', () => {
  const lexicalBody = { root: { type: 'root', children: [] } }

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
// update grants): a config whose `toRow` outputs anything else writes a
// column the migration never granted.
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
    'digital_asset',
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

  it('a shipping fee may be zero (money min 0), a price may not', () => {
    expect(tables['shipping-rates'].fields.find((field) => field.name === 'fee_halalas')).toMatchObject({ min: 0 })
    expect(tables.variants.fields.find((field) => field.name === 'price_halalas')).not.toMatchObject({ min: 0 })
  })
})
