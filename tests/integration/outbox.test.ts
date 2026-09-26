// P06: the outbox's SQL surface against the real local database. Rows are
// inserted directly as the local `postgres` superuser (fixtures), and the
// app_server functions (`outbox_claim`, `outbox_result`, `job_run_record`)
// are called as `app_server`; `outbox_attention`, `outbox_replay` and
// `job_runs_latest` go through real JWTs.
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaff, signIn } from './support'

let app: Client
let postgres: Client

const MY_PREFIX = 'p06-outbox-test-'

beforeAll(async () => {
  app = new Client({ connectionString: 'postgresql://app_server:app_server_local_only@127.0.0.1:54322/postgres' })
  await app.connect()
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  // Previous runs' leftovers.
  await postgres.query('delete from finance.email_outbox where dedupe_key like $1', [`${MY_PREFIX}%`])
})

afterAll(async () => {
  await app.end()
  await postgres.end()
})

let counter = 0
function uniqueKey(label: string): string {
  counter += 1
  return `${MY_PREFIX}${label}-${Date.now()}-${process.pid}-${counter}`
}

interface Inserted {
  id: string
  idempotency_key: string
}

async function insertRow(
  overrides: Partial<{ label: string; kind: string; priority: number; recipient: string; status: string; nextAtPast: boolean }> = {},
): Promise<Inserted> {
  const dedupeKey = uniqueKey(overrides.label ?? 'row')
  const result = await postgres.query<{ id: string; idempotency_key: string }>(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status)
     values ($1, $2, $3, $4, '{"contactId": null}'::jsonb, $5)
     returning id, idempotency_key`,
    [
      dedupeKey,
      overrides.kind ?? 'contact_notice',
      overrides.priority ?? 1,
      overrides.recipient ?? `${dedupeKey}@example.com`,
      overrides.status ?? 'pending',
    ],
  )
  return result.rows[0]!
}

/** Parks every foreign due row so a claim sees only this file's fixtures. */
async function parkOthers(): Promise<void> {
  await postgres.query(
    `update finance.email_outbox set next_at = now() + interval '1 day',
       first_attempt_at = now() - interval '2 days'
     where dedupe_key not like $1 and status in ('pending', 'uncertain', 'sending')`,
    [`${MY_PREFIX}%`],
  )
}

interface Claimed {
  id: string
  lease_id: string
  kind: string
  recipient: string
  idempotency_key: string
  attempts: number
}

async function claim(limit = 10): Promise<Claimed[]> {
  const result = await app.query<Claimed>(
    'select id, lease_id, kind, recipient, idempotency_key, attempts from public.outbox_claim($1, $2, $3, $4)',
    [limit, 120, 100, 20],
  )
  return result.rows
}

async function result(id: string, leaseId: string, outcome: string, providerId: string | null = null, error: string | null = null): Promise<boolean> {
  const r = await app.query<{ outbox_result: boolean }>('select public.outbox_result($1, $2, $3, $4, $5) as outbox_result', [
    id,
    leaseId,
    outcome,
    providerId,
    error,
  ])
  return r.rows[0]!.outbox_result
}

async function rowState(id: string): Promise<{ status: string; attempts: number; next_at: Date; idempotency_key: string; last_error: string | null }> {
  const r = await postgres.query<{ status: string; attempts: number; next_at: Date; idempotency_key: string; last_error: string | null }>(
    'select status, attempts, next_at, idempotency_key, last_error from finance.email_outbox where id = $1',
    [id],
  )
  return r.rows[0]!
}

/** Runs `fn` expecting a PostgreSQL error; returns its SQLSTATE. */
async function sqlstate(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('claiming', () => {
  it('claims most important first: priority 0 before 2', async () => {
    await parkOthers()
    const low = await insertRow({ label: 'prio2', priority: 2 })
    const high = await insertRow({ label: 'prio0', priority: 0 })
    const claimed = await claim(1)
    expect(claimed.map((row) => row.id)).toEqual([high.id])
    expect(await result(high.id, claimed[0]!.lease_id, 'accepted', 'test-provider-id')).toBe(true)
    await postgres.query('delete from finance.email_outbox where id = any($1)', [[high.id, low.id]])
  })

  it('an expired lease turns the row uncertain (never pending), and it is re-claimed inside 23 hours with the same idempotency key', async () => {
    await parkOthers()
    const row = await insertRow({ label: 'lease' })
    const first = await claim(1)
    expect(first.map((r) => r.id)).toEqual([row.id])

    // Expire the lease AND age the row past 23 hours: the next claim flips
    // the expired lease to `uncertain` but must not claim it again (its
    // idempotency key may have expired at the provider).
    await postgres.query(
      "update finance.email_outbox set lease_until = now() - interval '1 second', first_attempt_at = now() - interval '24 hours' where id = $1",
      [row.id],
    )
    const flipped = await claim(1)
    expect(flipped.find((r) => r.id === row.id)).toBeUndefined()
    expect((await rowState(row.id)).status).toBe('uncertain')

    // Inside the 23-hour window the same key is reused, so a retry cannot
    // send twice.
    await postgres.query('update finance.email_outbox set first_attempt_at = now() where id = $1', [row.id])
    const second = await claim(1)
    expect(second.map((r) => r.id)).toEqual([row.id])
    expect(second[0]!.idempotency_key).toBe(row.idempotency_key)
    expect(second[0]!.attempts).toBe(first[0]!.attempts + 1)
    await result(row.id, second[0]!.lease_id, 'accepted', 'test-provider-id')
  })

  it('an uncertain row older than 23 hours is not claimed again (its key may have expired at the provider)', async () => {
    await parkOthers()
    const row = await insertRow({ label: 'old-uncertain', status: 'uncertain' })
    await postgres.query(
      "update finance.email_outbox set first_attempt_at = now() - interval '24 hours' where id = $1",
      [row.id],
    )
    const claimed = await claim(1)
    expect(claimed.find((r) => r.id === row.id)).toBeUndefined()
  })

  it('a suppressed recipient is never claimed: the row becomes suppressed', async () => {
    await parkOthers()
    const recipient = `${uniqueKey('suppressed')}@example.com`
    const row = await insertRow({ label: 'suppressed', recipient })
    await postgres.query('insert into finance.email_suppressions (recipient_hash, reason) values ($1, \'manual\')', [
      createHash('sha256').update(recipient).digest('hex'),
    ])
    const claimed = await claim(10)
    expect(claimed.find((r) => r.id === row.id)).toBeUndefined()
    expect((await rowState(row.id)).status).toBe('suppressed')
  })
})

describe('outbox_result', () => {
  it('a stale lease returns false and changes nothing', async () => {
    await parkOthers()
    const row = await insertRow({ label: 'stale' })
    const claimed = await claim(1)
    expect(claimed[0]!.id).toBe(row.id)
    const stale = await result(row.id, randomUUID(), 'accepted', 'x')
    expect(stale).toBe(false)
    expect((await rowState(row.id)).status).toBe('sending')
    await result(row.id, claimed[0]!.lease_id, 'accepted', 'test-provider-id')
  })

  it('retry backs off exponentially and exhausts at max_attempts', async () => {
    await parkOthers()
    const row = await insertRow({ label: 'retry' })
    let claimed = await claim(1)
    expect(await result(row.id, claimed[0]!.lease_id, 'retry', null, 'RATE_LIMIT')).toBe(true)
    let state = await rowState(row.id)
    expect(state.status).toBe('pending')
    expect(state.attempts).toBe(1)
    expect(state.next_at.getTime()).toBeGreaterThan(Date.now() + 60_000) // 2^1 minutes

    // Force the last attempt; the next retry must exhaust the row.
    await postgres.query('update finance.email_outbox set attempts = max_attempts - 1, next_at = now() where id = $1', [row.id])
    claimed = await claim(1)
    expect(claimed[0]!.id).toBe(row.id)
    expect(await result(row.id, claimed[0]!.lease_id, 'retry', null, 'RATE_LIMIT')).toBe(true)
    state = await rowState(row.id)
    expect(state.status).toBe('exhausted')
    expect(state.last_error).toBe('RATE_LIMIT')
  })
})

describe('quota (free plan: 100/day, reserve 20 — see src/lib/outbox.ts sources)', () => {
  it('at quota − reserve priority 2 waits while 0 and 1 still go; at the quota nothing is claimed', async () => {
    await parkOthers()
    const todayCount = async () =>
      (await postgres.query('select count(*)::int as n from finance.email_outbox where sent_at >= date_trunc(\'day\', now())')).rows[0]!.n

    // Top the day up to exactly 80 sends (quota − reserve).
    const existing = await todayCount()
    expect(existing).toBeLessThan(80)
    await postgres.query(
      `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at, provider_id)
       select '${MY_PREFIX}quota80-' || g, 'contact_notice', 1, 'quota80@example.com', '{}'::jsonb, 'sent', now(), 'q' || g
       from generate_series(1, $1) as g`,
      [80 - existing],
    )
    expect(await todayCount()).toBe(80)

    const high = await insertRow({ label: 'quota-p0', priority: 0 })
    const mid = await insertRow({ label: 'quota-p1', priority: 1 })
    const low = await insertRow({ label: 'quota-p2', priority: 2 })
    let claimed = await claim(10)
    const ids = claimed.map((r) => r.id)
    expect(ids).toContain(high.id)
    expect(ids).toContain(mid.id)
    expect(ids).not.toContain(low.id)
    expect((await rowState(low.id)).status).toBe('pending')
    for (const row of claimed) await result(row.id, row.lease_id, 'accepted', 'test-provider-id')

    // Fill to exactly the quota: nothing is claimed at all.
    const nowSent = await todayCount()
    await postgres.query(
      `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at, provider_id)
       select '${MY_PREFIX}quota100-' || g, 'contact_notice', 1, 'quota100@example.com', '{}'::jsonb, 'sent', now(), 'r' || g
       from generate_series(1, $1) as g`,
      [100 - nowSent],
    )
    expect(await todayCount()).toBe(100)
    claimed = await claim(10)
    expect(claimed).toEqual([])
    // Leave the shared local database with a free quota for later suites.
    await postgres.query("delete from finance.email_outbox where dedupe_key like $1", [`${MY_PREFIX}quota`])
  })
})

describe('operations views through real JWTs', () => {
  it('outbox_attention flags replay_needs_confirmation only past the 23-hour window', async () => {
    const owner = await createStaff('owner')
    const fresh = await insertRow({ label: 'attention-fresh', status: 'uncertain' })
    await postgres.query('update finance.email_outbox set first_attempt_at = now() - interval \'1 hour\' where id = $1', [fresh.id])
    const old = await insertRow({ label: 'attention-old', status: 'uncertain' })
    await postgres.query("update finance.email_outbox set first_attempt_at = now() - interval '24 hours' where id = $1", [old.id])

    const client = await signIn(owner.email)
    const { data, error } = await client.rpc('outbox_attention')
    expect(error).toBeNull()
    const rows = data as Array<{ id: number; replay_needs_confirmation: boolean }>
    const oldRow = rows.find((r) => r.id === Number(old.id))
    const freshRow = rows.find((r) => r.id === Number(fresh.id))
    expect(oldRow?.replay_needs_confirmation).toBe(true)
    expect(freshRow?.replay_needs_confirmation).toBe(false)
  })

  it('editors get neither outbox_attention nor outbox_replay', async () => {
    const editor = await createStaff('editor')
    const client = await signIn(editor.email)
    const { error: attentionError } = await client.rpc('outbox_attention')
    expect(attentionError?.code).toBe('42501')
    const { error: replayError } = await client.rpc('outbox_replay', { p_id: 1, p_accept_duplicate_risk: false })
    expect(replayError?.code).toBe('42501')
  })

  it('replay of an expired-key uncertain row needs the duplicate risk and gets a new key', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    const row = await insertRow({ label: 'replay', status: 'uncertain' })
    await postgres.query("update finance.email_outbox set first_attempt_at = now() - interval '24 hours' where id = $1", [row.id])

    const refused = await client.rpc('outbox_replay', { p_id: Number(row.id), p_accept_duplicate_risk: false })
    expect(refused.error?.code).toBe('55000')

    const accepted = await client.rpc('outbox_replay', { p_id: Number(row.id), p_accept_duplicate_risk: true })
    expect(accepted.error).toBeNull()
    const state = await rowState(row.id)
    expect(state.status).toBe('pending')
    expect(state.idempotency_key).not.toBe(row.idempotency_key)

    // The dedupe key (the business identity) never changed.
    const stored = (await postgres.query<{ dedupe_key: string }>('select dedupe_key from finance.email_outbox where id = $1', [row.id]))
      .rows[0]!
    expect(stored.dedupe_key).toContain('replay')
  })

  it('replay of a suppressed recipient is refused', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    const recipient = `${uniqueKey('replay-suppressed')}@example.com`
    const row = await insertRow({ label: 'replay-suppressed', recipient, status: 'exhausted' })
    await postgres.query("insert into finance.email_suppressions (recipient_hash, reason) values ($1, 'bounced')", [
      createHash('sha256').update(recipient).digest('hex'),
    ])
    const { error } = await client.rpc('outbox_replay', { p_id: Number(row.id), p_accept_duplicate_risk: true })
    expect(error?.code).toBe('23514')
  })
})

describe('job runs', () => {
  it('job_run_record stores a run, and job_runs_latest is for owner and operations only', async () => {
    await app.query('select public.job_run_record($1, $2, $3, $4)', ['email_outbox', 'ok', JSON.stringify({ claimed: 1, accepted: 1 }), new Date()])

    const owner = await createStaff('owner')
    const ownerView = await (await signIn(owner.email)).rpc('job_runs_latest')
    expect(ownerView.error).toBeNull()
    expect((ownerView.data as Array<{ job: string }>).some((r) => r.job === 'email_outbox')).toBe(true)

    const operations = await createStaff('operations')
    const operationsView = await (await signIn(operations.email)).rpc('job_runs_latest')
    expect(operationsView.error).toBeNull()

    const editor = await createStaff('editor')
    const editorView = await (await signIn(editor.email)).rpc('job_runs_latest')
    expect(editorView.error?.code).toBe('42501')
  })
})
