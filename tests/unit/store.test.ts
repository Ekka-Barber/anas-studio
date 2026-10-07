// P08 round 10b: what the build reads of a variant (src/lib/store.ts): a
// preorder's delivery date and note, and never stock or capacity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEDIA_ORIGIN, parseMediaRef } from '../../src/lib/media-ref'
import { getProducts } from '../../src/lib/store'

const PRODUCT = '0a000000-0000-4000-8000-000000000001'
const EMPTY = { root: { type: 'root', children: [] } }
const product = { id: PRODUCT, slug: 'khous', title: 'كتاب', summary: '', body: EMPTY, cover_image: null, sort_order: 0, demo: false }
let counter = 0
const variant = (over: Record<string, unknown> = {}) => {
  counter += 1
  return {
    id: `0b000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    product_id: PRODUCT,
    sku: `SKU-${counter}`,
    title: `النسخة ${counter}`,
    fulfillment: 'physical',
    price_halalas: 2360,
    sort_order: counter,
    preorder: false,
    preorder_ships_on: null,
    preorder_note: null,
    ...over,
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Serves the one product and these variant rows; returns the URLs asked. */
function catalog(variants: unknown[]): string[] {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url)
      return Response.json(url.includes('/rest/v1/products?') ? [product] : variants)
    }),
  )
  return asked
}

describe('getProducts: a variant\'s preorder', () => {
  it('carries the date and the note of a preorder, and null for every other variant', async () => {
    // The page lists variants by their sort order: the plain one first.
    const plain = variant()
    const preorder = variant({ preorder: true, preorder_ships_on: '2026-12-01', preorder_note: 'تُشحن بعد وصول النسخ من المطبعة' })
    catalog([preorder, plain])
    const [loaded] = await getProducts()
    expect(loaded!.variants.map((entry) => entry.preorder)).toEqual([null, { shipsOn: '2026-12-01', note: 'تُشحن بعد وصول النسخ من المطبعة' }])
  })

  it('shows no preorder for a variant the owner switched back, even when its date and note were left in the row', async () => {
    catalog([variant({ preorder: false, preorder_ships_on: '2026-12-01', preorder_note: 'ملاحظة قديمة' })])
    const [loaded] = await getProducts()
    expect(loaded!.variants[0]!.preorder).toBeNull()
  })

  it('never shows half of a preorder', async () => {
    catalog([variant({ preorder: true, preorder_ships_on: '2026-12-01', preorder_note: null }), variant({ preorder: true, preorder_ships_on: null, preorder_note: 'ملاحظة' })])
    const [loaded] = await getProducts()
    expect(loaded!.variants.map((entry) => entry.preorder)).toEqual([null, null])
  })

  it('asks for the preorder columns anon may read, and never for stock or capacity', async () => {
    const asked = catalog([variant()])
    await getProducts()
    const select = new URL(asked.find((url) => url.includes('/rest/v1/product_variants?'))!).searchParams.get('select')!.split(',')
    expect(select).toEqual(expect.arrayContaining(['preorder', 'preorder_ships_on', 'preorder_note']))
    for (const secret of ['stock', 'preorder_capacity', 'digital_asset', 'low_stock_threshold']) expect(select).not.toContain(secret)
  })

  it('fails the build on a row that is not what the table holds (the last good deployment stays live)', async () => {
    catalog([variant({ preorder: true, preorder_ships_on: '1 ديسمبر', preorder_note: 'ملاحظة' })])
    await expect(getProducts()).rejects.toThrow()
    catalog([variant({ preorder: 'yes' })])
    await expect(getProducts()).rejects.toThrow()
  })
})

describe('getProducts: a product cover (CLIENT-SEC-08)', () => {
  const MEDIA = '0c000000-0000-4000-8000-000000000001'
  /** The cover the build gives the one product whose `cover_image` is `stored`; the library holds MEDIA. */
  async function cover(stored: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/products?')) return Response.json([{ ...product, cover_image: stored }])
        if (url.includes('/rest/v1/media?')) return Response.json([{ id: MEDIA, derivatives: [{ width: 720, height: 960 }], alt_ar: 'الغلاف' }])
        return Response.json([])
      }),
    )
    return (await getProducts())[0]!.cover
  }

  it('draws a library picture from the media origin, a reference to a path on the site, and a manifest id', async () => {
    expect(parseMediaRef(await cover(MEDIA))?.base).toBe(`${MEDIA_ORIGIN}/m/${MEDIA}`)
    expect(await cover('media|/images/cover|720x960|720')).toBe('media|/images/cover|720x960|720')
    expect(await cover('book-cover')).toBe('book-cover')
  })

  it.each([
    ['another host', `media|https://other.host/m/${MEDIA}|720x960|720`],
    ['a host after two slashes', 'media|//other.host/cover|720x960|720'],
    ['a host after a slash and a backslash', 'media|/\\other.host/cover|720x960|720'],
    ['a host after a slash and a tab, which the browser drops', 'media|/\t/other.host/cover|720x960|720'],
  ])('draws no image for a reference to %s', async (_label, stored) => {
    expect(await cover(stored)).toBeNull()
  })
})
