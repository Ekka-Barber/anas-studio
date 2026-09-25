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

  it('getHomeIntroAddition', async () => {
    const { getHomeIntroAddition } = await import('../../src/lib/content')
    expect(await getHomeIntroAddition()).toBe(content.home.introAddition)
  })

  it('getStartedRoom', async () => {
    const { getStartedRoom } = await import('../../src/lib/content')
    expect(await getStartedRoom()).toEqual(content.rooms.started)
  })

  it('getBuiltRoom', async () => {
    const { getBuiltRoom } = await import('../../src/lib/content')
    expect(await getBuiltRoom()).toEqual(content.rooms.built)
  })

  it('getPassedRoom', async () => {
    const { getPassedRoom } = await import('../../src/lib/content')
    expect(await getPassedRoom()).toEqual(content.rooms.passed)
  })

  it('getShelfRoom', async () => {
    const { getShelfRoom } = await import('../../src/lib/content')
    expect(await getShelfRoom()).toEqual(content.rooms.shelf)
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
