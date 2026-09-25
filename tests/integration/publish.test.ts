// P04 part 1: `src/lib/publish.ts` against a real local database. `@/lib/db`
// is mocked to connect as `app_server` directly (no Cloudflare Hyperdrive
// binding exists outside a Worker), and `next/cache` is mocked because
// `revalidateTag` requires a Next.js request context this test has none of.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createStaff, signIn, status } from './support'

const revalidateTagMock = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...args: unknown[]) => revalidateTagMock(...args) }))

vi.mock('../../src/lib/db', () => ({
  withDb: async (query: (client: Client) => Promise<unknown>) => {
    const client = new Client({
      connectionString: 'postgresql://app_server:app_server_local_only@127.0.0.1:54322/postgres',
    })
    await client.connect()
    try {
      return await query(client)
    } finally {
      await client.end()
    }
  },
}))

let counter = 0
function uniqueSlug(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY
})

afterAll(() => {
  vi.restoreAllMocks()
})

async function accessTokenFor(email: string): Promise<string> {
  const client = await signIn(email)
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('accessTokenFor: no session after sign-in')
  return data.session.access_token
}

describe('publishDocument', () => {
  it('an editor publishes a valid draft; both tags are revalidated', async () => {
    const { email } = await createStaff('editor')
    const accessToken = await accessTokenFor(email)
    const { anonClient } = await import('./support')
    const { publishDocument } = await import('../../src/lib/publish')

    const docId = uniqueSlug('tax')
    const editor = await signIn(email)
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'category', label: 'اختبار' } })
    expect(insertError).toBeNull()

    revalidateTagMock.mockClear()
    const result = await publishDocument({ accessToken, collection: 'taxonomies', docId, seq: 1 })
    expect(result).toEqual({ ok: true })
    expect(revalidateTagMock).toHaveBeenCalledWith('content:taxonomies', { expire: 0 })
    expect(revalidateTagMock).toHaveBeenCalledWith(`content:taxonomies:${docId}`, { expire: 0 })

    const { data: live } = await anonClient()
      .from('published_documents')
      .select('data')
      .eq('collection', 'taxonomies')
      .eq('doc_id', docId)
      .single()
    expect(live?.data).toEqual({ kind: 'category', label: 'اختبار' })
  })

  it('rejects an invalid draft; nothing goes live', async () => {
    const { email } = await createStaff('editor')
    const accessToken = await accessTokenFor(email)
    const { anonClient } = await import('./support')
    const { publishDocument } = await import('../../src/lib/publish')

    const docId = uniqueSlug('tax-bad')
    const editor = await signIn(email)
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'not-a-real-kind' } })
    expect(insertError).toBeNull()

    const result = await publishDocument({ accessToken, collection: 'taxonomies', docId, seq: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')

    const { data: live } = await anonClient()
      .from('published_documents')
      .select('data')
      .eq('collection', 'taxonomies')
      .eq('doc_id', docId)
    expect(live).toEqual([])
  })

  // Operations cannot read drafts (RLS), so the fail-closed draft read refuses
  // before the SQL function runs; the SQL-level actor check (42501) is proven
  // in artifacts/acceptance/P04/migration-checks.sql.
  it('an operations member is refused and nothing goes live', async () => {
    const { email: editorEmail } = await createStaff('editor')
    const editor = await signIn(editorEmail)
    const docId = uniqueSlug('tax-ops')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'اختبار' } })
    expect(insertError).toBeNull()

    const { email: opsEmail } = await createStaff('operations')
    const accessToken = await accessTokenFor(opsEmail)
    const { publishDocument } = await import('../../src/lib/publish')

    const result = await publishDocument({ accessToken, collection: 'taxonomies', docId, seq: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    const { anonClient } = await import('./support')
    const { data: live } = await anonClient()
      .from('published_documents')
      .select('doc_id')
      .eq('collection', 'taxonomies')
      .eq('doc_id', docId)
    expect(live).toEqual([])
  })

  it('no valid token gets UNAUTHENTICATED', async () => {
    const { publishDocument } = await import('../../src/lib/publish')
    const result = await publishDocument({
      accessToken: 'not-a-real-token',
      collection: 'taxonomies',
      docId: 'whatever',
      seq: 1,
    })
    expect(result).toEqual({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول.' } })
  })
})

describe('scheduleDocument', () => {
  it('a schedule time in the past is INVALID', async () => {
    const { email } = await createStaff('editor')
    const accessToken = await accessTokenFor(email)
    const editor = await signIn(email)
    const { scheduleDocument } = await import('../../src/lib/publish')

    const docId = uniqueSlug('tax-past')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'اختبار' } })
    expect(insertError).toBeNull()

    const result = await scheduleDocument({
      accessToken,
      collection: 'taxonomies',
      docId,
      seq: 1,
      at: new Date(Date.now() - 60_000).toISOString(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')
  })
})

describe('archiveDocument', () => {
  it('archiving a room is INVALID', async () => {
    const { email } = await createStaff('editor')
    const accessToken = await accessTokenFor(email)
    const { archiveDocument } = await import('../../src/lib/publish')

    const result = await archiveDocument({ accessToken, collection: 'rooms', docId: 'started' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')
  })

  it('archiving a post removes it for anon', async () => {
    const { email } = await createStaff('editor')
    const accessToken = await accessTokenFor(email)
    const editor = await signIn(email)
    const { anonClient } = await import('./support')
    const { publishDocument, archiveDocument } = await import('../../src/lib/publish')

    const docId = randomUUID()
    const postData = {
      slug: uniqueSlug('post'),
      title: 'عنوان',
      excerpt: 'مقتطف',
      body: { root: {} },
      author: 'أنس',
      categories: [],
      tags: [],
      visible: true,
    }
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'posts', doc_id: docId, seq: 1, data: postData })
    expect(insertError).toBeNull()

    const published = await publishDocument({ accessToken, collection: 'posts', docId, seq: 1 })
    expect(published).toEqual({ ok: true })

    const { data: liveBefore } = await anonClient()
      .from('published_documents')
      .select('data')
      .eq('collection', 'posts')
      .eq('doc_id', docId)
    expect(liveBefore).toHaveLength(1)

    const archived = await archiveDocument({ accessToken, collection: 'posts', docId })
    expect(archived).toEqual({ ok: true })

    const { data: liveAfter } = await anonClient()
      .from('published_documents')
      .select('data')
      .eq('collection', 'posts')
      .eq('doc_id', docId)
    expect(liveAfter).toEqual([])
  })
})

describe('content_versions optimistic concurrency', () => {
  it('a stale seq is refused as a 409-mapped conflict', async () => {
    const { email } = await createStaff('editor')
    const editor = await signIn(email)
    const docId = uniqueSlug('tax-stale')

    const first = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'أول' } })
    expect(first.error).toBeNull()

    const stale = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'قديم' } })
    expect(stale.error).not.toBeNull()
    expect(stale.error?.code).toBe('23505')
  })
})
