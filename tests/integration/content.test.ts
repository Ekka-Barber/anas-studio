// P04 part 1: the public loaders (`src/lib/content.ts`) against a real local
// database seeded by `pnpm db:import`, and the RLS boundary around drafts.
// Requires `supabase db reset && pnpm db:import` to have run first (see
// docs/development.md) — this spec does not seed the database itself.
import { beforeAll, describe, expect, it } from 'vitest'

import content from '../../content/initial-content.json'
import { anonClient, status } from './support'

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY
})

describe('published-content loaders match the imported fixture', () => {
  it('getNav', async () => {
    const { getNav } = await import('../../src/lib/content')
    expect(await getNav()).toEqual(content.nav)
  })

  it('getFooter', async () => {
    const { getFooter } = await import('../../src/lib/content')
    expect(await getFooter()).toEqual(content.footer)
  })

  it('getHome', async () => {
    const { getHome } = await import('../../src/lib/content')
    expect(await getHome()).toEqual(content.home)
  })

  it('getSocial', async () => {
    const { getSocial } = await import('../../src/lib/content')
    expect(await getSocial()).toEqual(content.social)
  })

  it('getStartedRoom', async () => {
    // The loader drops items hidden in the admin (D39 hides the films still
    // waiting for consent or not in the design), exactly like shapeStartedRoom.
    const { getStartedRoom, shapeStartedRoom } = await import('../../src/lib/content')
    expect(await getStartedRoom()).toEqual(shapeStartedRoom(content.rooms.started as Parameters<typeof shapeStartedRoom>[0]))
  })

  it('getBuiltRoom', async () => {
    // The loader drops items hidden in the admin (D39 hides the films still
    // waiting for consent or not in the design), exactly like shapeBuiltRoom.
    const { getBuiltRoom, shapeBuiltRoom } = await import('../../src/lib/content')
    expect(await getBuiltRoom()).toEqual(shapeBuiltRoom(content.rooms.built as Parameters<typeof shapeBuiltRoom>[0]))
  })

  it('getPassedRoom', async () => {
    // The loader drops items hidden in the admin (D39 hides the films still
    // waiting for consent or not in the design), exactly like shapePassedRoom.
    const { getPassedRoom, shapePassedRoom } = await import('../../src/lib/content')
    expect(await getPassedRoom()).toEqual(shapePassedRoom(content.rooms.passed as Parameters<typeof shapePassedRoom>[0]))
  })

  it('getShelfRoom', async () => {
    const { getShelfRoom } = await import('../../src/lib/content')
    expect(await getShelfRoom()).toEqual(content.rooms.shelf)
  })

  it('getScenes', async () => {
    const { getScenes } = await import('../../src/lib/content')
    expect(await getScenes()).toEqual(content.scenes)
  })
})

describe('drafts and history stay behind RLS', () => {
  it('anon cannot read content_versions', async () => {
    const { data, error } = await anonClient().from('content_versions').select('*')
    expect(error).toBeTruthy()
    expect(data).toBeNull()
  })

  it('anon cannot read content_documents', async () => {
    const { data, error } = await anonClient().from('content_documents').select('*')
    expect(error).toBeTruthy()
    expect(data).toBeNull()
  })
})
