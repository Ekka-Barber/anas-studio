// P06: the Svix verification used by `/api/email/resend/webhook`, tested on
// its own (`src/lib/email.ts` `verifySvixSignature`). Signature scheme per
// resend.com/docs/dashboard/webhooks/verify-webhooks-requests and
// docs.svix.com/receiving/verifying-payloads/how-manual (fetched 2026-09-26):
// HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${rawBody}` with the base64
// after `whsec_`, compared constant-time against any `v1,<sig>` entry.
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { verifySvixSignature } from '../../src/lib/email'

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
