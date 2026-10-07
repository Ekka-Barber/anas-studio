// P06: delivery events and suppression (`email_event_record`) against the
// real local database, then `runOutbox()` end to end as `service_role` (the
// `outbox` Edge Function's role, D32) through a direct session, with `fetch`
// stubbed per outcome. Provider acceptance alone is never delivery: a sent
// row keeps `delivery` null until a verified event arrives.
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { runOutbox } from '../../supabase/functions/_shared/outbox.ts'
import { createStaff, pgRpc, serviceRoleDb } from './support'

let app: Client
let rpc: Rpc
let postgres: Client

const PREFIX = 'p06-delivery-test-'
const created = { outbox: [] as string[], contacts: [] as string[], events: [] as string[], suppressions: [] as string[] }

beforeAll(async () => {
  app = await serviceRoleDb()
  rpc = pgRpc(app)
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  await postgres.query('delete from finance.email_outbox where id = any($1::bigint[])', [created.outbox])
  await postgres.query('delete from public.contacts where id = any($1::uuid[])', [created.contacts])
  await postgres.query('delete from finance.email_delivery_events where provider_event_id = any($1)', [created.events])
  await postgres.query('delete from finance.email_suppressions where recipient_hash = any($1)', [created.suppressions])
  await app.end()
  await postgres.end()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function unique(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e6)}`
}

function hashOf(recipient: string): string {
  return createHash('sha256').update(recipient).digest('hex')
}

async function recordEvent(params: {
  svixId?: string
  type: string
  messageId: string
  recipient: string
  bounceType?: string
  evidence?: Record<string, unknown>
}): Promise<string> {
  const svixId = params.svixId ?? unique('evt')
  created.events.push(svixId)
  created.suppressions.push(hashOf(params.recipient))
  try {
    const result = await app.query<{ email_event_record: string }>(
      'select public.email_event_record($1, $2, $3, $4, $5, $6, $7) as email_event_record',
      [
        svixId,
        params.type,
        params.messageId,
        params.recipient,
        new Date(),
        JSON.stringify(params.evidence ?? {}),
        params.bounceType ?? null,
      ],
    )
    return result.rows[0]!.email_event_record
  } catch (error) {
    return (error as { code?: string }).code ?? 'threw'
  }
}

async function sentRow(label: string): Promise<{ id: string; recipient: string; providerId: string }> {
  const recipient = `${unique(label)}@example.com`
  const providerId = `${label}-${Date.now()}`
  const row = await postgres.query<{ id: string }>(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, provider_id, sent_at)
     values ($1, 'contact_notice', 1, $2, '{}'::jsonb, 'sent', $3, now()) returning id`,
    [unique(label), recipient, providerId],
  )
  const id = row.rows[0]!.id
  created.outbox.push(id)
  created.suppressions.push(hashOf(recipient))
  return { id, recipient, providerId }
}

describe('email_event_record', () => {
  it('records a duplicate event id exactly once; the redelivery changes nothing', async () => {
    const svixId = unique('dup')
    const row = await sentRow('dup')
    expect(await recordEvent({ svixId, type: 'email.delivered', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(await recordEvent({ svixId, type: 'email.bounced', messageId: row.providerId, recipient: row.recipient })).toBe('duplicate')
    expect(
      (await postgres.query<{ delivery: string }>('select delivery from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .delivery,
    ).toBe('delivered')
    const suppression = await postgres.query('select 1 from finance.email_suppressions where recipient_hash = $1', [
      hashOf(row.recipient),
    ])
    expect(suppression.rows).toEqual([])
  })

  it('delivered then bounced ends bounced and suppressed', async () => {
    const row = await sentRow('order-1')
    expect(await recordEvent({ type: 'email.delivered', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(
      (await postgres.query<{ delivery: string }>('select delivery from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .delivery,
    ).toBe('delivered')
    expect(await recordEvent({ type: 'email.bounced', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(
      (await postgres.query<{ delivery: string }>('select delivery from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .delivery,
    ).toBe('bounced')
    const suppression = await postgres.query<{ reason: string }>(
      'select reason from finance.email_suppressions where recipient_hash = $1',
      [hashOf(row.recipient)],
    )
    expect(suppression.rows[0]!.reason).toBe('bounced')
  })

  it('bounced then delivered: a later delivered never clears the bounce or the suppression', async () => {
    const row = await sentRow('order-2')
    expect(await recordEvent({ type: 'email.bounced', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(await recordEvent({ type: 'email.delivered', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(
      (await postgres.query<{ delivery: string }>('select delivery from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .delivery,
    ).toBe('bounced')
    const suppression = await postgres.query('select 1 from finance.email_suppressions where recipient_hash = $1', [
      hashOf(row.recipient),
    ])
    expect(suppression.rows.length).toBe(1)
  })

  it('bounce types in Resend vocabulary: Permanent suppresses, Temporary records only, a missing type suppresses', async () => {
    const permanent = await sentRow('bounce-permanent')
    expect(
      await recordEvent({ type: 'email.bounced', messageId: permanent.providerId, recipient: permanent.recipient, bounceType: 'Permanent' }),
    ).toBe('recorded')
    const hardSuppression = await postgres.query<{ reason: string }>(
      'select reason from finance.email_suppressions where recipient_hash = $1',
      [hashOf(permanent.recipient)],
    )
    expect(hardSuppression.rows[0]!.reason).toBe('bounced')

    const temporary = await sentRow('bounce-temporary')
    expect(
      await recordEvent({ type: 'email.bounced', messageId: temporary.providerId, recipient: temporary.recipient, bounceType: 'Temporary' }),
    ).toBe('recorded')
    // Recorded, never suppressed: a temporary bounce may deliver later.
    expect(
      (await postgres.query('select 1 from finance.email_suppressions where recipient_hash = $1', [hashOf(temporary.recipient)])).rows,
    ).toEqual([])
    expect(
      (await postgres.query<{ type: string }>('select type from finance.email_delivery_events where provider_message_id = $1', [
        temporary.providerId,
      ])).rows.map((r) => r.type),
    ).toEqual(['email.bounced'])

    const missing = await sentRow('bounce-missing-type')
    expect(await recordEvent({ type: 'email.bounced', messageId: missing.providerId, recipient: missing.recipient })).toBe('recorded')
    expect(
      (await postgres.query('select 1 from finance.email_suppressions where recipient_hash = $1', [hashOf(missing.recipient)])).rows.length,
    ).toBe(1)
  })

  // FABLE-AUDIT M2-10 (VENDOR-PAY-03): Resend's bounce types are Permanent, Transient and Undetermined.
  it('an Undetermined bounce is treated like a Transient one: recorded, nothing suppressed, and the next mail to the address still goes; a Permanent one suppresses and holds the next mail back', async () => {
    const suppressed = async (recipient: string): Promise<unknown[]> =>
      (await postgres.query('select reason from finance.email_suppressions where recipient_hash = $1', [hashOf(recipient)])).rows
    const undetermined = await sentRow('bounce-undetermined')
    expect(
      await recordEvent({
        type: 'email.bounced',
        messageId: undetermined.providerId,
        recipient: undetermined.recipient,
        bounceType: 'Undetermined',
        evidence: { bounceType: 'Undetermined', bounceSubType: 'Undetermined' },
      }),
    ).toBe('recorded')
    expect(await suppressed(undetermined.recipient)).toEqual([])
    // The row says what happened to it all the same.
    expect((await postgres.query<{ delivery: string }>('select delivery from finance.email_outbox where id = $1', [undetermined.id])).rows[0]!.delivery).toBe('bounced')
    const transient = await sentRow('bounce-transient')
    expect(await recordEvent({ type: 'email.bounced', messageId: transient.providerId, recipient: transient.recipient, bounceType: 'Transient' })).toBe('recorded')
    expect(await suppressed(transient.recipient)).toEqual([])
    const permanent = await sentRow('bounce-permanent-next')
    expect(await recordEvent({ type: 'email.bounced', messageId: permanent.providerId, recipient: permanent.recipient, bounceType: 'Permanent' })).toBe('recorded')
    expect(await suppressed(permanent.recipient)).toEqual([{ reason: 'bounced' }])

    // The next mail to each address, a buyer's receipt due long ago, in a claim that is rolled back.
    await postgres.query('begin')
    try {
      const next = async (recipient: string): Promise<string> =>
        (
          await postgres.query<{ id: string }>(
            `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, next_at)
             values ($1, 'receipt', 0, $2, '{}'::jsonb, now() - interval '10 years') returning id`,
            [unique('next'), recipient],
          )
        ).rows[0]!.id
      const toUndetermined = await next(undetermined.recipient)
      const toPermanent = await next(permanent.recipient)
      await postgres.query('set local role service_role')
      const claimed = (await postgres.query<{ id: string }>('select id from public.outbox_claim(1, 60, 1000000, 0, 100000000, 0)')).rows.map((row) => row.id)
      await postgres.query('set local role postgres')
      const statusOf = async (id: string): Promise<string> =>
        (await postgres.query<{ status: string }>('select status from finance.email_outbox where id = $1', [id])).rows[0]!.status
      expect(claimed).toEqual([toUndetermined])
      expect(await statusOf(toUndetermined)).toBe('sending')
      expect(await statusOf(toPermanent)).toBe('suppressed')
    } finally {
      await postgres.query('rollback')
    }
  })

  it('an undocumented bounce type suppresses conservatively and the evidence keeps the raw type', async () => {
    const unknown = await sentRow('bounce-unknown')
    expect(
      await recordEvent({
        type: 'email.bounced',
        messageId: unknown.providerId,
        recipient: unknown.recipient,
        bounceType: 'Undocumented',
        evidence: { bounceType: 'Undocumented' },
      }),
    ).toBe('recorded')
    expect(
      (await postgres.query('select 1 from finance.email_suppressions where recipient_hash = $1', [hashOf(unknown.recipient)])).rows.length,
    ).toBe(1)
    const evidence = await postgres.query<{ evidence: Record<string, unknown> }>(
      'select evidence from finance.email_delivery_events where provider_message_id = $1',
      [unknown.providerId],
    )
    expect(evidence.rows[0]!.evidence).toMatchObject({ bounceType: 'Undocumented' })
  })

  it('a complaint suppresses the recipient', async () => {
    const row = await sentRow('complaint')
    expect(await recordEvent({ type: 'email.complained', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    const suppression = await postgres.query<{ reason: string }>(
      'select reason from finance.email_suppressions where recipient_hash = $1',
      [hashOf(row.recipient)],
    )
    expect(suppression.rows[0]!.reason).toBe('complained')
  })

  it('a sent row with no delivery event keeps delivery null — acceptance is not delivery', async () => {
    const row = await sentRow('sent-only')
    expect(await recordEvent({ type: 'email.sent', messageId: row.providerId, recipient: row.recipient })).toBe('recorded')
    expect(
      (await postgres.query<{ delivery: string | null }>('select delivery from finance.email_outbox where id = $1', [row.id]))
        .rows[0]!.delivery,
    ).toBeNull()
  })
})

describe('runOutbox (fetch stubbed, service_role through a direct session)', () => {
  beforeEach(() => {
    // Resend is chosen only for a hosted site (a non-local SITE_URL).
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', 'Anas <noreply@anas.studio>')
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    vi.stubEnv('EMAIL_DEV_MAILPIT_URL', '')
    // A configured deployment: the dispatcher claims nothing while it cannot build a link.
    vi.stubEnv('TOKEN_HASH_PEPPER', 'test-pepper-for-the-outbox-tests')
  })

  /** Parks only the foreign rows that are due right now (the only ones this
   * suite's claims could see), so other suites' parked or not-yet-due
   * fixtures survive untouched; removes this suite's own unfinished leftovers
   * (an earlier test's or a crashed run's backed-off row can never be claimed
   * by a later test); and moves the outbox suite's synthetic quota filler
   * (its `p06-outbox-test-quota*` dedupe keys) out of today so the free-plan
   * daily quota in `outbox_claim` is not already consumed — its real sent
   * rows are left as they are. This suite's own rows are only ever deleted,
   * never rewritten. */
  async function parkOthers(): Promise<void> {
    await postgres.query(
      `update finance.email_outbox set next_at = now() + interval '1 day',
         first_attempt_at = now() - interval '2 days'
       where dedupe_key not like $1 and status in ('pending', 'uncertain', 'sending')
         and next_at <= now()`,
      [`${PREFIX}%`],
    )
    await postgres.query(
      `delete from finance.email_outbox where dedupe_key like $1 and status in ('pending', 'uncertain', 'sending')`,
      [`${PREFIX}%`],
    )
    await postgres.query(
      `update finance.email_outbox set sent_at = now() - interval '2 days'
       where sent_at >= date_trunc('day', now()) and dedupe_key like 'p06-outbox-test-quota%'`,
    )
  }

  async function pendingNotice(
    label: string,
    message: string,
  ): Promise<{ id: string; recipient: string; visitor: string }> {
    const visitor = `${unique(label)}@example.com`
    const contact = await postgres.query<{ id: string }>(
      'insert into public.contacts (name, email, message, submission_key) values ($1, $2, $3, $4) returning id',
      ['زائر', visitor, message, randomUUID()],
    )
    const contactId = contact.rows[0]!.id
    created.contacts.push(contactId)
    const recipient = `${unique(label)}@example.com`
    // A contact notice goes only to an active owner or operations member (S03.5).
    await createStaff('operations', { email: recipient })
    const row = await postgres.query<{ id: string }>(
      `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
       values ($1, 'contact_notice', 1, $2, jsonb_build_object('contactId', $3::text)) returning id`,
      [unique(label), recipient, contactId],
    )
    created.outbox.push(row.rows[0]!.id)
    created.suppressions.push(hashOf(recipient))
    return { id: row.rows[0]!.id, recipient, visitor }
  }

  function stubFetch(handler: () => Response | Promise<Response>) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return handler()
    })
    vi.stubGlobal('fetch', fn)
    return { fn, calls }
  }

  it('accepted end to end: sent with the provider id, delivery null, a plain-text notice with the message and Reply-To', async () => {
    await parkOthers()
    const marker = unique('accepted')
    const row = await pendingNotice('accepted', `رسالة العميل ${marker}`)
    const { fn, calls } = stubFetch(() => new Response(JSON.stringify({ id: 'prov-accepted-1' }), { status: 200 }))
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ job: 'email_outbox', status: 'ok', claimed: 1, accepted: 1 })
    expect(fn).toHaveBeenCalledTimes(1)

    const state = (
      await postgres.query<{ status: string; provider_id: string; delivery: string | null }>(
        'select status, provider_id, delivery from finance.email_outbox where id = $1',
        [row.id],
      )
    ).rows[0]!
    expect(state).toEqual({ status: 'sent', provider_id: 'prov-accepted-1', delivery: null })

    const payload = JSON.parse(String(calls[0]!.init.body)) as {
      to: string[]
      subject: string
      text: string
      reply_to?: string
    }
    expect(payload.to).toEqual([row.recipient])
    expect(payload.subject).toBe('رسالة جديدة من نموذج التواصل')
    expect(payload.text).toContain(marker)
    // D31: the notice is the owner's inbox; Reply answers the visitor.
    expect(payload.reply_to).toBe(row.visitor)

    const run = (
      await postgres.query<{ status: string; detail: Record<string, number> }>(
        "select status, detail from finance.job_runs where job = 'email_outbox' order by id desc limit 1",
      )
    ).rows[0]!
    expect(run.status).toBe('ok')
    expect(run.detail).toMatchObject({ claimed: 1, accepted: 1 })
  })

  it('retry: 5xx leaves the row pending with a backed-off next attempt', async () => {
    await parkOthers()
    const row = await pendingNotice('retry', 'رسالة إعادة')
    stubFetch(() => new Response(JSON.stringify({ name: 'application_error' }), { status: 500 }))
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, retry: 1 })
    const state = (
      await postgres.query<{ status: string; next_at: Date; last_error: string }>(
        'select status, next_at, last_error from finance.email_outbox where id = $1',
        [row.id],
      )
    ).rows[0]!
    expect(state.status).toBe('pending')
    expect(state.last_error).toBe('HTTP_500')
    expect(state.next_at.getTime()).toBeGreaterThan(Date.now())
  })

  it('quota: a 429 daily_quota_exceeded stops the run, gives the attempt back and waits for the next UTC day (S04.2)', async () => {
    await parkOthers()
    const first = await pendingNotice('quota-a', 'رسالة أولى')
    const second = await pendingNotice('quota-b', 'رسالة ثانية')
    const { fn } = stubFetch(() => new Response(JSON.stringify({ name: 'daily_quota_exceeded' }), { status: 429 }))
    const summary = await runOutbox(rpc)
    // One send tried, the run stopped: the second row was never claimed.
    expect(fn).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, retry: 1 })
    const rows = (
      await postgres.query<{ id: string; status: string; attempts: number; last_error: string | null; waits: boolean }>(
        `select id, status, attempts, last_error, next_at = date_trunc('day', now(), 'UTC') + interval '1 day' as waits
           from finance.email_outbox where id = any($1)`,
        [[first.id, second.id]],
      )
    ).rows
    const tried = rows.filter((row) => row.attempts === 0 && row.last_error === 'QUOTA')
    expect(tried).toHaveLength(1)
    expect(tried[0]).toMatchObject({ status: 'pending', waits: true })
    expect(rows.filter((row) => row !== tried[0]).map((row) => row.status)).toEqual(['pending'])
  })

  it('permanent: a 4xx exhausts the row now', async () => {
    await parkOthers()
    const row = await pendingNotice('permanent', 'رسالة فاشلة')
    stubFetch(() => new Response(JSON.stringify({ name: 'validation_error' }), { status: 400 }))
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, permanent: 1 })
    expect(
      (await postgres.query<{ status: string }>('select status from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .status,
    ).toBe('exhausted')
  })

  it('uncertain: a network failure after the request left keeps the row reconcilable', async () => {
    await parkOthers()
    const row = await pendingNotice('uncertain', 'رسالة غير مؤكدة')
    stubFetch(() => {
      throw new Error('network down')
    })
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, uncertain: 1 })
    expect(
      (await postgres.query<{ status: string }>('select status from finance.email_outbox where id = $1', [row.id])).rows[0]!
        .status,
    ).toBe('uncertain')
  })

  it('not configured: nothing is claimed, the run is recorded as skipped', async () => {
    await parkOthers()
    await pendingNotice('unconfigured', 'رسالة بلا مزوّد')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_DEV_MAILPIT_URL', '')
    vi.stubEnv('EMAIL_FROM', '')
    const { fn } = stubFetch(() => new Response('{}', { status: 200 }))
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'skipped', claimed: 0, reason: 'EMAIL_NOT_CONFIGURED' })
    expect(fn).not.toHaveBeenCalled()
    const run = (
      await postgres.query<{ status: string; detail: Record<string, unknown> }>(
        "select status, detail from finance.job_runs where job = 'email_outbox' order by id desc limit 1",
      )
    ).rows[0]!
    expect(run.status).toBe('skipped')
    expect(run.detail).toMatchObject({ reason: 'EMAIL_NOT_CONFIGURED' })
  })

  it('a suppressed buyer address is never sent; a contact notice to a suppressed staff address still goes: staff mail is never held back by the list', async () => {
    await parkOthers()
    // A buyer's mail (a receipt) to an address on the list: suppressed before it is ever claimed or rendered.
    const buyer = `${unique('suppressed-buyer')}@example.com`
    const receipt = await postgres.query<{ id: string }>(
      `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload) values ($1, 'receipt', 0, $2, '{}'::jsonb) returning id`,
      [unique('suppressed-receipt'), buyer],
    )
    created.outbox.push(receipt.rows[0]!.id)
    created.suppressions.push(hashOf(buyer))
    await postgres.query("insert into finance.email_suppressions (recipient_hash, reason) values ($1, 'manual')", [hashOf(buyer)])
    // An operations member whose own address is on the list (a past bounce): the notice is theirs, and it goes.
    const row = await pendingNotice('suppressed', 'رسالة إلى عنوان في القائمة')
    await postgres.query("insert into finance.email_suppressions (recipient_hash, reason) values ($1, 'manual')", [
      hashOf(row.recipient),
    ])
    const { fn, calls } = stubFetch(() => new Response(JSON.stringify({ id: 'prov-suppressed-staff' }), { status: 200 }))
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ claimed: 1, accepted: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect((JSON.parse(String(calls[0]!.init.body)) as { to: string[] }).to).toEqual([row.recipient])
    const statusOf = async (id: string): Promise<string> =>
      (await postgres.query<{ status: string }>('select status from finance.email_outbox where id = $1', [id])).rows[0]!.status
    expect(await statusOf(receipt.rows[0]!.id)).toBe('suppressed')
    expect(await statusOf(row.id)).toBe('sent')
  })
})
