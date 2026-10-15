// D32: the grants, buckets, rebuild coalescing and outbox kick of
// `supabase/migrations/20260927090000_static_site_and_functions.sql`, read
// straight from the catalog as the local `postgres` superuser. Anything that
// would call out (pg_net) runs inside a transaction that is rolled back, so
// no request is ever queued and the shared database is left as it was.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

async function canExecute(role: string, signature: string): Promise<boolean> {
  const result = await postgres.query<{ ok: boolean }>('select has_function_privilege($1, $2, $3) as ok', [
    role,
    signature,
    'execute',
  ])
  return result.rows[0]!.ok
}

const SERVER_ONLY = [
  'public.contact_submit(text, text, text, text, uuid, text)',
  'public.contact_for_notice(uuid)',
  'public.outbox_claim(integer, integer, integer, integer, integer, integer)',
  'public.outbox_result(bigint, uuid, text, text, text)',
  'public.email_event_record(text, text, text, text, timestamptz, jsonb, text)',
  'public.job_run_record(text, text, jsonb, timestamptz)',
  'public.media_create_ticket(uuid, jsonb)',
  'public.media_ticket(uuid, uuid)',
  'public.media_claim(uuid, uuid)',
  'public.media_complete(uuid, uuid, text)',
  'public.media_delete(uuid, uuid)',
  'public.media_sweep_candidates(integer)',
  'public.media_tickets_purge()',
]

const PUBLISHING = [
  'public.publish_version(public.content_collection, text, integer)',
  'public.schedule_version(public.content_collection, text, integer, timestamptz)',
  'public.cancel_schedule(public.content_collection, text)',
  'public.archive_document(public.content_collection, text)',
]

const INTERNAL = [
  'public.site_build_request()',
  'public.site_build_trigger()',
  'public.outbox_kick()',
  'public.media_sweep_kick()',
]

describe('grants (D32)', () => {
  it.each(SERVER_ONLY)('%s: service_role only', async (signature) => {
    expect(await canExecute('service_role', signature)).toBe(true)
    expect(await canExecute('authenticated', signature)).toBe(false)
    expect(await canExecute('anon', signature)).toBe(false)
  })

  it.each(PUBLISHING)('%s: signed-in staff, never anon', async (signature) => {
    expect(await canExecute('authenticated', signature)).toBe(true)
    expect(await canExecute('anon', signature)).toBe(false)
  })

  it.each(INTERNAL)('%s: no API role', async (signature) => {
    expect(await canExecute('authenticated', signature)).toBe(false)
    expect(await canExecute('anon', signature)).toBe(false)
  })

  it('the p_actor publishing functions, app_server and health() are gone', async () => {
    const gone = await postgres.query<{ fn: string | null }>(
      `select to_regprocedure(unnest(array[
         'public.publish_version(uuid, public.content_collection, text, integer)',
         'public.archive_document(uuid, public.content_collection, text)',
         'public.health()'
       ])) as fn`,
    )
    expect(gone.rows.map((row) => row.fn)).toEqual([null, null, null])
    const role = await postgres.query("select 1 from pg_catalog.pg_roles where rolname = 'app_server'")
    expect(role.rowCount).toBe(0)
  })
})

describe('storage buckets (D32)', () => {
  it('originals are private; the public bucket takes checked WebP only', async () => {
    const buckets = await postgres.query<{
      id: string
      public: boolean
      file_size_limit: string
      allowed_mime_types: string[]
    }>(
      `select id, public, file_size_limit::text, allowed_mime_types
       from storage.buckets where id in ('media-private', 'media-public') order by id`,
    )
    expect(buckets.rows).toEqual([
      {
        id: 'media-private',
        public: false,
        file_size_limit: '15728640',
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
      },
      { id: 'media-public', public: true, file_size_limit: '4194304', allowed_mime_types: ['image/webp'] },
    ])
  })
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

async function scalar<T>(sql: string): Promise<T> {
  const result = await postgres.query<{ v: T }>(`select ${sql} as v`)
  return result.rows[0]!.v
}

/** Writes pg_net's answer for the call in flight, as its worker would. */
async function answer(status: number | null, timedOut: boolean): Promise<void> {
  await postgres.query(
    `insert into net._http_response (id, status_code, timed_out, error_msg)
     select request_id, $1, $2, case when $2 then 'Timeout was reached' end
     from finance.site_builds where id = 1 and request_id is not null`,
    [status, timedOut],
  )
}

async function lastRun(): Promise<{ status: string; detail: Record<string, unknown> } | undefined> {
  const result = await postgres.query<{ status: string; detail: Record<string, unknown> }>(
    "select status, detail from finance.job_runs where job = 'site_build' order by id desc limit 1",
  )
  return result.rows[0]
}

async function builds(): Promise<{ request_id: string | null; failures: number; rearmed: boolean }> {
  const result = await postgres.query<{ request_id: string | null; failures: number; rearmed: boolean }>(
    'select request_id, failures, triggered_at is null as rearmed from finance.site_builds where id = 1',
  )
  return result.rows[0]!
}

describe('site rebuilds (D32)', () => {
  it('a burst of requests is one build; nothing is triggered without the deploy hook', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name = 'pages_deploy_hook'")
      await postgres.query(
        'update finance.site_builds set requested_at = null, triggered_at = null, request_id = null, failures = 0',
      )
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)

      await postgres.query('select public.site_build_request()')
      // Requested, but no hook in Vault: nothing to call.
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)

      // The discard port: the request is rolled back before pg_net sends it anyway.
      await postgres.query("select vault.create_secret('http://127.0.0.1:9/deploy-hook', 'pages_deploy_hook')")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      // Already triggered for this request.
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)

      // A new request inside the two-minute window waits for the next run.
      await postgres.query("update finance.site_builds set requested_at = now() + interval '1 second'")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      // Still waiting for the last call's answer: no second call.
      await postgres.query("update finance.site_builds set triggered_at = now() - interval '3 minutes'")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      // Once it answered 2xx and the window has passed, the pending request triggers one build.
      await answer(204, false)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
    })
  })

  it('records every answered call as a site_build run and re-arms a failed one (I34)', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name = 'pages_deploy_hook'")
      await postgres.query("select vault.create_secret('http://127.0.0.1:9/deploy-hook', 'pages_deploy_hook')")
      await postgres.query('delete from finance.job_runs where job = $1', ['site_build'])
      await postgres.query(
        `update finance.site_builds
         set requested_at = now() - interval '5 minutes', triggered_at = null, request_id = null, failures = 0`,
      )
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)

      // 2xx: recorded ok, nothing owed, nothing called.
      await answer(204, false)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      expect(await lastRun()).toMatchObject({ status: 'ok', detail: { httpStatus: 204, attempt: 1 } })
      expect(await builds()).toMatchObject({ request_id: null, failures: 0, rearmed: false })

      // A 500: recorded failed, re-armed and called again in the same run.
      await postgres.query("update finance.site_builds set requested_at = now() - interval '1 minute'")
      await postgres.query("update finance.site_builds set triggered_at = now() - interval '3 minutes'")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      await answer(500, false)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      expect(await lastRun()).toMatchObject({ status: 'failed', detail: { httpStatus: 500, attempt: 1 } })
      expect((await builds()).failures).toBe(1)

      // A timeout is a failure too.
      await answer(null, true)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      expect(await lastRun()).toMatchObject({ status: 'failed', detail: { timedOut: true, attempt: 2 } })

      // No answer yet: wait. No answer after ten minutes: the call is lost.
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      await postgres.query("update finance.site_builds set triggered_at = now() - interval '11 minutes'")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      expect(await lastRun()).toMatchObject({ status: 'failed', detail: { noAnswer: true, attempt: 3 } })

      // The fifth failure in a row is not re-armed: the owner sees it failed.
      await postgres.query('update finance.site_builds set failures = 4')
      await answer(404, false)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      expect(await lastRun()).toMatchObject({ status: 'failed', detail: { httpStatus: 404, attempt: 5 } })
      expect(await builds()).toMatchObject({ request_id: null, failures: 5, rearmed: false })
    })
  })

  it('a build that is owed with no deploy hook in Vault is recorded once as skipped, reason NO_HOOK (AUDIT-2)', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name = 'pages_deploy_hook'")
      await postgres.query('delete from finance.job_runs where job = $1', ['site_build'])
      await postgres.query('update finance.site_builds set requested_at = null, triggered_at = null, request_id = null, failures = 0')
      // Nothing requested: nothing to report.
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      expect(await lastRun()).toBeUndefined()

      await postgres.query('select public.site_build_request()')
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      expect(await lastRun()).toMatchObject({ status: 'skipped', detail: { reason: 'NO_HOOK' } })
      // The job runs every minute: still one row.
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(false)
      expect(await scalar<number>("(select count(*)::int from finance.job_runs where job = 'site_build')")).toBe(1)
    })
  })

  it('every request gets its own five attempts: a new request resets the failure count (AUDIT-2)', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name = 'pages_deploy_hook'")
      await postgres.query("select vault.create_secret('http://127.0.0.1:9/deploy-hook', 'pages_deploy_hook')")
      // An earlier episode ended with five failures and was dropped.
      await postgres.query(
        `update finance.site_builds
         set requested_at = now() - interval '2 hours', triggered_at = now() - interval '1 hour', request_id = null, failures = 5`,
      )
      await postgres.query('select public.site_build_request()')
      expect((await builds()).failures).toBe(0)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      // This request's first attempt fails: it is re-armed, not dropped.
      await answer(502, false)
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
      expect((await builds()).failures).toBe(1)
    })
  })

  it('scheduled publishing asks for a rebuild only when something went live', async () => {
    await rolledBack(async () => {
      await postgres.query(
        "update public.content_versions set publish_at = now() + interval '1 day' where publish_at is not null",
      )
      await postgres.query('update finance.site_builds set requested_at = null')
      expect(await scalar<number>('public.publish_due()')).toBe(0)
      expect(await scalar<string | null>('(select requested_at from finance.site_builds)')).toBeNull()

      // The other half: a due version goes live, is unscheduled, is audited and
      // asks for one rebuild; a second run finds nothing due.
      const docId = `due-${Date.now()}`
      await postgres.query(
        "insert into public.content_versions (collection, doc_id, seq, data, publish_at) values ('taxonomies', $1, 1, '{}'::jsonb, now() - interval '1 minute')",
        [docId],
      )
      expect(await scalar<number>('public.publish_due()')).toBe(1)
      const live = await postgres.query<{ seq: number }>(
        "select seq from public.published_documents where collection = 'taxonomies' and doc_id = $1",
        [docId],
      )
      expect(live.rows).toEqual([{ seq: 1 }])
      const version = await postgres.query<{ publish_at: string | null }>(
        "select publish_at from public.content_versions where collection = 'taxonomies' and doc_id = $1 and seq = 1",
        [docId],
      )
      expect(version.rows).toEqual([{ publish_at: null }])
      expect(await scalar<string | null>('(select requested_at from finance.site_builds)')).not.toBeNull()
      const audit = await postgres.query<{ n: number }>(
        "select count(*)::int as n from public.audit_events where action = 'content.publish_due' and entity = 'taxonomies' and entity_id = $1",
        [docId],
      )
      expect(audit.rows[0]!.n).toBe(1)
      expect(await scalar<number>('public.publish_due()')).toBe(0)
    })
  })
})

// RESIDUALS-1 R2a, DB-COMMERCE-08: the catalog asks for a Pages build (500 a month on the free plan) only for a change the
// public pages show. A rolled-back transaction, so the shared database keeps its build state; `now()` is fixed inside it, and
// a request shows as `requested_at` moving from the parked time (ten minutes back) to the transaction's `now()`.
describe('catalog rebuilds (DB-COMMERCE-08)', () => {
  async function asking(body: (asked: (sql: string, params?: unknown[]) => Promise<boolean>) => Promise<void>): Promise<void> {
    await rolledBack(async () => {
      const requestedAt = async (): Promise<number | null> => (await scalar<Date | null>('(select requested_at from finance.site_builds where id = 1)'))?.getTime() ?? null
      const asked = async (sql: string, params: unknown[] = []): Promise<boolean> => {
        await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
        const parked = await requestedAt()
        await postgres.query(sql, params)
        return (await requestedAt()) !== parked
      }
      await body(asked)
    })
  }
  const SEVEN = 'slug = slug, title = title, summary = summary, body = body, cover_image = cover_image, status = status, sort_order = sort_order'
  const product = async (status: string): Promise<string> => {
    const slug = `build-trigger-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    return (await postgres.query<{ id: string }>("insert into public.products (slug, title, summary, status) values ($1, 'عنوان', '', $2) returning id", [slug, status])).rows[0]!.id
  }
  const variant = async (productId: string): Promise<string> =>
    (
      await postgres.query<{ id: string }>(
        "insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled) values ($1, $2, 'خيار', 'digital', 1000, true) returning id",
        [productId, `SKU-BUILD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`],
      )
    ).rows[0]!.id

  it('a product save asks for a build only when a public column changed on a product that is or was published: a draft\'s save, an unchanged save and a stale save ask for none', async () => {
    await asking(async (asked) => {
      const draft = await product('draft')
      const published = await product('published')
      // The admin form sends all seven public columns with every save, changed or not.
      expect(await asked(`update public.products set ${SEVEN} where id = $1`, [draft])).toBe(false)
      expect(await asked(`update public.products set ${SEVEN} where id = $1`, [published])).toBe(false)
      // A lost version conflict matches no row, and the statement still lists the columns.
      expect(await asked(`update public.products set ${SEVEN} where id = $1`, [randomUUID()])).toBe(false)
      // A draft changing is not a change of the public pages; a published product's title is.
      expect(await asked("update public.products set title = 'عنوان جديد' where id = $1", [draft])).toBe(false)
      expect(await asked("update public.products set title = 'عنوان آخر' where id = $1", [published])).toBe(true)
      expect(await asked("update public.products set summary = 'ملخص' where id = $1", [published])).toBe(true)
      // What the pages do not show.
      expect(await asked('update public.products set version = version + 1 where id = $1', [published])).toBe(false)
      // Entering and leaving the public shelf are changes; an archived product staying archived is not.
      expect(await asked("update public.products set status = 'published' where id = $1", [draft])).toBe(true)
      expect(await asked("update public.products set status = 'archived' where id = $1", [draft])).toBe(true)
      expect(await asked("update public.products set title = 'بعد الأرشفة' where id = $1", [draft])).toBe(false)
      // A new product and a removed one still ask (the statement trigger).
      expect(await asked('delete from public.products where id = $1', [draft])).toBe(true)
      expect(await asked("insert into public.products (slug, title, summary, status) values ($1, 'جديد', '', 'draft')", [`build-trigger-new-${Date.now()}-${process.pid}`])).toBe(true)
    })
  })

  it('a variant of a product that is not published asks for no build when it changes; a published product\'s variant does, and so does moving a variant on or off the public shelf', async () => {
    await asking(async (asked) => {
      const draft = await product('draft')
      const archived = await product('archived')
      const published = await product('published')
      const [ofDraft, ofArchived, ofPublished] = [await variant(draft), await variant(archived), await variant(published)]
      expect(await asked('update public.product_variants set price_halalas = 1500 where id = $1', [ofDraft])).toBe(false)
      expect(await asked("update public.product_variants set enabled = false, title = 'عنوان' where id = $1", [ofArchived])).toBe(false)
      expect(await asked('update public.product_variants set price_halalas = 1500 where id = $1', [ofPublished])).toBe(true)
      // The product of a variant changing hands counts when either side is published.
      expect(await asked('update public.product_variants set product_id = $2 where id = $1', [ofDraft, archived])).toBe(false)
      expect(await asked('update public.product_variants set product_id = $2 where id = $1', [ofDraft, published])).toBe(true)
      expect(await asked('update public.product_variants set product_id = $2 where id = $1', [ofDraft, draft])).toBe(true)
      // Inserting and deleting a variant still ask (the statement trigger).
      expect(await asked('delete from public.product_variants where id = $1', [ofArchived])).toBe(true)
      // A published product's variant that saves nothing new asks for nothing, as before.
      expect(await asked('update public.product_variants set price_halalas = price_halalas, sku = sku where id = $1', [ofPublished])).toBe(false)
    })
  })
})

describe('media housekeeping (I29)', () => {
  it('lists only quarantine parts older than a day and purges only day-old tickets', async () => {
    await rolledBack(async () => {
      const user = await postgres.query<{ id: string }>(
        `insert into auth.users (id, instance_id, aud, role, email)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 'sweep-' || gen_random_uuid() || '@example.com')
         returning id`,
      )
      const actor = user.rows[0]!.id
      const tickets = await postgres.query<{ id: string }>(
        `insert into public.media_upload_tickets (actor, declared, created_at)
         values ($1, '{"original": {"bytes": 1}}', now() - interval '25 hours'),
                ($1, '{"original": {"bytes": 1}}', now() - interval '1 hour')
         returning id`,
        [actor],
      )
      const [oldTicket, newTicket] = tickets.rows.map((row) => row.id)
      await postgres.query(
        `insert into storage.objects (bucket_id, name, created_at) values
           ('media-private', 'quarantine/' || $1 || '/original', now() - interval '25 hours'),
           ('media-private', 'quarantine/' || $2 || '/original', now() - interval '1 hour'),
           ('media-private', 'originals/' || $1, now() - interval '25 hours')`,
        [oldTicket, newTicket],
      )

      const candidates = await scalar<string[]>('public.media_sweep_candidates(1000)')
      expect(candidates).toContain(`quarantine/${oldTicket}/original`)
      expect(candidates).not.toContain(`quarantine/${newTicket}/original`)
      expect(candidates.every((name) => name.startsWith('quarantine/'))).toBe(true)
      expect(await scalar<string[]>('public.media_sweep_candidates(0)')).toHaveLength(1)

      expect(await scalar<number>('public.media_tickets_purge()')).toBeGreaterThanOrEqual(1)
      const left = await postgres.query<{ id: string }>('select id from public.media_upload_tickets where actor = $1', [actor])
      expect(left.rows.map((row) => row.id)).toEqual([newTicket])
    })
  })

  it('kicks the sweep only when Vault holds the functions address', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name in ('functions_url', 'jobs_secret')")
      expect(await scalar<boolean>('public.media_sweep_kick()')).toBe(false)
      await postgres.query("select vault.create_secret('http://127.0.0.1:9/functions/v1', 'functions_url')")
      await postgres.query("select vault.create_secret('test-jobs-secret', 'jobs_secret')")
      expect(await scalar<boolean>('public.media_sweep_kick()')).toBe(true)
    })
  })
})

describe('outbox kick (D32)', () => {
  it('calls the outbox function only while a row is due and Vault holds its address', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name in ('functions_url', 'jobs_secret')")
      await postgres.query(
        `update finance.email_outbox set next_at = now() + interval '1 day', lease_until = now() + interval '1 day'
         where status in ('pending', 'uncertain', 'sending')`,
      )
      expect(await scalar<boolean>('public.outbox_kick()')).toBe(false)

      await postgres.query(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status)
         values ('d32-kick-' || gen_random_uuid(), 'contact_notice', 1, 'kick@example.com', '{"contactId": null}', 'pending')`,
      )
      // Due, but no address in Vault.
      expect(await scalar<boolean>('public.outbox_kick()')).toBe(false)

      await postgres.query("select vault.create_secret('http://127.0.0.1:9/functions/v1', 'functions_url')")
      await postgres.query("select vault.create_secret('test-jobs-secret', 'jobs_secret')")
      expect(await scalar<boolean>('public.outbox_kick()')).toBe(true)

      // I35: the kick and the claim share one predicate. An uncertain row past
      // the 23-hour idempotency window waits for a person's replay, so it
      // never wakes the function; an expired sending lease still does,
      // because the claim's expiry step must flip it.
      await postgres.query("delete from finance.email_outbox where dedupe_key like 'd32-kick-%'")
      await postgres.query(
        `insert into finance.email_outbox
           (dedupe_key, kind, priority, recipient, payload, status, first_attempt_at, next_at)
         values ('i35-uncertain-' || gen_random_uuid(), 'contact_notice', 1, 'i35-uncertain@example.com',
                 '{"contactId": null}', 'uncertain', now() - interval '24 hours', now())`,
      )
      expect(await scalar<boolean>('public.outbox_kick()')).toBe(false)
      await postgres.query(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, lease_until)
         values ('i35-lease-' || gen_random_uuid(), 'contact_notice', 1, 'i35-lease@example.com',
                 '{"contactId": null}', 'sending', now() - interval '1 minute')`,
      )
      expect(await scalar<boolean>('public.outbox_kick()')).toBe(true)
    })
  })
})
