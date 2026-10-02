// AUDIT-1, round DB: the database fixes in
// `supabase/migrations/20260930120000_audit_fixes.sql`. Everything that
// writes runs inside a transaction that is rolled back, as the local
// `postgres` superuser, switching to `anon` or `authenticated` (with a JWT
// claim) where the row-level rules are the point. The outbox fixes are in
// outbox.test.ts, the stale-tab and slug publishing fixes in publish.test.ts.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaff, serviceClient, signIn, status } from './support'

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

/** Runs `body` in a transaction that is always rolled back. */
async function rolledBack(body: () => Promise<void>): Promise<void> {
  await postgres.query('begin')
  try {
    await body()
  } finally {
    await postgres.query('rollback')
  }
}

/** Runs `fn` expecting a PostgreSQL error inside an open transaction; returns its SQLSTATE. */
async function sqlstate(fn: () => Promise<unknown>): Promise<string | undefined> {
  await postgres.query('savepoint probe')
  try {
    await fn()
    await postgres.query('release savepoint probe')
    return undefined
  } catch (error) {
    await postgres.query('rollback to savepoint probe')
    return (error as { code?: string }).code
  }
}

let counter = 0
function unique(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}

/** Publishes `data` as the next version of a document, as the superuser (like the seed does). */
async function publishAs(collection: string, docId: string, data: unknown): Promise<number> {
  const seq = (
    await postgres.query<{ seq: number }>(
      'select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = $1 and doc_id = $2',
      [collection, docId],
    )
  ).rows[0]!.seq
  await postgres.query('insert into public.content_versions (collection, doc_id, seq, data) values ($1, $2, $3, $4::jsonb)', [
    collection,
    docId,
    seq,
    JSON.stringify(data),
  ])
  await postgres.query('select public.content_go_live($1, $2, $3)', [collection, docId, seq])
  return seq
}

async function insertMedia(): Promise<string> {
  const id = randomUUID()
  await postgres.query(
    `insert into public.media (id, purpose, name, alt_ar, rights, original_key, original_mime, original_bytes,
       original_width, original_height, crop, derivatives)
     values ($1, 'image', 'اختبار', 'اختبار', 'ملكية الاختبار', $2, 'image/jpeg', 1000, 10, 10, '{}'::jsonb,
       '[{"key": "k", "width": 10}]'::jsonb)`,
    [id, `audit-fixes/${id}`],
  )
  return id
}

describe('S01.4: no password sign-in', () => {
  it('a password grant is refused with 403 even for a staff member who has a password; the emailed code and a refresh still work', async () => {
    const staff = await createStaff('editor')
    const password = `pw-${randomUUID()}`
    const set = await serviceClient.auth.admin.updateUserById(staff.userId, { password })
    expect(set.error).toBeNull()

    const response = await fetch(`${status.API_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: status.PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: staff.email, password }),
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { access_token?: string }).access_token).toBeUndefined()

    const client = await signIn(staff.email)
    expect((await client.auth.getSession()).data.session).not.toBeNull()
    expect((await client.auth.refreshSession()).error).toBeNull()
  })
})

describe('S01.5: functions are deny-by-default', () => {
  it('no public or finance function is executable by PUBLIC, and anon runs only the catalog\'s availability and the two public media reads', async () => {
    const rows = (
      await postgres.query<{ fn: string; pub: boolean; anon: boolean }>(
        `select n.nspname || '.' || p.proname as fn,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'finance') and p.prokind = 'f'
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
      )
    ).rows
    expect(rows.length).toBeGreaterThan(30)
    expect(rows.filter((row) => row.pub)).toEqual([])
    expect(rows.filter((row) => row.anon).map((row) => row.fn).sort()).toEqual([
      'public.catalog_availability',
      'public.media_is_published',
      'public.media_published_ids',
    ])
  })

  it('a function created later is not executable by anon or authenticated, in public or finance', async () => {
    await rolledBack(async () => {
      await postgres.query('create function public.zz_probe() returns integer language sql as $$ select 1 $$')
      await postgres.query('create function finance.zz_probe() returns integer language sql as $$ select 1 $$')
      for (const fn of ['public.zz_probe()', 'finance.zz_probe()']) {
        for (const role of ['anon', 'authenticated']) {
          const r = await postgres.query<{ ok: boolean }>('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute'])
          expect(r.rows[0]!.ok).toBe(false)
        }
      }
    })
  })
})

describe('S01.1: hidden posts are not public', () => {
  it('anon and a signed-in non-staff user read only visible posts; an active staff member reads every row', async () => {
    const staff = await createStaff('editor')
    await rolledBack(async () => {
      const shown = randomUUID()
      const hidden = randomUUID()
      const taxonomy = unique('tax')
      await publishAs('posts', shown, { slug: unique('shown'), visible: true })
      await publishAs('posts', hidden, { slug: unique('hidden'), visible: false })
      await publishAs('taxonomies', taxonomy, { kind: 'tag', label: 'اختبار' })
      const read = async (): Promise<string[]> =>
        (
          await postgres.query<{ doc_id: string }>(
            'select doc_id from public.published_documents where doc_id = any($1) order by doc_id',
            [[shown, hidden, taxonomy]],
          )
        ).rows.map((row) => row.doc_id)

      await postgres.query('set local role anon')
      expect(await read()).toEqual([shown, taxonomy].sort())

      await postgres.query('reset role')
      await postgres.query('set local role authenticated')
      await postgres.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: randomUUID(), role: 'authenticated' }),
      ])
      expect(await read()).toEqual([shown, taxonomy].sort())

      await postgres.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: staff.userId, role: 'authenticated' }),
      ])
      expect(await read()).toEqual([shown, hidden, taxonomy].sort())
      await postgres.query('reset role')
    })
  })
})

describe('S02.4: the public media read is one set, not a scan per row', () => {
  it('anon sees exactly the images a public document or a published product uses, matching media_is_published; a hidden post’s cover stays private', async () => {
    await rolledBack(async () => {
      const inRoom = await insertMedia()
      const inHiddenPost = await insertMedia()
      const inShownPost = await insertMedia()
      const unused = await insertMedia()
      const productCover = await insertMedia()
      const draftProductCover = await insertMedia()
      await publishAs('taxonomies', unique('tax'), { kind: 'tag', label: 'اختبار', nested: { list: [{ image: inRoom }] } })
      // An uppercase id is not the canonical text the old predicate matched.
      await publishAs('taxonomies', unique('tax'), { kind: 'tag', label: 'اختبار', image: unused.toUpperCase() })
      await publishAs('posts', randomUUID(), { slug: unique('hidden'), visible: false, cover: inHiddenPost })
      await publishAs('posts', randomUUID(), { slug: unique('shown'), visible: true, cover: inShownPost })
      await postgres.query(
        `insert into public.products (slug, title, summary, status, cover_image) values ($1, 'منتج', 'ملخص', 'published', $2)`,
        [unique('p').toLowerCase(), productCover],
      )
      await postgres.query(
        `insert into public.products (slug, title, summary, status, cover_image) values ($1, 'مسودة', 'ملخص', 'draft', $2)`,
        [unique('d').toLowerCase(), draftProductCover],
      )
      const all = [inRoom, inHiddenPost, inShownPost, unused, productCover, draftProductCover]
      const expected = [inRoom, inShownPost, productCover].sort()

      const viaFunction = await postgres.query<{ id: string }>(
        'select id from public.media where id = any($1) and public.media_is_published(id) order by id',
        [all],
      )
      expect(viaFunction.rows.map((row) => row.id)).toEqual(expected)

      await postgres.query('set local role anon')
      const viaPolicy = await postgres.query<{ id: string }>('select id from public.media where id = any($1) order by id', [all])
      await postgres.query('reset role')
      expect(viaPolicy.rows.map((row) => row.id)).toEqual(expected)
    })
  })
})

describe('X1.1: changing an approved policy closes checkout until it is approved again', () => {
  // Revisions no publish here reaches: an approved value equal to the new seq
  // would (rightly) not reset, so a low number would make these tests depend on
  // which policies the database already holds (the demo catalog seeds some).
  const APPROVED = { store: 999, delivery: 999, refund: 999 }

  async function settings(): Promise<{ policy_revisions: Record<string, number>; version: number }> {
    return (
      await postgres.query<{ policy_revisions: Record<string, number>; version: number }>(
        'select policy_revisions, version from finance.commerce_settings where id = 1',
      )
    ).rows[0]!
  }

  async function resets(): Promise<number> {
    return (await postgres.query("select count(*)::int as n from public.audit_events where action = 'commerce.policies_reset'")).rows[0]!.n
  }

  async function approve(revisions: Record<string, number>): Promise<number> {
    await postgres.query('update finance.commerce_settings set policy_revisions = $1::jsonb where id = 1', [JSON.stringify(revisions)])
    return (await settings()).version
  }

  it('a new seq of an approved policy resets the approval, bumps the version and is audited', async () => {
    await rolledBack(async () => {
      const version = await approve(APPROVED)
      const before = await resets()
      const seq = await publishAs('policies', 'store', { title: 'سياسة المتجر', body: { root: { type: 'root', children: [] } } })
      const after = await settings()
      expect(after.policy_revisions).toEqual({})
      expect(after.version).toBe(version + 1)
      expect(await resets()).toBe(before + 1)
      const audit = await postgres.query<{ summary: unknown }>(
        "select summary from public.audit_events where action = 'commerce.policies_reset' order by id desc limit 1",
      )
      expect(audit.rows[0]!.summary).toEqual({ policy: 'store', seq })
    })
  })

  it('republishing the approved seq, or publishing a policy that is not in the approval, changes nothing', async () => {
    await rolledBack(async () => {
      const store = await publishAs('policies', 'store', { title: 'سياسة المتجر', body: { root: { type: 'root', children: [] } } })
      const version = await approve({ ...APPROVED, store })
      const before = await resets()
      await postgres.query('select public.content_go_live($1, $2, $3)', ['policies', 'store', store])
      await publishAs('policies', 'privacy', { title: 'الخصوصية', body: { root: { type: 'root', children: [] } } })
      const after = await settings()
      expect(after.policy_revisions).toEqual({ ...APPROVED, store })
      expect(after.version).toBe(version)
      expect(await resets()).toBe(before)
    })
  })

  it('scheduled publishing (publish_due) and removal of an approved policy reset it too', async () => {
    await rolledBack(async () => {
      const body = { title: 'سياسة', body: { root: { type: 'root', children: [] } } }
      const store = await publishAs('policies', 'store', body)
      const refund = await publishAs('policies', 'refund', body)
      await approve({ store, delivery: 1, refund })
      await postgres.query(
        "insert into public.content_versions (collection, doc_id, seq, data) values ('policies', 'store', $1, $2::jsonb)",
        [store + 1, JSON.stringify(body)],
      )
      await postgres.query(
        "update public.content_versions set publish_at = now() - interval '1 minute' where collection = 'policies' and doc_id = 'store' and seq = $1",
        [store + 1],
      )
      await postgres.query('select public.publish_due()')
      expect((await settings()).policy_revisions).toEqual({})

      await approve({ store: store + 1, delivery: 1, refund })
      await postgres.query("delete from public.published_documents where collection = 'policies' and doc_id = 'refund'")
      expect((await settings()).policy_revisions).toEqual({})
    })
  })
})

describe('S01.2: one failing scheduled document does not stop the others', () => {
  it('a scheduled post whose slug is taken drops its schedule and is audited; the other due document still goes live', async () => {
    await rolledBack(async () => {
      const slug = unique('taken')
      await publishAs('posts', randomUUID(), { slug, visible: true })
      const clash = randomUUID()
      await postgres.query(`insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)`, [
        clash,
        JSON.stringify({ slug, visible: true }),
      ])
      const other = unique('tax')
      await postgres.query(
        `insert into public.content_versions (collection, doc_id, seq, data) values ('taxonomies', $1, 1, '{"kind": "tag", "label": "اختبار"}'::jsonb)`,
        [other],
      )
      await postgres.query(
        `update public.content_versions set publish_at = now() - interval '1 minute' where doc_id = any($1)`,
        [[clash, other]],
      )

      const published = (await postgres.query<{ n: number }>('select public.publish_due() as n')).rows[0]!.n
      expect(published).toBeGreaterThanOrEqual(1)
      const live = await postgres.query('select 1 from public.published_documents where doc_id = $1', [other])
      expect(live.rowCount).toBe(1)
      const notLive = await postgres.query('select 1 from public.published_documents where doc_id = $1', [clash])
      expect(notLive.rowCount).toBe(0)
      const version = await postgres.query<{ publish_at: Date | null }>('select publish_at from public.content_versions where doc_id = $1', [clash])
      expect(version.rows[0]!.publish_at).toBeNull()
      const audit = await postgres.query<{ summary: unknown }>(
        "select summary from public.audit_events where action = 'content.publish_due_failed' and entity_id = $1",
        [clash],
      )
      expect(audit.rows.map((row) => row.summary)).toEqual([{ seq: 1, sqlstate: '23505' }])
    })
  })
})

describe('S17.1: the job-runs purge keeps each job’s newest run', () => {
  it('runs the scheduled command: old runs go, the newest run of a job stays however old it is', async () => {
    await rolledBack(async () => {
      const command = (await postgres.query<{ command: string }>("select command from cron.job where jobname = 'job-runs-purge'")).rows[0]!
        .command
      const job = unique('zz-audit-job')
      await postgres.query(
        `insert into finance.job_runs (job, status, started_at, finished_at)
         values ($1, 'ok', now() - interval '41 days', now() - interval '40 days'),
                ($1, 'ok', now() - interval '36 days', now() - interval '35 days')`,
        [job],
      )
      const quiet = unique('zz-audit-recent')
      await postgres.query(
        `insert into finance.job_runs (job, status, started_at, finished_at)
         values ($1, 'ok', now() - interval '3 days', now() - interval '2 days'),
                ($1, 'ok', now() - interval '2 days', now() - interval '1 day')`,
        [quiet],
      )
      await postgres.query(command)
      const left = await postgres.query<{ job: string; age: number }>(
        `select job, round(extract(epoch from now() - finished_at) / 86400)::int as age
           from finance.job_runs where job = any($1) order by job, finished_at desc`,
        [[job, quiet]],
      )
      expect(left.rows.filter((row) => row.job === job).map((row) => row.age)).toEqual([35])
      expect(left.rows.filter((row) => row.job === quiet).map((row) => row.age)).toEqual([1, 2])
    })
  })
})

describe('S05.4: a coupon’s scope is audited with its old and new values', () => {
  it('changing product_ids, kind or code records from and to', async () => {
    await rolledBack(async () => {
      const first = randomUUID()
      const coupon = (
        await postgres.query<{ id: string }>(
          `insert into public.coupons (code, kind, percent_bp, product_ids, enabled)
           values ('ZZAUDIT1', 'percent', 1000, '{}', true) returning id`,
        )
      ).rows[0]!.id
      await postgres.query(
        `update public.coupons set product_ids = $2, code = 'ZZAUDIT2' where id = $1`,
        [coupon, [first]],
      )
      const audit = await postgres.query<{ summary: { changes: Record<string, { from: unknown; to: unknown }> } }>(
        "select summary from public.audit_events where action = 'coupons.update' and entity_id = $1",
        [coupon],
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]!.summary.changes.product_ids).toEqual({ from: [], to: [first] })
      expect(audit.rows[0]!.summary.changes.code).toEqual({ from: 'ZZAUDIT1', to: 'ZZAUDIT2' })
    })
  })
})

describe('X2.6: a product cannot be saved with a library cover that is gone', () => {
  it('refuses a missing library cover on insert and on update (23503), accepts an existing one, a manifest id, and an unchanged cover', async () => {
    await rolledBack(async () => {
      const media = await insertMedia()
      const slug = unique('cover').toLowerCase()
      const insert = (cover: string | null) =>
        postgres.query(
          `insert into public.products (slug, title, summary, status, cover_image) values ($1, 'منتج', 'ملخص', 'draft', $2) returning id`,
          [`${slug}-${unique('x').toLowerCase()}`, cover],
        )
      expect(await sqlstate(() => insert(randomUUID()))).toBe('23503')
      expect(await sqlstate(() => insert(media))).toBeUndefined()
      expect(await sqlstate(() => insert('street4-street-sign'))).toBeUndefined()
      expect(await sqlstate(() => insert(null))).toBeUndefined()

      const id = (await insert(media)).rows[0]!.id as string
      expect(await sqlstate(() => postgres.query('update public.products set cover_image = $2 where id = $1', [id, randomUUID()]))).toBe('23503')
      // The cover was deleted meanwhile: saving another field of the product still works.
      await postgres.query('delete from public.media where id = $1', [media])
      expect(await sqlstate(() => postgres.query("update public.products set title = 'عنوان جديد', cover_image = $2 where id = $1", [id, media]))).toBeUndefined()
    })
  })
})

// AUDIT-2, round R01-DB: `supabase/migrations/20260930140000_audit2_fixes.sql`.
// The lock tests hold the document's advisory lock on a second connection, the
// way a publish in another session does, so they are deterministic: a writer
// that ignores the lock finishes at once and fails the assertion. Their
// fixtures are committed first (and removed in `finally`): inserting a version
// takes the same lock for its own transaction, so a fixture written in the
// transaction under test would hold the lock itself.
const CONNECTION = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Runs `fn` as the signed-in staff member `userId` (inside an open transaction). */
async function asStaff<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await postgres.query('set local role authenticated')
  await postgres.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  try {
    return await fn()
  } finally {
    await postgres.query('reset role')
  }
}

/** A second session that holds `doc`'s publishing lock until it rolls back. */
async function holdDocumentLock(collection: string, doc: string): Promise<Client> {
  const holder = new Client({ connectionString: CONNECTION })
  await holder.connect()
  await holder.query('begin')
  await holder.query(`select pg_advisory_xact_lock(hashtext('content:' || $1::text || ':' || $2::text))`, [collection, doc])
  return holder
}

async function removeDocument(doc: string): Promise<void> {
  await postgres.query('delete from public.published_documents where doc_id = $1', [doc])
  await postgres.query('delete from public.content_versions where doc_id = $1', [doc])
}

describe('GAP-G5-1: publishing takes the document lock before any row lock', () => {
  it('publish_due leaves a document whose lock another session holds for the next run, then publishes it', async () => {
    const doc = unique('due-locked')
    await postgres.query(
      `insert into public.content_versions (collection, doc_id, seq, data) values ('taxonomies', $1, 1, '{"kind": "tag", "label": "اختبار"}'::jsonb)`,
      [doc],
    )
    const holder = await holdDocumentLock('taxonomies', doc)
    try {
      // An update does not take the lock (only the insert trigger does).
      await postgres.query("update public.content_versions set publish_at = now() - interval '1 minute' where doc_id = $1", [doc])
      const live = () => postgres.query('select 1 from public.published_documents where doc_id = $1', [doc])
      const scheduled = () => postgres.query('select 1 from public.content_versions where doc_id = $1 and publish_at is not null', [doc])

      await postgres.query('select public.publish_due()')
      expect((await live()).rowCount).toBe(0)
      expect((await scheduled()).rowCount).toBe(1)

      await holder.query('rollback')
      // Rolled back, so the rebuild request a publish makes leaves no trace.
      await rolledBack(async () => {
        await postgres.query('select public.publish_due()')
        expect((await live()).rowCount).toBe(1)
        expect((await scheduled()).rowCount).toBe(0)
      })
    } finally {
      await holder.query('rollback').catch(() => undefined)
      await holder.end()
      await removeDocument(doc)
    }
  })

  it('archive_document waits for the document lock instead of racing a publish', async () => {
    const staff = await createStaff('editor')
    const doc = unique('archive-locked')
    await publishAs('taxonomies', doc, { kind: 'tag', label: 'اختبار' })
    const holder = await holdDocumentLock('taxonomies', doc)
    try {
      await rolledBack(async () => {
        await postgres.query('set local role authenticated')
        await postgres.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: staff.userId, role: 'authenticated' }),
        ])
        let settled = false
        const archiving = postgres.query(`select public.archive_document('taxonomies', $1)`, [doc]).then(() => {
          settled = true
        })
        try {
          await new Promise((resolve) => setTimeout(resolve, 500))
          expect(settled).toBe(false)
        } finally {
          // Release the lock even when the assertion fails, or the rollback queued behind it would hang.
          await holder.query('rollback')
        }
        await archiving
        expect(settled).toBe(true)
        await postgres.query('reset role')
        expect((await postgres.query('select 1 from public.published_documents where doc_id = $1', [doc])).rowCount).toBe(0)
      })
    } finally {
      await holder.query('rollback').catch(() => undefined)
      await holder.end()
      await removeDocument(doc)
    }
  })
})

describe('DB-core-3: the first publication date survives an archive', () => {
  it('an archived post is dated by its first publication when it is published again', async () => {
    const staff = await createStaff('editor')
    await rolledBack(async () => {
      const doc = randomUUID()
      await publishAs('posts', doc, { slug: unique('dated'), visible: true })
      await postgres.query(
        "update public.published_documents set first_published_at = '2026-01-05T09:00:00Z' where collection = 'posts' and doc_id = $1",
        [doc],
      )
      await asStaff(staff.userId, () => postgres.query(`select public.archive_document('posts', $1)`, [doc]))
      expect((await postgres.query('select 1 from public.published_documents where doc_id = $1', [doc])).rowCount).toBe(0)

      await postgres.query('select public.content_go_live($1, $2, $3)', ['posts', doc, 1])
      const row = await postgres.query<{ first: Date }>('select first_published_at as first from public.published_documents where doc_id = $1', [doc])
      expect(row.rows[0]!.first.toISOString()).toBe('2026-01-05T09:00:00.000Z')
    })
  })

  it('a document never archived is dated when it goes live, and the memo table is closed to every API role', async () => {
    await rolledBack(async () => {
      const doc = randomUUID()
      await publishAs('posts', doc, { slug: unique('fresh'), visible: true })
      const row = await postgres.query<{ fresh: boolean }>(
        "select first_published_at > now() - interval '1 minute' as fresh from public.published_documents where doc_id = $1",
        [doc],
      )
      expect(row.rows[0]!.fresh).toBe(true)
    })
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = await postgres.query<{ ok: boolean }>(
        "select has_table_privilege($1, 'finance.content_first_published', 'select') as ok",
        [role],
      )
      expect(access.rows[0]!.ok, role).toBe(false)
    }
  })
})

describe('content_documents carries the scheduled seq', () => {
  it('names the seq the pending schedule is on, null when none, and anon still cannot read the view', async () => {
    await rolledBack(async () => {
      const scheduled = unique('sched-seq')
      const plain = unique('plain-seq')
      for (const [doc, seq] of [[scheduled, 1], [scheduled, 2], [plain, 1]] as const) {
        await postgres.query(
          `insert into public.content_versions (collection, doc_id, seq, data) values ('taxonomies', $1, $2, '{"kind": "tag", "label": "اختبار"}'::jsonb)`,
          [doc, seq],
        )
      }
      await postgres.query(
        "update public.content_versions set publish_at = now() + interval '1 day' where doc_id = $1 and seq = 1",
        [scheduled],
      )
      const rows = await postgres.query<{ doc_id: string; latest_seq: number; scheduled_seq: number | null }>(
        'select doc_id, latest_seq, scheduled_seq from public.content_documents where doc_id = any($1) order by doc_id',
        [[scheduled, plain]],
      )
      expect(Object.fromEntries(rows.rows.map((row) => [row.doc_id, [row.latest_seq, row.scheduled_seq]]))).toEqual({
        [scheduled]: [2, 1],
        [plain]: [1, null],
      })
    })
    const access = await postgres.query<{ anon: boolean; authenticated: boolean }>(
      `select has_table_privilege('anon', 'public.content_documents', 'select') as anon,
              has_table_privilege('authenticated', 'public.content_documents', 'select') as authenticated`,
    )
    expect(access.rows[0]).toEqual({ anon: false, authenticated: true })
  })
})

describe('DB-site-2: the pg_cron run log is purged', () => {
  it('runs the scheduled command: runs older than seven days go, recent ones stay', async () => {
    await rolledBack(async () => {
      const job = (await postgres.query<{ jobid: string; command: string }>("select jobid, command from cron.job where jobname = 'cron-run-details-purge'"))
        .rows[0]!
      // The runids are given: the default draws from cron.runid_seq, which this role may not use.
      await postgres.query(
        `insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
         values ($1, -9001, 'postgres', 'postgres', 'zz-audit-old', 'succeeded', now() - interval '9 days', now() - interval '9 days'),
                ($1, -9002, 'postgres', 'postgres', 'zz-audit-recent', 'succeeded', now() - interval '2 days', now() - interval '2 days')`,
        [job.jobid],
      )
      await postgres.query(job.command)
      const left = await postgres.query<{ command: string }>("select command from cron.job_run_details where command like 'zz-audit-%'")
      expect(left.rows.map((row) => row.command)).toEqual(['zz-audit-recent'])
    })
  })
})
