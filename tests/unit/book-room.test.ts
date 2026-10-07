// The book page (كتبتُ هنا) is the fifth document of the rooms collection: its
// schema, its seed, its loader and the characters section of its view.
import { randomUUID } from 'node:crypto'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collections, documentTitle, isRoomSlug, ROOM_DOC_LABELS, schemaFor } from '../../src/admin/collections'
import { bookRoomFields, bookRoomSchema } from '../../src/admin/collections/rooms'
import { BookView } from '../../src/components/public/book/BookView'
import { PAGE_LABELS, PREVIEW_URL } from '../../src/lib/book-preview'
import { getBookRoom, type BookRoom } from '../../src/lib/content'
import { typeset } from '../../src/lib/format'
import { parseMediaRef } from '../../src/lib/media-ref'
import content from '../../content/initial-content.json'
import preview from '../../content/book-preview-text.json'
import manifest from '../../content/book-source-manifest.json'

// BookView imports through the `@/` alias, which the unit config does not resolve:
// each import is redirected to the real file, except the ones that need a browser or the manifest.
vi.mock('@/components/book/BookPreview', () => ({ BookPreview: () => null }))
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
vi.mock('@/lib/format', async () => import('../../src/lib/format'))
vi.mock('@/lib/images', () => ({ imageSources: () => ({ src: '/c.webp', srcSet: '/c.webp 1w', width: 1, height: 1 }) }))

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

describe('the preview reader’s file and page labels (CLIENT-SEC-13)', () => {
  it('are the public part of the preview manifest, which the reader no longer imports whole', () => {
    expect(PREVIEW_URL).toBe(manifest.output.url)
    expect([...PAGE_LABELS]).toEqual(manifest.pages.map((entry) => [entry.page, entry.label]))
  })
})
