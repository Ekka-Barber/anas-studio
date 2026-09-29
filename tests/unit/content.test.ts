import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import fixture from '../../content/initial-content.json'
import type { Scene } from '../../src/lib/content'

// The database is filled from this file by scripts/import-content.mjs, and
// tests/integration/content.test.ts proves the loaders return it unchanged, so
// checking the file against the source covers the public pages.
const { started, built, passed, shelf } = fixture.rooms

/**
 * Anas's texts must be carried verbatim (character for character) from
 * `BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md` into `content/initial-content.json`.
 * That source is git-excluded and only present on a machine with the sorted
 * assets, so this drift check skips cleanly (not a failure) when it is
 * absent — for example in CI.
 */
const CONTENT_MD = path.resolve(__dirname, '../../BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md')

describe('content verbatim against source', () => {
  if (!existsSync(CONTENT_MD)) {
    it.skip('BOOK_ASSETS/SORTED_2026-09-21/CONTENT.md is absent (expected in CI) — skipping drift check', () => {})
    return
  }

  // The source is CRLF markdown blockquote ("> " per line); content.ts joins
  // consecutive quoted lines into one LF-separated paragraph with the quote
  // markers stripped (see the extraction in content/initial-content.json's
  // history) — normalize the same way before comparing.
  const source = readFileSync(CONTENT_MD, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')

  it('بدأتُ من هنا: a full paragraph matches the source', () => {
    expect(source).toContain(started.heroLine)
    expect(source).toContain(started.movements[2]?.paragraphs[3])
  })

  it('بنيتُ هنا: the closing display line matches the source', () => {
    expect(source).toContain(built.closing.displayLine)
    expect(source).toContain(built.intro.paragraphs[0])
  })

  it('مررتُ من هنا: the hero line and closing line match the source', () => {
    expect(source).toContain(passed.heroLine)
    expect(source).toContain(passed.closingLine)
  })

  it('على الرف: the moonlight cup story and thura slogan match the source', () => {
    expect(source).toContain(shelf.items.moonlightCup.paragraphs[0])
    expect(source).toContain(shelf.items.thura.slogan.replace(/^«|»\.?$/g, ''))
  })
})

describe('media references in the published path (P05)', () => {
  const mediaId = randomUUID()
  const unresolvedId = randomUUID()

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  // The file's first import of src/lib/content happens in this test, and takes
  // about 4 s when the whole suite runs in parallel.
  it('replaces a media id with its reference and leaves an unresolved id as it is', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/published_documents')) {
        const nav = fixture.nav.map((item, index) =>
          index === 0 ? { ...item, label: mediaId } : index === 1 ? { ...item, label: unresolvedId } : item,
        )
        return new Response(JSON.stringify([{ data: { nav, footer: fixture.footer, home: fixture.home } }]), {
          status: 200,
        })
      }
      if (url.includes('/media?')) {
        return new Response(
          JSON.stringify([
            { id: mediaId, derivatives: [{ width: 360, height: 240 }, { width: 720, height: 480 }] },
          ]),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getNav } = await import('../../src/lib/content')
    const nav = await getNav()
    // D32: public derivatives live in the `media-public` Storage bucket.
    expect(nav[0]?.label).toBe(
      `media|http://supabase.local/storage/v1/object/public/media-public/m/${mediaId}|720x480|360,720`,
    )
    expect(nav[1]?.label).toBe(unresolvedId)

    // The build reads published media anonymously: the publishable key only,
    // never a staff token.
    const mediaCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/media?'))
    expect(mediaCall?.[1]).toEqual({ headers: { apikey: 'test-key' } })
  }, 15_000)
})

describe('social links at render time (C09)', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  /** Serves one stored settings document, as `published_documents` would. */
  function serveSettings(data: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/published_documents')) return new Response(JSON.stringify([{ data }]), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      }),
    )
  }

  const settings = { nav: fixture.nav, footer: fixture.footer, home: fixture.home }

  it('drops a stored link that is not https and keeps the order of the rest', async () => {
    const [instagram, tiktok] = fixture.social
    const social = [
      instagram,
      { network: 'قديم', handle: 'old', href: 'http://example.com/old' },
      { network: 'خطر', handle: 'x', href: 'javascript:alert(1)' },
      { network: 'نسبي', handle: 'rel', href: '/contact' },
      tiktok,
    ]
    serveSettings({ ...settings, social })
    const { getSocial } = await import('../../src/lib/content')
    expect(await getSocial()).toEqual([instagram, tiktok])
  })

  it('an unset list gives no links', async () => {
    serveSettings(settings)
    const { getSocial } = await import('../../src/lib/content')
    expect(await getSocial()).toEqual([])
  })
})

describe('the scenes at render time (C05)', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  /** Serves `published_documents` rows, as the Data API would. */
  function servePublished(rows: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/published_documents')) return new Response(JSON.stringify(rows), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      }),
    )
  }

  const scenes = fixture.scenes as Scene[]

  it('drops a hidden photo and keeps the order of the rest', async () => {
    const [first, second, third] = scenes
    servePublished([{ data: { items: [first, { ...second, hidden: true }, third] } }])
    const { getScenes } = await import('../../src/lib/content')
    expect(await getScenes()).toEqual([first, third])
  })

  it('an unpublished gallery gives no scenes instead of failing the build', async () => {
    servePublished([])
    const { getScenes } = await import('../../src/lib/content')
    expect(await getScenes()).toEqual([])
  })

  // The database does not check the data (D32): a bad gallery published around
  // the admin fails the build here instead of reaching the page.
  it('a published gallery with a category outside the five, or a blank caption, fails the build', async () => {
    const { getScenes } = await import('../../src/lib/content')
    servePublished([{ data: { items: [{ ...scenes[0], category: 'سفر' }] } }])
    await expect(getScenes()).rejects.toThrow(/"category"/)
    servePublished([{ data: { items: [{ ...scenes[0], caption: '  ' }] } }])
    await expect(getScenes()).rejects.toThrow(/"caption"/)
  })

  it('the page shows the 19 photos in order, with a filter only for the four categories they use', async () => {
    const { sceneGallery } = await import('../../src/lib/scenes')
    const { items, categories } = sceneGallery(scenes)
    expect(items.map((item) => [item.category, item.caption])).toEqual(scenes.map((scene) => [scene.category, scene.caption]))
    expect(items[0]?.sources.src).toBe('/images/v2/street4-street-sign-1000.webp')
    expect(categories).toEqual(['أماكن', 'مشاريع', 'منتجات', 'خلف الكواليس'])
  })

  it('leaves out a photo whose files cannot be found, and a category left with no photo', async () => {
    const { sceneGallery } = await import('../../src/lib/scenes')
    const unresolved = { image: randomUUID(), category: 'رحلات', caption: 'بلا ملفات' } satisfies Scene
    const resolved = {
      image: 'media|http://supabase.local/m/abc|720x480|360,720',
      category: 'مشاريع',
      caption: 'من المكتبة',
    } satisfies Scene
    const { items, categories } = sceneGallery([unresolved, scenes[0]!, resolved])
    expect(items.map((item) => item.caption)).toEqual([scenes[0]!.caption, 'من المكتبة'])
    expect(items[1]?.sources).toEqual({
      src: 'http://supabase.local/m/abc/720.webp',
      srcSet: 'http://supabase.local/m/abc/360.webp 360w, http://supabase.local/m/abc/720.webp 720w',
      width: 720,
      height: 480,
    })
    expect(categories).toEqual(['أماكن', 'مشاريع'])
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length)
    expect(sceneGallery([])).toEqual({ items: [], categories: [] })
  })
})
