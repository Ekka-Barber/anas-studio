import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import fixture from '../../content/initial-content.json'
import { getJournalName, mediaById } from '../../src/lib/content'

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
        return Response.json(asked.at(-1)!.map((id) => ({ id, derivatives: [{ width: 720, height: 480 }] })))
      }),
    )
    const byId = await mediaById(ids)
    expect(asked.map((chunk) => chunk.length)).toEqual([100, 100, 50])
    expect(byId.size).toBe(250)
    expect(byId.get(ids[249]!)).toEqual([{ width: 720, height: 480 }])
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

  it('stays «المجلس» while the menu has no journal item', async () => {
    site(fixture.nav.filter((item) => item.href !== '/journal'))
    expect(await getJournalName()).toBe('المجلس')
  })
})
