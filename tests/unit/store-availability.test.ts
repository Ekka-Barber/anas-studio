// P08 round 10b: the pure parts of the product page's availability island and
// sign-up form (src/components/store/VariantAction.tsx, src/lib/store.ts): the
// strict parser of `catalog_availability()`, the one read a page makes, what
// each state makes a row offer (a missing row and an unknown state included),
// and the privacy revision the sign-up records. The island and the form
// themselves are in tests/e2e/product-availability.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseAvailability, preorderCurrent, rowView } from '../../src/components/store/VariantAction'
import { consentRevision } from '../../src/lib/store'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const reply = [
  { variant_id: A, state: 'available' },
  { variant_id: B, state: 'out_of_stock' },
]

describe('parseAvailability: catalog_availability() read strictly', () => {
  it('reads each variant\'s state, and an empty answer is no variant on the shelf', () => {
    expect(parseAvailability(reply)).toEqual(
      new Map([
        [A, 'available'],
        [B, 'out_of_stock'],
      ]),
    )
    expect(parseAvailability([]).size).toBe(0)
  })

  it('keeps a state it does not know as written: the row decides what that means (no information)', () => {
    expect(parseAvailability([{ variant_id: A, state: 'back_soon' }]).get(A)).toBe('back_soon')
  })

  it('refuses anything that is not an array of exactly {variant_id, state}', () => {
    for (const bad of [
      null,
      undefined,
      'available',
      { variant_id: A, state: 'available' },
      [null],
      ['available'],
      [[A, 'available']],
      [{ variant_id: A }],
      [{ state: 'available' }],
      [{ variant_id: A, state: 'available', stock: 3 }],
      [{ variant_id: A, state: 'available', extra: null }],
      [{ variant_id: A, state: null }],
      [{ variant_id: A, state: 1 }],
      [{ variant_id: 7, state: 'available' }],
      [{ variant_id: null, state: 'available' }],
    ]) {
      expect(() => parseAvailability(bad), JSON.stringify(bad)).toThrow()
    }
  })

  it('refuses an id that is not a lower-case UUID, and a variant that appears twice', () => {
    for (const id of ['', 'abc', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', `${A} `, A.slice(1), `${A}0`]) {
      expect(() => parseAvailability([{ variant_id: id, state: 'available' }]), id).toThrow()
    }
    expect(() =>
      parseAvailability([
        { variant_id: A, state: 'available' },
        { variant_id: A, state: 'out_of_stock' },
      ]),
    ).toThrow()
    // One bad row refuses the whole answer: the page then knows nothing, and never half of it.
    expect(() => parseAvailability([...reply, { variant_id: 'x', state: 'available' }])).toThrow()
  })
})

describe('rowView: what a row offers', () => {
  const D = '44444444-4444-4444-8444-444444444444'
  const E = '55555555-5555-4555-8555-555555555555'
  const states = new Map([
    [A, 'available'],
    [B, 'preorder'],
    [C, 'out_of_stock'],
    [D, 'unpriced'],
    [E, 'back_soon'],
  ])

  it('before the states arrive, or when the read failed: the add control, as the static page made it', () => {
    for (const hasPreorder of [false, true]) expect(rowView(null, A, hasPreorder)).toBe('add')
  })

  it('available: the add control; out of stock: the sign-up; unpriced: «غير مسعّر»', () => {
    expect(rowView(states, A, false)).toBe('add')
    expect(rowView(states, C, false)).toBe('out_of_stock')
    expect(rowView(states, D, false)).toBe('unpriced')
  })

  it('preorder: its wording and «اطلب مسبقًا», when the build carried the date and note', () => {
    expect(rowView(states, B, true)).toBe('preorder')
  })

  it('a preorder state the build has no date and note for stays the add control: no preorder wording without them', () => {
    expect(rowView(states, B, false)).toBe('add')
  })

  it('a variant with no entry is disabled or no longer published: «غير متاح حاليًا», whatever it was when built', () => {
    expect(rowView(states, '66666666-6666-4666-8666-666666666666', false)).toBe('gone')
    expect(rowView(states, '66666666-6666-4666-8666-666666666666', true)).toBe('gone')
    // Nothing on the shelf at all: every row is gone, not "no information".
    expect(rowView(new Map(), A, false)).toBe('gone')
  })

  it('a state it does not know says nothing about the row: the add control, as with no information', () => {
    expect(rowView(states, E, false)).toBe('add')
    expect(rowView(states, E, true)).toBe('add')
  })

  it('never shows preorder wording for a variant that is not a preorder, whatever the state', () => {
    for (const state of ['available', 'out_of_stock', 'unpriced', 'back_soon']) {
      expect(rowView(new Map([[A, state]]), A, false)).not.toBe('preorder')
      expect(rowView(new Map([[A, state]]), A, true)).not.toBe('preorder')
    }
    expect(rowView(new Map([[A, 'preorder']]), A, false)).not.toBe('preorder')
  })
})

describe('preorderCurrent: a build\'s preorder date is shown only while it has not passed in Riyadh', () => {
  // 2026-10-03 21:30 UTC is already 2026-10-04 00:30 in Riyadh.
  const lateEvening = new Date('2026-10-03T21:30:00Z')

  it('today and later dates are current; earlier ones are not', () => {
    expect(preorderCurrent('2026-10-04', lateEvening)).toBe(true)
    expect(preorderCurrent('2026-12-01', lateEvening)).toBe(true)
    expect(preorderCurrent('2026-10-03', lateEvening)).toBe(false)
  })

  it('a stale build whose date passed shows the add control even while the live state says preorder', () => {
    const shown = rowView(new Map([[A, 'preorder']]), A, preorderCurrent('2026-10-03', lateEvening))
    expect(shown).toBe('add')
  })
})

describe('fetchAvailability and loadAvailability: one read for a page, and a failed read is no information', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  /** The module afresh: `loadAvailability` keeps its one promise in module state. */
  async function fresh() {
    vi.resetModules()
    return import('../../src/components/store/VariantAction')
  }

  it('reads the Data API function as anon with the publishable key and never from a cache', async () => {
    const fetchSpy = vi.fn(async () => Response.json(reply))
    vi.stubGlobal('fetch', fetchSpy)
    const { fetchAvailability } = await fresh()
    expect(await fetchAvailability()).toEqual(parseAvailability(reply))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://supabase.test/rest/v1/rpc/catalog_availability')
    expect(init.headers).toEqual({ apikey: 'publishable' })
    expect(init.cache).toBe('no-store')
  })

  it('throws on a refusal and on an answer that does not parse', async () => {
    const { fetchAvailability } = await fresh()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(fetchAvailability()).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ variant_id: A, state: 'available', stock: 3 }])))
    await expect(fetchAvailability()).rejects.toThrow()
  })

  it('every row of a page shares one read', async () => {
    const fetchSpy = vi.fn(async () => Response.json(reply))
    vi.stubGlobal('fetch', fetchSpy)
    const { loadAvailability } = await fresh()
    const rows = await Promise.all([loadAvailability(), loadAvailability(), loadAvailability()])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    for (const read of rows) expect(read?.get(B)).toBe('out_of_stock')
    // A row that mounts later still shares it.
    expect((await loadAvailability())?.get(A)).toBe('available')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a read that fails is null for every row, and is not asked again within the page', async () => {
    const fetchSpy = vi.fn(async () => new Response('down', { status: 500 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { loadAvailability } = await fresh()
    expect(await Promise.all([loadAvailability(), loadAvailability()])).toEqual([null, null])
    expect(await loadAvailability()).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a page opened by a client navigation a minute after the last read asks again, one opened sooner shares it', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
      let answer: unknown = reply
      const fetchSpy = vi.fn(async () => Response.json(answer))
      vi.stubGlobal('fetch', fetchSpy)
      const { loadAvailability } = await fresh()
      expect((await loadAvailability())?.get(B)).toBe('out_of_stock')
      vi.setSystemTime(new Date('2026-10-03T12:00:59Z'))
      await loadAvailability()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // The variant came back in stock meanwhile: the next page sees it.
      answer = [{ variant_id: B, state: 'available' }]
      vi.setSystemTime(new Date('2026-10-03T12:01:00Z'))
      expect((await loadAvailability())?.get(B)).toBe('available')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      // A failed read is asked again after the minute too, and is not kept for the session.
      fetchSpy.mockImplementation(async () => new Response('down', { status: 500 }))
      vi.setSystemTime(new Date('2026-10-03T12:02:00Z'))
      expect(await loadAvailability()).toBeNull()
      fetchSpy.mockImplementation(async () => Response.json(reply))
      vi.setSystemTime(new Date('2026-10-03T12:03:00Z'))
      expect((await loadAvailability())?.get(A)).toBe('available')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a lost connection is null too, never an exception for the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const { loadAvailability } = await fresh()
    expect(await loadAvailability()).toBeNull()
  })
})

describe('consentRevision: the privacy policy revision a sign-up records', () => {
  const policy = (seq: number) => ({ data: {}, seq })

  it('is the revision of the privacy policy this build rendered', () => {
    const all = { privacy: policy(7), store: policy(1), delivery: policy(2), refund: policy(3) }
    expect(consentRevision(all)).toBe(7)
    expect(consentRevision({ privacy: policy(1) })).toBe(1)
  })

  it('is null while no privacy policy is published: the other policies are not it', () => {
    expect(consentRevision({ privacy: null })).toBeNull()
    const others = { privacy: null, store: policy(1), delivery: policy(2), refund: policy(3) }
    expect(consentRevision(others)).toBeNull()
  })
})
