// P06: the Svix verification used by `/api/email/resend/webhook`, tested on
// its own (`src/lib/email.ts` `verifySvixSignature`), then the route handler
// itself for the bounce-type contract (a missing or hard/permanent bounce
// suppresses; a soft bounce is recorded only) and for acknowledging — never
// rejecting — a signed payload it cannot use. Signature scheme per
// resend.com/docs/dashboard/webhooks/verify-webhooks-requests and
// docs.svix.com/receiving/verifying-payloads/how-manual (fetched 2026-09-26):
// HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${rawBody}` with the base64
// after `whsec_`, compared constant-time against any `v1,<sig>` entry.
import { createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifySvixSignature } from '../../src/lib/email'
import { POST as webhookPost } from '../../src/app/api/email/resend/webhook/route'

// The route handler is imported above, but vitest resolves no `@/` alias, so
// every `@/lib/*` specifier the route imports is mocked here: the database
// with a recorder (a unit test must never reach a real one) and the rest with
// the real modules via `vi.importActual`.
const recorded = vi.hoisted(() => ({ queries: [] as unknown[][] }))
vi.mock('@/lib/db', () => ({
  withDb: (run: (client: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
    run({
      query: async (_sql: string, params: unknown[]) => {
        recorded.queries.push(params)
        return { rows: [] }
      },
    }),
}))
vi.mock('@/lib/env', async () => vi.importActual('../../src/lib/env'))
vi.mock('@/lib/email', async () => vi.importActual('../../src/lib/email'))

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
})

afterEach(() => {
  process.env = savedEnv
})

/** A webhook Request signed with the real secret (the route verifies it for real). */
function webhookRequest(rawBody: string, svixId = `evt_${randomUUID()}`, secretRaw = SECRET_RAW): Request {
  const timestamp = Math.floor(Date.now() / 1000)
  return new Request('http://localhost/api/email/resend/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${sign(svixId, timestamp, rawBody, secretRaw)}`,
    },
    body: rawBody,
  })
}

/** A signed `email.bounced` body; `bounce` omitted when undefined. */
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
  it('passes a hard bounce through for suppression', async () => {
    const svixId = `evt_${randomUUID()}`
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'hard', subType: 'generic' }), svixId))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // The call reaches email_event_record with the provider's event id and
    // the bounce type as its own argument; the SQL suppresses on it.
    expect(recorded.queries).toHaveLength(1)
    const params = recorded.queries[0]!
    expect(params[0]).toBe(svixId)
    expect(params[1]).toBe('email.bounced')
    expect(params[6]).toBe('hard')
  })

  it('records a soft bounce without suppressing it', async () => {
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'soft', subType: 'dns' })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // The soft type travels the same path — email_event_record records the
    // event and suppresses only a missing or hard/permanent type.
    expect(recorded.queries).toHaveLength(1)
    expect(recorded.queries[0]![6]).toBe('soft')
  })

  it('treats a bounce with no type as suppressible', async () => {
    const noObject = await webhookPost(webhookRequest(bounceBody()))
    expect(noObject.status).toBe(200)
    expect(await noObject.json()).toEqual({ ok: true })
    expect(recorded.queries[0]![6]).toBeNull()

    recorded.queries.length = 0
    const noField = await webhookPost(webhookRequest(bounceBody({ subType: 'generic' })))
    expect(noField.status).toBe(200)
    expect(recorded.queries[0]![6]).toBeNull()
  })

  it('acknowledges a signed but unparseable body and records nothing', async () => {
    const response = await webhookPost(webhookRequest('not json at all {'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ignored: true })
    expect(recorded.queries).toHaveLength(0)
  })

  it('acknowledges a signed event with an unrecognized shape and records nothing', async () => {
    const response = await webhookPost(webhookRequest(JSON.stringify({ unrelated: true })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ignored: true })
    expect(recorded.queries).toHaveLength(0)
  })

  it('still refuses a forged signature with 401', async () => {
    const response = await webhookPost(webhookRequest(bounceBody({ type: 'hard' }), `evt_${randomUUID()}`, 'wrong'))
    expect(response.status).toBe(401)
    expect(recorded.queries).toHaveLength(0)
  })
})
