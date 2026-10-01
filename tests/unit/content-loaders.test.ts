import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import fixture from '../../content/initial-content.json'
import { noteFor } from '../../src/content/media-notes'
import { getJournalName, mediaById, replaceMediaIds } from '../../src/lib/content'
import { parseMediaRef } from '../../src/lib/media-ref'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** The ids a `/rest/v1/media?id=in.(…)` request asks for. */
const askedIds = (url: string) => new URL(url).searchParams.get('id')!.slice('in.('.length, -1).split(',')

describe('mediaById', () => {
  it('reads the ids in chunks, so the URL never outgrows what Cloudflare accepts, and merges the rows', async () => {
    const ids = Array.from({ length: 250 }, () => randomUUID())
    const asked: string[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(askedIds(url))
        return Response.json(asked.at(-1)!.map((id) => ({ id, derivatives: [{ width: 720, height: 480 }], alt_ar: 'وصف' })))
      }),
    )
    const byId = await mediaById(ids)
    expect(asked.map((chunk) => chunk.length)).toEqual([100, 100, 50])
    expect(byId.size).toBe(250)
    expect(byId.get(ids[249]!)).toEqual({ derivatives: [{ width: 720, height: 480 }], alt: 'وصف' })
  })

  it('asks for the alt text with the derivatives, so a library picture reaches the page described (WCAG 1.1.1)', async () => {
    const id = randomUUID()
    const fetchSpy = vi.fn(async () => Response.json([{ id, derivatives: [{ width: 1200, height: 800 }], alt_ar: 'فرع رحى في تبوك' }]))
    vi.stubGlobal('fetch', fetchSpy)
    const byId = await mediaById([id])
    expect(new URL((fetchSpy.mock.calls[0] as unknown as [string])[0]).searchParams.get('select')).toBe('id,derivatives,alt_ar')
    const ref = replaceMediaIds({ vignette: id }, byId, '/media').vignette
    expect(parseMediaRef(ref)?.alt).toBe('فرع رحى في تبوك')
    // A picture with no entry in MEDIA_NOTES takes the alt its reference carries; one with an entry keeps the note.
    expect(noteFor(ref).alt).toBe('فرع رحى في تبوك')
    expect(noteFor('raha-poster-orange').alt).toContain('ملصق دعوة')
    expect(noteFor(id).alt).toBe('')
    // The admin preview still passes bare derivative lists: no alt, no failure.
    expect(parseMediaRef(replaceMediaIds(id, new Map([[id, [{ width: 720, height: 480 }]]]), '/media'))?.alt).toBeUndefined()
  })

  it('makes no request for no ids', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await mediaById([])).size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('getJournalName', () => {
  const site = (nav: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([{ data: { nav, footer: fixture.footer, home: fixture.home, social: fixture.social } }])),
    )
  }

  it('is the label of the /journal menu item, so renaming it there renames the journal', async () => {
    site(fixture.nav.map((item) => (item.href === '/journal' ? { ...item, label: 'المدونة' } : item)))
    expect(await getJournalName()).toBe('المدونة')
  })

  it('stays «المجلس» while its menu label is blank, so the heading and links never go nameless', async () => {
    site(fixture.nav.map((item) => (item.href === '/journal' ? { ...item, label: '  ' } : item)))
    expect(await getJournalName()).toBe('المجلس')
  })

  it('stays «المجلس» while the menu has no journal item', async () => {
    site(fixture.nav.filter((item) => item.href !== '/journal'))
    expect(await getJournalName()).toBe('المجلس')
  })
})
