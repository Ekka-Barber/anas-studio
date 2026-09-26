// P06: the Svix verification used by the `resend-webhook` Edge Function,
// tested on its own (`_shared/email.ts` `verifySvixSignature`), then the handler
// itself for the bounce-type contract — a missing or `Permanent` bounce
// suppresses, a `Temporary` bounce is recorded only (Resend's real values per
// artifacts/acceptance/P06/source-resend-bounced.md: `data.to` is an array,
// `bounce = { message, subType, type }` with type "Permanent"/"Temporary") —
// and for recording, then acknowledging — never rejecting — a signed payload
// it cannot use. Signature scheme per
// resend.com/docs/dashboard/webhooks/verify-webhooks-requests and
// docs.svix.com/receiving/verifying-payloads/how-manual (fetched 2026-09-26):
// HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${rawBody}` with the base64
// after `whsec_`, compared constant-time against any `v1,<sig>` entry.
import { createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { verifySvixSignature } from '../../supabase/functions/_shared/email.ts'
import { handleResendWebhook } from '../../supabase/functions/_shared/resend-webhook.ts'

// The database is a recorder (a unit test must never reach a real one;
// `failNext` makes the next call throw). Each call is recorded as its
// arguments in order — the `email_event_record` parameters — with objects as
// JSON, the way the Data API sends them.
const recorded = { queries: [] as unknown[][], failNext: false }
const recorderRpc: Rpc = async (_fn, args) => {
  if (recorded.failNext) {
    recorded.failNext = false
    throw new Error('database unavailable')
  }
  recorded.queries.push(
    Object.values(args).map((value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : value)),
  )
  return null
}
const webhookPost = (request: Request) => handleResendWebhook(request, recorderRpc)

const SECRET_RAW = 'anas-studio-local-webhook-secret-p06'
const SECRET = `whsec_${Buffer.from(SECRET_RAW).toString('base64')}`

const RAW_BODY = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-09-26T10:00:00Z',
  data: { email_id: 'msg-1', to: ['staff@example.com'] },
})

function sign(svixId: string, timestamp: number, rawBody: string, secretRaw = SECRET_RAW): string {
  // The key is the base64 part after whsec_; decoding it here mirrors what
  // the verifier does with the configured secret.
  const key = Buffer.from(Buffer.from(secretRaw, 'utf8').toString('base64'), 'base64')
  return createHmac('sha256', key).update(`${svixId}.${timestamp}.${rawBody}`).digest('base64')
}

function headers(svixId: string, timestampMs: number, signatures: string[], rawBody = RAW_BODY, secretRaw = SECRET_RAW) {
  const timestamp = Math.floor(timestampMs / 1000)
  return {
    secret: SECRET,
    svixId,
    timestamp: String(timestamp),
    signatureHeader: signatures.map((sig) => `v1,${sign(svixId, timestamp, rawBody, secretRaw)}`).join(' ') || 'v1,AAAA',
    rawBody,
    now: new Date(),
  }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...savedEnv }
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  recorded.queries.length = 0
  recorded.failNext = false
})

afterEach(() => {
  process.env = savedEnv
})

/** A webhook Request signed with the real secret (the route verifies it for real). */
function webhookRequest(
  rawBody: string,
  svixId = `evt_${randomUUID()}`,
  secretRaw = SECRET_RAW,
  extraHeaders: Record<string, string> = {},
): Request {
  const timestamp = Math.floor(Date.now() / 1000)
  return new Request('http://127.0.0.1:54321/functions/v1/resend-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${sign(svixId, timestamp, rawBody, secretRaw)}`,
      ...extraHeaders,
    },
    body: rawBody,
  })
}

/** A signed `email.bounced` body; `bounce` omitted when undefined. `data.to`
 * is an array and `type`/`subType` carry Resend's real vocabulary. */
function bounceBody(bounce?: { type?: string; subType?: string }): string {
  return JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-09-26T10:00:00Z',
    data: { email_id: 'msg-bounce', to: ['staff@example.com'], ...(bounce === undefined ? {} : { bounce }) },
  })
}

describe('verifySvixSignature', () => {
  it('accepts a valid signature', async () => {
    const params = headers('evt_1', Date.now(), ['good'])
    expect(await verifySvixSignature(params)).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const params = headers('evt_2', Date.now(), ['good'])
    expect(await verifySvixSignature({ ...params, rawBody: RAW_BODY.replace('msg-1', 'msg-9') })).toBe(false)
  })

  it('rejects a signature made with the wrong secret', async () => {
    const params = headers('evt_3', Date.now(), ['good'], RAW_BODY, 'a-completely-different-secret')
    expect(await verifySvixSignature({ ...params, secret: SECRET })).toBe(false)
  })

  it('rejects a stale timestamp (outside the 5-minute tolerance)', async () => {
    const params = headers('evt_4', Date.now() - 6 * 60 * 1000, ['good'])
    expect(await verifySvixSignature(params)).toBe(false)
  })

  it('rejects a future timestamp', async () => {
    const params = headers('evt_5', Date.now() + 6 * 60 * 1000, ['good'])
    expect(await verifySvixSignature(params)).toBe(false)
  })

  it('accepts when only one of several signatures is valid', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const good = sign('evt_6', timestamp, RAW_BODY)
    const params = {
      secret: SECRET,
      svixId: 'evt_6',
      timestamp: String(timestamp),
      signatureHeader: `v1,${Buffer.from('not the signature').toString('base64')} v1,${good}`,
      rawBody: RAW_BODY,
    }
    expect(await verifySvixSignature(params)).toBe(true)
  })

  it('rejects a header with no valid v1 entry', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const params = {
      secret: SECRET,
      svixId: 'evt_7',
      timestamp: String(timestamp),
      signatureHeader: 'v2,somethingelse',
      rawBody: RAW_BODY,
    }
    expect(await verifySvixSignature(params)).toBe(false)
  })

  it('rejects a non-numeric timestamp', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const params = {
      secret: SECRET,
      svixId: 'evt_8',
      timestamp: 'not-a-number',
      signatureHeader: `v1,${sign('evt_8', timestamp, RAW_BODY)}`,
      rawBody: RAW_BODY,
    }
    expect(await verifySvixSignature(params)).toBe(false)
  })
})

describe('webhook route (POST)', () => {
  it('passes a Permanent bounce through for suppression', async () => {
    const svixId = `evt_${randomUUID()}`
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'Permanent', subType: 'Suppressed' }), svixId))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // The call reaches email_event_record with the provider's event id and
    // the bounce type as its own argument; the SQL suppresses on it.
    expect(recorded.queries).toHaveLength(1)
    const params = recorded.queries[0]!
    expect(params[0]).toBe(svixId)
    expect(params[1]).toBe('email.bounced')
    expect(params[6]).toBe('Permanent')
  })

  it('records a Temporary bounce without suppressing it', async () => {
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'Temporary', subType: 'MessageRejected' })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // The temporary type travels the same path — email_event_record records
    // the event and suppresses only a missing or Permanent type.
    expect(recorded.queries).toHaveLength(1)
    expect(recorded.queries[0]![6]).toBe('Temporary')
  })

  it('treats a bounce with no type as suppressible', async () => {
    const noObject = await webhookPost(webhookRequest(bounceBody()))
    expect(noObject.status).toBe(200)
    expect(await noObject.json()).toEqual({ ok: true })
    expect(recorded.queries[0]![6]).toBeNull()

    recorded.queries.length = 0
    const noField = await webhookPost(webhookRequest(bounceBody({ subType: 'Suppressed' })))
    expect(noField.status).toBe(200)
    expect(recorded.queries[0]![6]).toBeNull()
  })

  it('records and acknowledges a signed but unparseable body', async () => {
    const rawBody = 'not json at all {'
    const svixId = `evt_${randomUUID()}`
    const response = await webhookPost(webhookRequest(rawBody, svixId))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // Nothing parsed, so the record falls back to the Svix id and an unknown
    // type with no recipient — and evidence that carries only the body size.
    expect(recorded.queries).toHaveLength(1)
    const params = recorded.queries[0]!
    expect(params[0]).toBe(svixId)
    expect(params[1]).toBe('email.unknown')
    expect(params[2]).toBeNull()
    expect(params[3]).toBeNull()
    expect(params[6]).toBeNull()
    expect(JSON.parse(params[5] as string)).toEqual({
      malformed: true,
      bytes: new TextEncoder().encode(rawBody).length,
    })
  })

  it('records what it can of a signed event with an unrecognized shape', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_salvaged',
      type: 'email.bounced',
      created_at: '2026-09-26T10:00:00Z',
      data: { email_id: 'msg-bounce', to: 'not-an-array', bounce: { type: 'Permanent', subType: 'Suppressed' } },
    })
    const svixId = `evt_${randomUUID()}`
    const response = await webhookPost(webhookRequest(rawBody, svixId))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // The Svix id stays the dedupe key (the normal path's key, so one
    // delivery can never be recorded under two ids), the non-array `to`
    // yields no recipient, the time is normalized to ISO, and the bounce type
    // still travels as its own argument.
    expect(recorded.queries).toHaveLength(1)
    const params = recorded.queries[0]!
    expect(params[0]).toBe(svixId)
    expect(params[1]).toBe('email.bounced')
    expect(params[2]).toBe('msg-bounce')
    expect(params[3]).toBeNull()
    expect(params[4]).toBe('2026-09-26T10:00:00.000Z')
    expect(params[6]).toBe('Permanent')
    expect(JSON.parse(params[5] as string)).toEqual({
      malformed: true,
      bytes: new TextEncoder().encode(rawBody).length,
    })
  })

  it('records a signed body past 32 KiB as malformed and never rejects it', async () => {
    const rawBody = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-09-26T10:00:00Z',
      data: { email_id: 'msg-1', to: ['staff@example.com'] },
      pad: 'x'.repeat(33_000),
    })
    const response = await webhookPost(webhookRequest(rawBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // Past the signature the size limit is never a 4xx; whatever parsed is
    // salvaged into a malformed record instead of being dropped.
    expect(recorded.queries).toHaveLength(1)
    const params = recorded.queries[0]!
    expect(params[1]).toBe('email.delivered')
    expect(params[3]).toBe('staff@example.com')
    expect(JSON.parse(params[5] as string)).toEqual({
      malformed: true,
      bytes: new TextEncoder().encode(rawBody).length,
    })
  })

  it('refuses a request that declares more than 256 KiB before reading it', async () => {
    const response = await webhookPost(
      webhookRequest(RAW_BODY, `evt_${randomUUID()}`, SECRET_RAW, { 'content-length': String(262_145) }),
    )
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TOO_LARGE')
    expect(recorded.queries).toHaveLength(0)
  })

  it('asks Svix to retry when a malformed event cannot be recorded', async () => {
    // Every value the malformed record passes is bounded, so a failure there
    // is the database, not the event: a 503 redelivers the same bytes later
    // instead of silently losing a bounce.
    recorded.failNext = true
    const response = await webhookPost(webhookRequest('not json at all {'))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAVAILABLE')
    expect(recorded.queries).toHaveLength(0)
  })

  it('passes only a timestamp Postgres accepts: ISO, or null when unusable', async () => {
    // `Date.parse('1')` is a date to JavaScript but not to timestamptz, and a
    // year past 9999 serializes in a form Postgres refuses — either would fail
    // every redelivery of the same event. Zone-naive ISO inputs are pinned to
    // UTC by the route, so these expectations hold on any machine timezone.
    const cases: Array<[string, string | null | 'iso']> = [
      ['2026-09-26T10:00:00Z', '2026-09-26T10:00:00.000Z'],
      ['2026-09-26T10:00:00', '2026-09-26T10:00:00.000Z'],
      ['Sat, 26 Sep 2026 10:00:00 GMT', '2026-09-26T10:00:00.000Z'],
      // '1' parses implementation-defined, machine-local — garbage in, so only
      // the Postgres-safe shape is asserted, never the exact instant.
      ['1', 'iso'],
      ['not a date', null],
      ['+275760-09-13T00:00:00Z', null],
    ]
    for (const [createdAt, expected] of cases) {
      recorded.queries.length = 0
      const rawBody = JSON.stringify({ type: 'email.delivered', created_at: createdAt, data: { email_id: 'msg-t', to: ['a@example.com'] } })
      const response = await webhookPost(webhookRequest(rawBody))
      expect(response.status).toBe(200)
      const stored = recorded.queries[0]![4] as string | null
      if (expected === 'iso') expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      else expect(stored).toBe(expected)
    }
  })

  it('asks Svix to retry when a well-formed event cannot be recorded', async () => {
    recorded.failNext = true
    const response = await webhookPost(webhookRequest(RAW_BODY))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAVAILABLE')
  })

  it('still refuses a forged signature with 401', async () => {
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'Permanent' }), `evt_${randomUUID()}`, 'wrong'))
    expect(response.status).toBe(401)
    expect(recorded.queries).toHaveLength(0)
  })
})
