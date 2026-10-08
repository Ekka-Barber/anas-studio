// The book page (كتبتُ هنا) is the fifth document of the rooms collection: its
// schema, its seed, its loader and the characters section of its view.
import { randomUUID } from 'node:crypto'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BookPage, { generateMetadata } from '../../src/app/(public)/book/page'
import { collections, documentTitle, isRoomSlug, ROOM_DOC_LABELS, schemaFor } from '../../src/admin/collections'
import { bookEditionFields, bookRoomFields, bookRoomSchema } from '../../src/admin/collections/rooms'
import { BookView } from '../../src/components/public/book/BookView'
import { PAGE_LABELS, PREVIEW_URL } from '../../src/lib/book-preview'
import { getBookRoom, type BookRoom } from '../../src/lib/content'
import { formatMoney, typeset } from '../../src/lib/format'
import type { EditionOffer } from '../../src/lib/store'
import { parseMediaRef } from '../../src/lib/media-ref'
import content from '../../content/initial-content.json'
import preview from '../../content/book-preview-text.json'
import manifest from '../../content/book-source-manifest.json'

// BookView imports through the `@/` alias, which the unit config does not resolve:
// each import is redirected to the real file, except the ones that need a browser or the manifest.
vi.mock('@/admin/collections', async () => import('../../src/admin/collections'))
// The reader needs a browser; its stand-in shows what the page hands it (whether the editions section is drawn).
vi.mock('@/components/book/BookPreview', () => ({
  BookPreview: ({ editions }: { editions?: boolean }) => createElement('div', { 'data-editions': String(editions) }),
}))
vi.mock('@/components/public/book/BookView', async () => import('../../src/components/public/book/BookView'))
vi.mock('@/components/public/Picture', () => ({ Picture: () => null }))
vi.mock('@/components/weave/SectionNav', () => ({
  SectionNav: ({ sections }: { sections: Array<{ id: string; label: string }> }) =>
    createElement('nav', null, sections.map((section) => createElement('a', { key: section.id, href: `#${section.id}` }, section.label))),
}))
vi.mock('@/components/weave/Action', async () => import('../../src/components/weave/Action'))
vi.mock('@/components/weave/Band', async () => import('../../src/components/weave/Band'))
vi.mock('@/components/weave/Edge', async () => import('../../src/components/weave/Edge'))
vi.mock('@/components/weave/Figure', async () => import('../../src/components/weave/Figure'))
vi.mock('@/components/weave/layout.module.css', async () => import('../../src/components/weave/layout.module.css'))
vi.mock('@/components/weave/Lines', async () => import('../../src/components/weave/Lines'))
vi.mock('@/components/weave/motion', async () => import('../../src/components/weave/motion'))
vi.mock('@/components/weave/RoomNav', async () => import('../../src/components/weave/RoomNav'))
vi.mock('@/lib/content', async () => import('../../src/lib/content'))
vi.mock('@/lib/format', async () => import('../../src/lib/format'))
vi.mock('@/lib/images', () => ({ imageSources: () => ({ src: '/c.webp', srcSet: '/c.webp 1w', width: 1, height: 1 }) }))
vi.mock('@/lib/store', async () => import('../../src/lib/store'))

const book = content.rooms.book as BookRoom

describe('the book room document', () => {
  it('is a room: its id, label, fields and title are registered like the other four', () => {
    expect(isRoomSlug('book')).toBe(true)
    expect(ROOM_DOC_LABELS.book).toBe('كتبتُ هنا')
    expect(collections.rooms.fields.book).toBe(bookRoomFields)
    expect(documentTitle('rooms', 'book', book)).toBe('كتبتُ هنا: خوص')
  })

  it('is the seed, and the publish gate accepts it', () => {
    expect(schemaFor('rooms', 'book').safeParse(book).success).toBe(true)
    expect(Object.keys(book).sort()).toEqual(Object.keys(bookRoomSchema.parse(book)).sort())
  })

  it('refuses a character without a name, and takes a book without characters', () => {
    const nameless = structuredClone(book)
    nameless.characters[0]!.name = '  '
    expect(schemaFor('rooms', 'book').safeParse(nameless).success).toBe(false)
    expect(schemaFor('rooms', 'book').safeParse({ ...book, characters: [] }).success).toBe(true)
  })

  it('takes an edition with the store variant it is sold as, or without one, as an edition published before the field was', () => {
    const gate = schemaFor('rooms', 'book')
    expect(book.editions.every((edition) => !('variantSku' in edition))).toBe(true)
    expect(gate.safeParse(book).success).toBe(true)
    const named = structuredClone(book)
    named.editions[0]!.variantSku = 'KHOUS-SIGNED'
    // A new edition in the editor starts with every field empty: an empty SKU is no SKU, and no reason to refuse the document.
    named.editions.push({ name: 'جديدة', text: '', variantSku: '' })
    expect(gate.safeParse(named).success).toBe(true)
    expect(bookRoomSchema.parse(named).editions[0]!.variantSku).toBe('KHOUS-SIGNED')
    const field = bookEditionFields.find((candidate) => candidate.name === 'variantSku')
    expect(field).toMatchObject({ type: 'text', required: false })
  })

  it('names a SKU the store could never hold at save, with the variants form’s own words', () => {
    const gate = schemaFor('rooms', 'book')
    for (const sku of ['khous-signed', 'K', 'KHOUS-2026']) {
      const named = structuredClone(book)
      named.editions[0]!.variantSku = sku
      expect(gate.safeParse(named).success, sku).toBe(true)
    }
    for (const sku of ['-KHOUS', 'KHOUS SIGNED', 'خوص', `K${'X'.repeat(40)}`]) {
      const named = structuredClone(book)
      named.editions[0]!.variantSku = sku
      const parsed = gate.safeParse(named)
      expect(parsed.success, sku).toBe(false)
      expect(parsed.error?.issues[0]?.message, sku).toBe('حروف لاتينية وأرقام وشرطات، من 1 إلى 40، ولا يبدأ بشرطة.')
    }
  })

  it('has characters named and quoted only from the pages Anas provided, with nothing else about them', () => {
    // The preview text keeps the book's line wraps; a line is one sentence of it.
    const pages = preview.pages.join('\n').replace(/\s+/g, ' ')
    expect(book.characters.map((character) => character.name)).toEqual(['أنس', 'الأمهات', 'الجارة', 'أطفال الحي'])
    for (const character of book.characters) {
      expect(Object.keys(character).sort()).toEqual(['line', 'name', 'source'])
      expect(pages, character.name).toContain(character.line)
    }
  })
})

describe('getBookRoom', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reads the published document and resolves a library picture in it, leaving the committed ones alone', async () => {
    const id = randomUUID()
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url)
        return url.includes('/published_documents')
          ? Response.json([{ data: { ...book, cover: { id, alt: book.cover.alt } } }])
          : Response.json([{ id, derivatives: [{ width: 800, height: 1000 }], alt_ar: 'غلاف' }])
      }),
    )
    const room = await getBookRoom()
    expect(requested[0]).toContain('doc_id=eq.book')
    expect(parseMediaRef(room.cover.id)).toMatchObject({ width: 800, height: 1000 })
    expect(room.standing.id).toBe(book.standing.id)
    expect(room.characters).toEqual(book.characters)
  })

  it('fails the build for a missing document or a character without a name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
    await expect(getBookRoom()).rejects.toThrow('Missing published document: rooms/book')
    const { name: _name, ...nameless } = book.characters[0]!
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ data: { ...book, characters: [nameless] } }])))
    await expect(getBookRoom()).rejects.toThrow()
  })
})

describe('the characters section of the book page', () => {
  const html = (room: BookRoom) => renderToStaticMarkup(createElement(BookView, { book: room }))

  it('has a card for each character, with the name as its heading, the line quoted and its source, and a link in the contents', () => {
    const page = html(book)
    expect(page).toContain('id="characters"')
    expect(page).toContain('href="#characters"')
    for (const character of book.characters) {
      expect(page).toContain(`<h3 class="t-card">${character.name}</h3>`)
      // A quotation drops its closing full stop, as the excerpts do, and is typeset like the rest.
      expect(page).toContain(`${typeset(character.line.replace(/\s*\.$/, '')).replaceAll('"', '&quot;')}<span aria-hidden="true"`)
    }
    expect(page.indexOf('id="excerpts"')).toBeLessThan(page.indexOf('id="characters"'))
    expect(page.indexOf('id="characters"')).toBeLessThan(page.indexOf('id="pages"'))
  })

  it('shows no section and no contents link without characters', () => {
    const page = html({ ...book, characters: [] })
    expect(page).not.toContain('characters')
    expect(page).not.toContain('الشخصيات')
  })
})

/** How many links on the page lead to the section `id`: the contents strip, and the hero's own way to the editions. */
const links = (page: string, id: string) => page.split(`href="#${id}"`).length - 1

describe('the optional sections of the book page (DSN-PAGES-18)', () => {
  const html = (room: BookRoom) => renderToStaticMarkup(createElement(BookView, { book: room }))
  const IDS = ['about', 'excerpts', 'characters', 'pages', 'photos', 'journey', 'editions']

  it('has every section and its contents link while every list has items', () => {
    const page = html(book)
    for (const id of IDS) expect(page, id).toContain(`id="${id}"`)
    for (const id of IDS.filter((id) => id !== 'about' && id !== 'journey')) expect(links(page, id), id).toBeGreaterThan(0)
  })

  it.each(['excerpts', 'photos', 'editions'] as const)('draws no %s section and no link to it while that list is empty, and keeps the others', (list) => {
    const page = html({ ...book, [list]: [] })
    expect(page).not.toContain(`id="${list}"`)
    expect(links(page, list)).toBe(0)
    for (const id of IDS.filter((id) => id !== list)) expect(page, id).toContain(`id="${id}"`)
  })
})

describe('the editions of the book page (DSN-PAGES-08)', () => {
  const html = (room: BookRoom, offers?: readonly (EditionOffer | null)[]) =>
    renderToStaticMarkup(createElement(BookView, { book: room, offers }))
  const soon = (page: string) => page.split('يُعلن قريباً').length - 1
  const heading = (page: string) => /<h2 id="editions-title"[^>]*>([^<]*)<\/h2>/.exec(page)?.[1]

  it('keep «يُعلن قريباً» under «قريباً» and lead nowhere while no edition has an offer (the seed, and the admin’s preview)', () => {
    for (const page of [html(book), html(book, []), html(book, [null, null])]) {
      expect(soon(page)).toBe(book.editions.length)
      expect(heading(page)).toBe('قريباً')
      expect(page).not.toContain('/store/')
      expect(page).not.toContain('اطلب النسخة')
    }
  })

  it('show the variant’s price and a link to its product for an edition that has an offer, and only for it', () => {
    const page = html(book, [{ slug: 'khous', priceHalalas: 5900 }, null])
    expect(page).toContain(`<span>${formatMoney(5900)}</span>`)
    expect(page).toContain('href="/store/khous"')
    expect(page.split('اطلب النسخة').length - 1).toBe(2)
    // The link names its edition, and its name starts with the words it shows.
    expect(page).toContain(`aria-label="اطلب النسخة: ${book.editions[0]!.name}"`)
    expect(soon(page)).toBe(book.editions.length - 1)
    // Something can be bought: the section is no longer announced as coming.
    expect(heading(page)).toBe('النسخ')
  })

  it('give each edition its own price, never «من» the product’s cheapest', () => {
    const page = html(book, [
      { slug: 'khous', priceHalalas: 3500 },
      { slug: 'khous', priceHalalas: 9900 },
    ])
    expect(page).toContain(`<span>${formatMoney(3500)}</span>`)
    expect(page).toContain(`<span>${formatMoney(9900)}</span>`)
    expect(page).not.toContain('<span>من ')
  })

  it('tell the reader whether its closing words may link to them (R4 of the D1 re-audit)', () => {
    expect(html(book)).toContain('data-editions="true"')
    const none = html({ ...book, editions: [] })
    expect(none).toContain('data-editions="false"')
    expect(none).not.toContain('data-editions="true"')
  })

  it('draw the hero’s way to them only while there are editions', () => {
    expect(links(html(book), 'editions')).toBe(2)
    expect(links(html({ ...book, editions: [] }), 'editions')).toBe(0)
  })

  it('name the shelf on the way back by the name they are given, and keep «على الرف» without one', () => {
    const draw = (backName?: string) => renderToStaticMarkup(createElement(BookView, { book, backName }))
    expect(draw()).toContain('على الرف')
    expect(draw('الرف الجديد')).toContain('الرف الجديد')
  })
})

describe('the book page (DSN-PAGES-08, DSN-PAGES-09)', () => {
  const PRODUCT = '0a000000-0000-4000-8000-000000000001'
  const EMPTY = { root: { type: 'root', children: [] } }
  const productRow = { id: PRODUCT, slug: 'khous', title: 'كتاب', summary: '', body: EMPTY, cover_image: null, sort_order: 0, demo: false }
  const variantRow = (sku: string, price: number | null, n = 1) => ({
    id: `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    product_id: PRODUCT,
    sku,
    title: 'النسخة',
    fulfillment: 'physical',
    price_halalas: price,
    sort_order: n,
    preorder: false,
    preorder_ships_on: null,
    preorder_note: null,
  })
  const named = (...skus: Array<string | undefined>): BookRoom => ({
    ...book,
    editions: book.editions.map((edition, i) => ({ ...edition, variantSku: skus[i] })),
  })

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  /** Serves the book document and the settings (for the menu), and the store's products and variants. */
  function serve(room: BookRoom, products: unknown[] = [], variants: unknown[] = []) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/published_documents')) {
          const site = new URL(url).searchParams.get('doc_id') === 'eq.site'
          return Response.json([{ data: site ? { nav: content.nav, footer: content.footer, home: content.home } : room }])
        }
        if (url.includes('/rest/v1/products?')) return Response.json(products)
        if (url.includes('/rest/v1/product_variants?')) return Response.json(variants)
        return Response.json([])
      }),
    )
  }
  const render = async () => renderToStaticMarkup(await BookPage())

  it('offers an edition that names a priced variant at that variant’s price and its product’s page, and leaves the others as they were', async () => {
    serve(named('KHOUS-EBOOK', undefined), [productRow], [variantRow('KHOUS-EBOOK', 5900)])
    const page = await render()
    expect(page).toContain(`<span>${formatMoney(5900)}</span>`)
    expect(page).toContain('href="/store/khous"')
    expect(page.split('يُعلن قريباً').length - 1).toBe(1)
  })

  it('offers two editions sold as two variants of one product each at its own price (A1 of the D1 audit)', async () => {
    serve(named('KHOUS-EBOOK', 'KHOUS-SIGNED'), [productRow], [variantRow('KHOUS-EBOOK', 3500, 1), variantRow('KHOUS-SIGNED', 9900, 2)])
    const page = await render()
    expect(page).toContain(`<span>${formatMoney(3500)}</span>`)
    expect(page).toContain(`<span>${formatMoney(9900)}</span>`)
    expect(page.split('href="/store/khous"').length - 1).toBe(2)
    expect(page).not.toContain('يُعلن قريباً')
  })

  it('builds with an empty store, with a SKU that names nothing, and with a variant nobody has priced', async () => {
    for (const [room, products, variants] of [
      [named('KHOUS-EBOOK', 'KHOUS-EBOOK'), [], []],
      [named('MISSING', ''), [productRow], [variantRow('KHOUS-EBOOK', 5900)]],
      [named('KHOUS-EBOOK', 'KHOUS-EBOOK'), [productRow], [variantRow('KHOUS-EBOOK', null)]],
      [named('KHOUS-EBOOK', 'KHOUS-EBOOK'), [productRow], []],
    ] as const) {
      serve(room, [...products], [...variants])
      const page = await render()
      expect(page.split('يُعلن قريباً').length - 1).toBe(book.editions.length)
      expect(page).not.toContain('/store/')
    }
  })

  it('titles the tab with the book’s own names, as the page shows them, and not with words fixed in the code', async () => {
    serve(book)
    expect(await generateMetadata()).toEqual({ title: 'كتبتُ هنا: خوص | حكايات شارع 4' })
    serve({ ...book, roomLabel: 'الكتاب', title: 'خوص الجديد', subtitle: 'حكايات أخرى' })
    expect(await generateMetadata()).toEqual({ title: 'الكتاب: خوص الجديد | حكايات أخرى' })
    // No subtitle, no dangling bar; nor for one that is only spaces.
    serve({ ...book, subtitle: '' })
    expect(await generateMetadata()).toEqual({ title: 'كتبتُ هنا: خوص' })
    serve({ ...book, subtitle: '   ' })
    expect(await generateMetadata()).toEqual({ title: 'كتبتُ هنا: خوص' })
  })

  it('hands the shelf’s name on the menu to the way back', async () => {
    serve(book)
    expect(await render()).toContain(content.nav.find((item) => item.href === '/shelf')!.label)
  })
})

describe('the preview reader’s file and page labels (CLIENT-SEC-13)', () => {
  it('are the public part of the preview manifest, which the reader no longer imports whole', () => {
    expect(PREVIEW_URL).toBe(manifest.output.url)
    expect([...PAGE_LABELS]).toEqual(manifest.pages.map((entry) => [entry.page, entry.label]))
  })
})
