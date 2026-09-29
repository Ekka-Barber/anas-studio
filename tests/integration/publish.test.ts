// P04 part 1, D32: publishing from the admin (`src/lib/admin-publish.ts`)
// against a real local database. The admin's browser client is replaced by a
// client signed in as the staff member under test, so every call is the one
// the admin makes: the draft read and the publishing functions both run as
// that person's JWT, with RLS and the functions' own role check deciding.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { archiveDocument, publishDocument, scheduleDocument } from '../../src/lib/admin-publish'

import { anonClient, createStaff, signIn } from './support'

let current: SupabaseClient | undefined
vi.mock('../../src/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: () => {
    if (!current) throw new Error('publish.test: no signed-in client')
    return current
  },
}))

let postgres: Client

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  await postgres.end()
})

let counter = 0
function uniqueSlug(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}

async function as(role: 'owner' | 'editor' | 'operations'): Promise<SupabaseClient> {
  const { email } = await createStaff(role)
  current = await signIn(email)
  return current
}

async function liveData(collection: string, docId: string): Promise<unknown[]> {
  const { data } = await anonClient()
    .from('published_documents')
    .select('data')
    .eq('collection', collection)
    .eq('doc_id', docId)
  return (data ?? []).map((row: { data: unknown }) => row.data)
}

async function buildRequestedAt(): Promise<Date | null> {
  const result = await postgres.query<{ requested_at: Date | null }>(
    'select requested_at from finance.site_builds where id = 1',
  )
  return result.rows[0]?.requested_at ?? null
}

describe('publishDocument', () => {
  it('an editor publishes a valid draft; it goes live and a site rebuild is requested', async () => {
    const editor = await as('editor')
    const docId = uniqueSlug('tax')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'category', label: 'اختبار' } })
    expect(insertError).toBeNull()

    const before = new Date()
    expect(await publishDocument('taxonomies', docId, 1)).toEqual({ ok: true })
    expect(await liveData('taxonomies', docId)).toEqual([{ kind: 'category', label: 'اختبار' }])
    const requested = await buildRequestedAt()
    expect(requested).not.toBeNull()
    // Database clock vs test clock: allow a little skew.
    expect(requested!.getTime()).toBeGreaterThan(before.getTime() - 5_000)
  })

  it('rejects an invalid draft; nothing goes live', async () => {
    const editor = await as('editor')
    const docId = uniqueSlug('tax-bad')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'not-a-real-kind' } })
    expect(insertError).toBeNull()

    const result = await publishDocument('taxonomies', docId, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')
    expect(await liveData('taxonomies', docId)).toEqual([])
  })

  // Operations cannot read drafts (RLS), so the admin's draft read refuses
  // first; calling the function directly is refused by its own role check.
  it('an operations member is refused, by the admin and by the database', async () => {
    const editor = await as('editor')
    const docId = uniqueSlug('tax-ops')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'اختبار' } })
    expect(insertError).toBeNull()

    const operations = await as('operations')
    const result = await publishDocument('taxonomies', docId, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')

    const direct = await operations.rpc('publish_version', { p_collection: 'taxonomies', p_doc_id: docId, p_seq: 1 })
    expect(direct.error?.code).toBe('42501')
    expect(await liveData('taxonomies', docId)).toEqual([])
  })

  it('anon cannot call the publishing functions at all', async () => {
    const anon = anonClient()
    const publish = await anon.rpc('publish_version', { p_collection: 'taxonomies', p_doc_id: 'whatever', p_seq: 1 })
    expect(publish.error).not.toBeNull()
    const archive = await anon.rpc('archive_document', { p_collection: 'posts', p_doc_id: randomUUID() })
    expect(archive.error).not.toBeNull()
  })
})

describe('scheduleDocument', () => {
  it('a schedule time in the past is INVALID', async () => {
    const editor = await as('editor')
    const docId = uniqueSlug('tax-past')
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'taxonomies', doc_id: docId, seq: 1, data: { kind: 'tag', label: 'اختبار' } })
    expect(insertError).toBeNull()

    const result = await scheduleDocument('taxonomies', docId, 1, new Date(Date.now() - 60_000).toISOString())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')
  })
})

describe('archiveDocument', () => {
  it('archiving a room is INVALID', async () => {
    await as('editor')
    const result = await archiveDocument('rooms', 'started')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID')
  })

  it('archiving a post removes it for anon and requests a rebuild', async () => {
    const editor = await as('editor')
    const docId = randomUUID()
    const postData = {
      slug: uniqueSlug('post'),
      title: 'عنوان',
      excerpt: 'مقتطف',
      body: { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'نص', format: 0 }] }] } },
      author: 'أنس',
      categories: [],
      tags: [],
      visible: true,
    }
    const { error: insertError } = await editor
      .from('content_versions')
      .insert({ collection: 'posts', doc_id: docId, seq: 1, data: postData })
    expect(insertError).toBeNull()

    expect(await publishDocument('posts', docId, 1)).toEqual({ ok: true })
    expect(await liveData('posts', docId)).toHaveLength(1)

    await postgres.query('update finance.site_builds set requested_at = null where id = 1')
    expect(await archiveDocument('posts', docId)).toEqual({ ok: true })
    expect(await liveData('posts', docId)).toEqual([])
    expect(await buildRequestedAt()).not.toBeNull()
  })
})

describe('the scenes collection (C05)', () => {
  // A throwaway document of the collection, so the live gallery the public
  // loader reads is never touched; removed afterwards as the superuser.
  it('is a collection the store knows; the admin publish refuses a category outside Anas’s five and publishes a valid gallery', async () => {
    const editor = await as('editor')
    const docId = uniqueSlug('scenes')
    const photo = { image: 'street4-street-sign', category: 'رحلات', caption: 'اختبار' }
    try {
      const bad = await editor
        .from('content_versions')
        .insert({ collection: 'scenes', doc_id: docId, seq: 1, data: { items: [{ ...photo, category: 'سفر' }] } })
      expect(bad.error).toBeNull()
      const refused = await publishDocument('scenes', docId, 1)
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.error.code).toBe('INVALID')
      expect(await liveData('scenes', docId)).toEqual([])

      const good = await editor
        .from('content_versions')
        .insert({ collection: 'scenes', doc_id: docId, seq: 2, data: { items: [photo] } })
      expect(good.error).toBeNull()
      expect(await publishDocument('scenes', docId, 2)).toEqual({ ok: true })
      expect(await liveData('scenes', docId)).toEqual([{ items: [photo] }])

      // Like the rooms, the gallery stays live: it cannot be archived.
      const archived = await archiveDocument('scenes', docId)
      expect(archived.ok).toBe(false)
      if (!archived.ok) expect(archived.error.code).toBe('INVALID')
    } finally {
      await postgres.query('delete from public.published_documents where collection = $1 and doc_id = $2', ['scenes', docId])
      await postgres.query('delete from public.content_versions where collection = $1 and doc_id = $2', ['scenes', docId])
    }
  })
})

describe('content_versions optimistic concurrency', () => {
  it('a stale seq is refused as a 409-mapped conflict', async () => {
    const editor = await as('editor')
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
