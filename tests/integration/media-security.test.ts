// P05: the media library's SQL surface (`supabase/migrations/
// 20260926090000_media_library.sql`) against the real local database. The
// server-only functions are called as `service_role` directly over a local
// connection (the `admin` Edge Function's grants, D32), and everything RLS
// protects goes through real JWTs at the Data API.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createStaff, serviceRoleDb, signIn } from './support'

let app: Client
let postgres: Client

beforeAll(async () => {
  app = await serviceRoleDb()
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  // The cover-only "posts" these tests publish to reference an upload are
  // not real posts; left behind, they fail the journal's build-time check.
  const fixture = "collection = 'posts' and data ? 'cover' and not data ? 'title'"
  await postgres.query(`delete from public.published_documents where ${fixture}`)
  await postgres.query(`delete from public.content_versions where ${fixture}`)
  await app.end()
  await postgres.end()
})

/** A declaration that satisfies both the Zod schema and the `media` checks. */
function declared(): Record<string, unknown> {
  return {
    purpose: 'image',
    name: 'صورة اختبار',
    folder: '',
    altAr: 'وصف عربي',
    caption: '',
    rights: 'حقوق الاختبار',
    original: { mime: 'image/jpeg', bytes: 9000, width: 2000, height: 1500 },
    crop: { x: 0, y: 0, width: 2000, height: 1500 },
    derivatives: [
      { width: 360, height: 270, bytes: 1000 },
      { width: 720, height: 540, bytes: 2000 },
      { width: 1200, height: 900, bytes: 3000 },
      { width: 1800, height: 1350, bytes: 4000 },
    ],
  }
}

async function createTicket(actor: string, payload: Record<string, unknown> = declared()): Promise<string> {
  const result = await app.query<{ t: { id: string } }>('select public.media_create_ticket($1, $2) as t', [
    actor,
    payload,
  ])
  return result.rows[0]!.t.id
}

async function claimTicket(actor: string, ticket: string): Promise<void> {
  await app.query('select public.media_claim($1, $2)', [actor, ticket])
}

async function completeTicket(actor: string, ticket: string): Promise<void> {
  await claimTicket(actor, ticket)
  await app.query('select public.media_complete($1, $2, $3)', [actor, ticket, null])
}

/** Runs `fn`, expecting a PostgreSQL error, and returns its SQLSTATE. */
async function sqlstate(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('upload tickets (server-only functions)', () => {
  it('an active editor may create one; the reply carries id and expiry', async () => {
    const { userId } = await createStaff('editor')
    const result = await app.query<{ t: { id: string; expiresAt: string } }>(
      'select public.media_create_ticket($1, $2) as t',
      [userId, declared()],
    )
    const ticket = result.rows[0]!.t
    expect(ticket.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isNaN(Date.parse(ticket.expiresAt))).toBe(false)
  })

  it('operations and inactive owners get 42501', async () => {
    const operations = await createStaff('operations')
    const inactive = await createStaff('owner', { active: false })
    expect(await sqlstate(() => createTicket(operations.userId))).toBe('42501')
    expect(await sqlstate(() => createTicket(inactive.userId))).toBe('42501')
  })

  it('the 11th open ticket gets 54000', async () => {
    const { userId } = await createStaff('editor')
    for (let i = 0; i < 10; i += 1) {
      await createTicket(userId)
    }
    expect(await sqlstate(() => createTicket(userId))).toBe('54000')
  })
})

describe('media_ticket', () => {
  it("another actor's ticket looks not found (P0002)", async () => {
    const first = await createStaff('editor')
    const second = await createStaff('editor')
    const ticket = await createTicket(first.userId)
    expect(await sqlstate(() => app.query('select public.media_ticket($1, $2)', [second.userId, ticket]))).toBe('P0002')
  })

  it('an expired ticket gets 55000 (expiry forced over the local superuser connection)', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    await postgres.query("update public.media_upload_tickets set expires_at = now() - interval '1 minute' where id = $1", [
      ticket,
    ])
    expect(await sqlstate(() => app.query('select public.media_ticket($1, $2)', [userId, ticket]))).toBe('55000')
  })

  it('a completed ticket gets 55000', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    await completeTicket(userId, ticket)
    expect(await sqlstate(() => app.query('select public.media_ticket($1, $2)', [userId, ticket]))).toBe('55000')
  })

  it('a claimed ticket accepts no more parts, and the claim works once', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    await claimTicket(userId, ticket)
    expect(await sqlstate(() => app.query('select public.media_ticket($1, $2)', [userId, ticket]))).toBe('55000')
    expect(await sqlstate(() => claimTicket(userId, ticket))).toBe('55000')
  })

  // The row lock in media_claim is the exactly-once guarantee. One session holds
  // a claim open; the second must wait for it, then find the ticket used. Without
  // the lock the second would claim it too, and return at once.
  it('two claims of one ticket at the same time: exactly one wins, the other waits and gets 55000', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    const first = await serviceRoleDb()
    const second = await serviceRoleDb()
    try {
      await first.query('begin')
      await first.query('select public.media_claim($1, $2)', [userId, ticket])
      let settled = false
      const loser = second.query('select public.media_claim($1, $2)', [userId, ticket]).then(
        () => {
          settled = true
          return undefined
        },
        (error: { code?: string }) => {
          settled = true
          return error.code
        },
      )
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(settled).toBe(false)
      } finally {
        await first.query('commit')
      }
      expect(await loser).toBe('55000')
    } finally {
      await first.query('rollback').catch(() => undefined)
      await first.end()
      await second.end()
    }
  })

  it("another actor cannot claim a ticket (P0002), and an expired ticket cannot be claimed (55000)", async () => {
    const first = await createStaff('editor')
    const second = await createStaff('editor')
    const ticket = await createTicket(first.userId)
    expect(await sqlstate(() => claimTicket(second.userId, ticket))).toBe('P0002')
    await postgres.query("update public.media_upload_tickets set expires_at = now() - interval '1 minute' where id = $1", [
      ticket,
    ])
    expect(await sqlstate(() => claimTicket(first.userId, ticket))).toBe('55000')
  })
})

describe('media_complete', () => {
  it('refuses an unclaimed ticket (55000)', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    expect(
      await sqlstate(() => app.query('select public.media_complete($1, $2, $3)', [userId, ticket, null])),
    ).toBe('55000')
  })

  it('creates the media row with derived keys and an audit event; the id is the ticket id', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    await claimTicket(userId, ticket)
    const result = await app.query<{ media_complete: string }>('select public.media_complete($1, $2, $3)', [
      userId,
      ticket,
      'd41d8cd98f00b204e9800998ecf8427e',
    ])
    expect(result.rows[0]!.media_complete).toBe(ticket)

    const row = (
      await postgres.query<{ original_key: string; original_mime: string; original_md5: string; derivatives: Array<Record<string, unknown>> }>(
        'select original_key, original_mime, original_md5, derivatives from public.media where id = $1',
        [ticket],
      )
    ).rows[0]!
    expect(row.original_key).toBe(`originals/${ticket}`)
    expect(row.original_mime).toBe('image/jpeg')
    expect(row.original_md5).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(row.derivatives).toEqual([
      { width: 360, height: 270, bytes: 1000, key: `m/${ticket}/360.webp` },
      { width: 720, height: 540, bytes: 2000, key: `m/${ticket}/720.webp` },
      { width: 1200, height: 900, bytes: 3000, key: `m/${ticket}/1200.webp` },
      { width: 1800, height: 1350, bytes: 4000, key: `m/${ticket}/1800.webp` },
    ])

    const events = (
      await postgres.query<{ action: string }>('select action from public.audit_events where entity = $1 and entity_id = $2', [
        'media',
        ticket,
      ])
    ).rows
    expect(events.map((event) => event.action)).toContain('media.create')
  })

  it('a second call gets 55000', async () => {
    const { userId } = await createStaff('editor')
    const ticket = await createTicket(userId)
    await completeTicket(userId, ticket)
    expect(await sqlstate(() => completeTicket(userId, ticket))).toBe('55000')
  })
})

describe('RLS through real JWTs', () => {
  it('anon cannot read unreferenced media, and once a document references it, sees id/derivatives only', async () => {
    const editor = await createStaff('editor')
    const ticket = await createTicket(editor.userId)
    await completeTicket(editor.userId, ticket)

    const anon = anonClient()
    const hidden = await anon.from('media').select('id,derivatives').eq('id', ticket)
    expect(hidden.error).toBeNull()
    expect(hidden.data).toEqual([])

    const docId = randomUUID()
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket, visible: true })],
      )
      await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket, visible: true })],
      )

    const visible = await anon.from('media').select('id,derivatives').eq('id', ticket)
    expect(visible.error).toBeNull()
    expect(visible.data?.[0]?.id).toBe(ticket)

    const secretColumn = await anon.from('media').select('original_key').eq('id', ticket)
    expect(secretColumn.error).not.toBeNull()
  })

  it('anon reads alt_ar of a published image, never its name, folder, rights or caption, and nothing of an unpublished one (AUDIT-2)', async () => {
    const editor = await createStaff('editor')
    const published = await createTicket(editor.userId)
    await completeTicket(editor.userId, published)
    const unpublished = await createTicket(editor.userId)
    await completeTicket(editor.userId, unpublished)
    const docId = randomUUID()
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: published, visible: true })],
    )
    await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: published, visible: true })],
    )

    const anon = anonClient()
    const alt = await anon.from('media').select('id,alt_ar').eq('id', published)
    expect(alt.error).toBeNull()
    expect(alt.data).toEqual([{ id: published, alt_ar: 'وصف عربي' }])
    for (const column of ['name', 'folder', 'rights', 'caption']) {
      const read = await anon.from('media').select(column).eq('id', published)
      expect(read.error, column).not.toBeNull()
    }
    const hidden = await anon.from('media').select('id,alt_ar').eq('id', unpublished)
    expect(hidden.error).toBeNull()
    expect(hidden.data).toEqual([])
  })

  it('an editor may update the descriptive columns but not keys or derivatives', async () => {
    const editor = await createStaff('editor')
    const ticket = await createTicket(editor.userId)
    await completeTicket(editor.userId, ticket)
    const client = await signIn(editor.email)

    const { error: updateError } = await client
      .from('media')
      .update({ name: 'اسم جديد', folder: 'أعمال/تصاميم', alt_ar: 'وصف جديد', caption: 'شرح', rights: 'حقوق جديدة' })
      .eq('id', ticket)
    expect(updateError).toBeNull()

    const row = (
      await postgres.query<{ name: string; folder: string }>('select name, folder from public.media where id = $1', [ticket])
    ).rows[0]!
    expect(row.name).toBe('اسم جديد')
    expect(row.folder).toBe('أعمال/تصاميم')

    const { error: keyError } = await client.from('media').update({ original_key: 'originals/other' }).eq('id', ticket)
    expect(keyError).not.toBeNull()
    const { error: derivativesError } = await client.from('media').update({ derivatives: [] }).eq('id', ticket)
    expect(derivativesError).not.toBeNull()
  })

  it('operations sees nothing', async () => {
    const editor = await createStaff('editor')
    const ticket = await createTicket(editor.userId)
    await completeTicket(editor.userId, ticket)
    const docId = randomUUID()
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket, visible: true })],
    )
    await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket, visible: true })],
    )

    // The image is public (a post without visible: true would not count), so an
    // empty read for operations is the policy's answer, not an unpublished fixture.
    const publicRead = await anonClient().from('media').select('id').eq('id', ticket)
    expect(publicRead.data).toEqual([{ id: ticket }])

    const operations = await createStaff('operations')
    const client = await signIn(operations.email)
    const read = await client.from('media').select('id').eq('id', ticket)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([])
  })

  it('no API role can read or insert tickets, or execute the server-only functions', async () => {
    const editor = await createStaff('editor')
    const client = await signIn(editor.email)

    const read = await client.from('media_upload_tickets').select('id')
    expect(read.error).not.toBeNull()
    const insert = await client.from('media_upload_tickets').insert({ actor: editor.userId, declared: {} })
    expect(insert.error).not.toBeNull()
    const rpc = await client.rpc('media_create_ticket', { p_actor: editor.userId, p_declared: declared() })
    expect(rpc.error).not.toBeNull()
    const claim = await client.rpc('media_claim', { p_actor: editor.userId, p_ticket: crypto.randomUUID() })
    expect(claim.error).not.toBeNull()
  })
})

// FABLE-AUDIT M2-9 (ARCH-12): the public pages print an image's alt text and caption, and they are static files, so an
// edit of either asks for a build, as a publish does.
describe('an edit of what the public pages print asks for a site build', () => {
  const requestedAt = async (): Promise<number> =>
    (await postgres.query<{ requested_at: Date | null }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at?.getTime() ?? 0
  /** Moves the pending request ten minutes back, and answers it: a new request is any later one. */
  const park = async (): Promise<number> => {
    await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
    return requestedAt()
  }

  it('an alt text or caption edit of a published image leaves a build request pending; one of an unpublished image, of its name, folder or rights, or the same text again, asks for none', async () => {
    const editor = await createStaff('editor')
    const published = await createTicket(editor.userId)
    await completeTicket(editor.userId, published)
    const unpublished = await createTicket(editor.userId)
    await completeTicket(editor.userId, unpublished)
    const docId = randomUUID()
    await postgres.query("insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)", [
      docId,
      JSON.stringify({ cover: published, visible: true }),
    ])
    await postgres.query("insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)", [
      docId,
      JSON.stringify({ cover: published, visible: true }),
    ])
    // The library edits a row through the Data API as the signed-in editor.
    const client = await signIn(editor.email)
    const edit = async (id: string, values: Record<string, string>): Promise<void> => {
      const { error } = await client.from('media').update(values).eq('id', id)
      expect(error).toBeNull()
    }

    let parked = await park()
    await edit(published, { name: 'اسم آخر', folder: 'أخرى', rights: 'حقوق أخرى' })
    await edit(unpublished, { alt_ar: 'وصف لصورة لا تُعرض', caption: 'شرح لا يُعرض' })
    expect(await requestedAt()).toBe(parked)

    await edit(published, { alt_ar: 'وصف أدق' })
    expect(await requestedAt()).toBeGreaterThan(parked)
    expect((await postgres.query('select alt_ar from public.media where id = $1', [published])).rows[0]!.alt_ar).toBe('وصف أدق')

    parked = await park()
    await edit(published, { caption: 'شرح جديد' })
    expect(await requestedAt()).toBeGreaterThan(parked)

    parked = await park()
    await edit(published, { alt_ar: 'وصف أدق', caption: 'شرح جديد' })
    expect(await requestedAt()).toBe(parked)
  })
})

describe('usage and delete', () => {
  it('media_where_used reports each document once per state: live, draft, scheduled, and a live document with a newer draft', async () => {
    const editor = await createStaff('editor')
    const ticket = await createTicket(editor.userId)
    await completeTicket(editor.userId, ticket)
    const client = await signIn(editor.email)

    const liveDoc = randomUUID()
    const draftDoc = randomUUID()
    const scheduledDoc = randomUUID()
    const editedDoc = randomUUID()
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [liveDoc, JSON.stringify({ cover: ticket })],
      )
      await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [liveDoc, JSON.stringify({ cover: ticket })],
      )
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [draftDoc, JSON.stringify({ cover: ticket })],
    )
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data, publish_at) values ('posts', $1, 1, $2::jsonb, now() + interval '1 hour')",
      [scheduledDoc, JSON.stringify({ cover: ticket })],
    )

    // Published at seq 1, then edited: the live copy and the newer draft both use it.
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb), ('posts', $1, 2, $2::jsonb)",
      [editedDoc, JSON.stringify({ cover: ticket })],
    )
    await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [editedDoc, JSON.stringify({ cover: ticket })],
    )

    const { data: usage, error: usageError } = await client.rpc('media_where_used', { p_id: ticket })
    expect(usageError).toBeNull()
    const states = (usage as Array<{ doc_id: string; state: string }>).map((row) => `${row.doc_id} ${row.state}`)
    // The exact set: a published document that was not edited since is not also a draft.
    expect(states.sort()).toEqual(
      [
        `${liveDoc} live`,
        `${draftDoc} draft`,
        `${scheduledDoc} scheduled`,
        `${editedDoc} live`,
        `${editedDoc} draft`,
      ].sort(),
    )
  })

  it('media_delete refuses used media (23503) and deletes unused media with its keys', async () => {
    const editor = await createStaff('editor')
    const ticket = await createTicket(editor.userId)
    await completeTicket(editor.userId, ticket)

    const docId = randomUUID()
    await postgres.query(
      "insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket })],
      )
      await postgres.query(
      "insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)",
      [docId, JSON.stringify({ cover: ticket })],
      )
    expect(await sqlstate(() => app.query('select public.media_delete($1, $2)', [editor.userId, ticket]))).toBe('23503')

    await postgres.query('delete from public.published_documents where doc_id = $1', [docId])
    await postgres.query('delete from public.content_versions where doc_id = $1', [docId])
    const result = await app.query<{ d: { originalKey: string; derivativeKeys: string[] } }>(
      'select public.media_delete($1, $2) as d',
      [editor.userId, ticket],
    )
    expect(result.rows[0]!.d).toEqual({
      originalKey: `originals/${ticket}`,
      derivativeKeys: [`m/${ticket}/360.webp`, `m/${ticket}/720.webp`, `m/${ticket}/1200.webp`, `m/${ticket}/1800.webp`],
    })

    const remaining = await postgres.query('select id from public.media where id = $1', [ticket])
    expect(remaining.rows).toEqual([])
    const events = (
      await postgres.query<{ action: string }>('select action from public.audit_events where entity = $1 and entity_id = $2', [
        'media',
        ticket,
      ])
    ).rows
    expect(events.map((event) => event.action)).toContain('media.delete')
  })
})

describe('operations and inactive staff get nothing from the library functions', () => {
  it('media_where_used is refused (42501) for operations and for an inactive editor', async () => {
    for (const member of [await createStaff('operations'), await createStaff('editor', { active: false })]) {
      const client = await signIn(member.email)
      const { error } = await client.rpc('media_where_used', { p_id: randomUUID() })
      expect(error?.code).toBe('42501')
    }
  })

  it('media_rename_folder changes nothing for operations: zero rows, the folder unchanged', async () => {
    const editor = await createStaff('editor')
    const folder = `حماية-${Date.now()}`
    const ticket = await createTicket(editor.userId, { ...declared(), folder })
    await completeTicket(editor.userId, ticket)

    const operations = await createStaff('operations')
    const client = await signIn(operations.email)
    const { data, error } = await client.rpc('media_rename_folder', { p_from: folder, p_to: `${folder}-جديد` })
    expect(error).toBeNull()
    expect(data).toBe(0)
    const row = await postgres.query<{ folder: string }>('select folder from public.media where id = $1', [ticket])
    expect(row.rows[0]!.folder).toBe(folder)
  })
})

describe('folders', () => {
  it('media_rename_folder moves nested folders and rejects the root', async () => {
    const editor = await createStaff('editor')
    const client = await signIn(editor.email)

    // Unique folder names: the local database is shared between runs.
    const root = `أعمال-${Date.now()}`
    const renamed = `مواقع-${Date.now()}`
    const withFolder = (folder: string) => ({ ...declared(), folder })
    const parent = await createTicket(editor.userId, withFolder(root))
    await completeTicket(editor.userId, parent)
    const nested = await createTicket(editor.userId, withFolder(`${root}/داخلية`))
    await completeTicket(editor.userId, nested)

    const { data: moved, error: renameError } = await client.rpc('media_rename_folder', {
      p_from: root,
      p_to: renamed,
    })
    expect(renameError).toBeNull()
    expect(moved).toBe(2)

    const rows = (
      await postgres.query<{ id: string; folder: string }>('select id, folder from public.media where id = any($1)', [
        [parent, nested],
      ])
    ).rows
    const folders = Object.fromEntries(rows.map((row) => [row.id, row.folder]))
    expect(folders[parent]).toBe(renamed)
    expect(folders[nested]).toBe(`${renamed}/داخلية`)

    const { error: rootError } = await client.rpc('media_rename_folder', { p_from: '', p_to: 'anything' })
    expect(rootError?.code).toBe('22023')
  })
})
