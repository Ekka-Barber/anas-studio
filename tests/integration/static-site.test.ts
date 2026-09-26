// D32: the grants, buckets, rebuild coalescing and outbox kick of
// `supabase/migrations/20260927090000_static_site_and_functions.sql`, read
// straight from the catalog as the local `postgres` superuser. Anything that
// would call out (pg_net) runs inside a transaction that is rolled back, so
// no request is ever queued and the shared database is left as it was.
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
  'public.outbox_claim(integer, integer, integer, integer, integer)',
  'public.outbox_result(bigint, uuid, text, text, text)',
  'public.email_event_record(text, text, text, text, timestamptz, jsonb, text)',
  'public.job_run_record(text, text, jsonb, timestamptz)',
  'public.media_create_ticket(uuid, jsonb)',
  'public.media_ticket(uuid, uuid)',
  'public.media_claim(uuid, uuid)',
  'public.media_complete(uuid, uuid, text)',
  'public.media_delete(uuid, uuid)',
]

const PUBLISHING = [
  'public.publish_version(public.content_collection, text, integer)',
  'public.schedule_version(public.content_collection, text, integer, timestamptz)',
  'public.cancel_schedule(public.content_collection, text)',
  'public.archive_document(public.content_collection, text)',
]

const INTERNAL = ['public.site_build_request()', 'public.site_build_trigger()', 'public.outbox_kick()']

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

describe('site rebuilds (D32)', () => {
  it('a burst of requests is one build; nothing is triggered without the deploy hook', async () => {
    await rolledBack(async () => {
      await postgres.query("delete from vault.secrets where name = 'pages_deploy_hook'")
      await postgres.query('update finance.site_builds set requested_at = null, triggered_at = null')
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
      // Once the window has passed, the pending request triggers one build.
      await postgres.query("update finance.site_builds set triggered_at = now() - interval '3 minutes'")
      expect(await scalar<boolean>('public.site_build_trigger()')).toBe(true)
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
    })
  })
})
