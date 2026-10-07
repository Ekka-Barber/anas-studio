// P08 round 9: the owner's `dispute-record` and the commerce part of `stats` through the REAL local `admin` Edge
// Function (Docker). Every staff member is real with a real session: the owner who records a dispute is at aal2 with a
// fresh TOTP, enrolled and verified exactly as staff-admin.test.ts does (`stepUp`); an owner who never verified one, an
// operations member and an editor are refused. The order is created by SQL (`checkout_create`) and paid through
// `apply_verified_payment` (the shared fixtures of `support.ts`): a dispute is recorded by hand from Moyasar's emails, so
// nothing here reaches Moyasar and no emulator is needed; the function only needs its payment settings to know the mode.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved and restored by the fixtures.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { handleAdmin } from '../../supabase/functions/_shared/admin.ts'

import { commerceHarness, type Harness, type Paid, type Row, signIn, status, stepUp } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const FUNCTIONS_URL = status.FUNCTIONS_URL
const PEPPER = `disputes-http-pepper-${randomUUID()}`
const PREFIX = `p08r9-http-${Date.now()}-${process.pid}-`
const HOUR = 3_600_000
const DAY = 86_400_000
/** The calendar day in Riyadh (UTC+3), `daysAgo` days back. */
const riyadh = (daysAgo = 0): string => new Date(Date.now() + 3 * HOUR - daysAgo * DAY).toISOString().slice(0, 10)

let h: Harness
let fresh: SupabaseClient
let stale: SupabaseClient
let operations: SupabaseClient
let editor: SupabaseClient
let counter = 0
const ref = (label: string): string => `${PREFIX}${label}-${(counter += 1)}`

beforeAll(async () => {
  h = await commerceHarness(PEPPER, 2)
  // One owner at aal2 (a TOTP verified just now), one who never verified a TOTP, an operations member and an editor.
  fresh = await signIn((await h.makeStaff('owner')).email)
  await stepUp(fresh)
  stale = await signIn((await h.makeStaff('owner')).email)
  operations = await signIn((await h.makeStaff('operations')).email)
  editor = await signIn((await h.makeStaff('editor')).email)
})

afterAll(async () => {
  await h.stop()
})

/** Calls the admin function as `caller`: a signed-in client, a raw access token, or no one (the publishable key only). */
async function adminCall(caller: SupabaseClient | string | null, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: status.PUBLISHABLE_KEY }
  const token = typeof caller === 'string' ? caller : caller ? (await caller.auth.getSession()).data.session!.access_token : null
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${FUNCTIONS_URL}/admin`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

const record = (p: Paid, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'dispute-record',
  kind: 'chargeback',
  providerRef: ref('CB'),
  follows: 0,
  attemptId: p.attemptId,
  amount: 4500,
  direction: 'against_seller',
  occurredOn: riyadh(2),
  reason: 'اعتراض تجريبي من حامل البطاقة',
  decision: 'none',
  ...over,
})
const rowsOf = (providerRef: string): Promise<Row[]> => h.rows('select * from finance.disputes where provider_ref = $1 order by seq', [providerRef])
const disputeCount = (): Promise<number> => h.count('select count(*)::int as n from finance.disputes')
const commerceOf = async (): Promise<any> => {
  const reply = await adminCall(fresh, { action: 'stats' })
  expect(reply.status, JSON.stringify(reply.body)).toBe(200)
  return reply.body.data.commerce
}

describe('dispute-record and stats through the real admin function', () => {
  it('records a synthetic chargeback, answers a repeat as the same row, takes its follow-up, and the statistics count it beside an unchanged gross', async () => {
    const p = await h.paid([{ variantId: await h.digital(3500), quantity: 1 }])
    const before = await commerceOf()
    expect(before).toMatchObject({ environment: 'test' })
    expect(before.paidOrders).toBeGreaterThanOrEqual(1)
    expect(before.grossPaid).toBeGreaterThanOrEqual(p.total)

    const providerRef = ref('CB')
    const opened = await adminCall(fresh, record(p, { providerRef }))
    expect(opened.status, JSON.stringify(opened.body)).toBe(201)
    expect(opened.body).toEqual({
      ok: true,
      data: {
        duplicate: false,
        dispute: {
          id: expect.any(String),
          kind: 'chargeback',
          providerRef,
          seq: 1,
          attemptId: p.attemptId,
          reviewPaymentId: null,
          environment: 'test',
          amount: 4500,
          direction: 'against_seller',
          occurredOn: riyadh(2),
          reason: 'اعتراض تجريبي من حامل البطاقة',
          resolution: null,
          decision: 'none',
          itemIds: [],
          createdAt: expect.any(String),
        },
      },
    })
    expect(await rowsOf(providerRef)).toHaveLength(1)

    // The same reconciliation again: the stored row, once.
    const repeated = await adminCall(fresh, record(p, { providerRef }))
    expect(repeated.status).toBe(200)
    expect(repeated.body.data).toEqual({ duplicate: true, dispute: opened.body.data.dispute })
    expect(await rowsOf(providerRef)).toHaveLength(1)
    expect(await h.count("select count(*)::int as n from public.audit_events where action = 'dispute.recorded' and entity_id = $1", [opened.body.data.dispute.id])).toBe(1)

    // Counted while open: against the seller.
    const open = await commerceOf()
    expect(open.disputes).toEqual({
      count: before.disputes.count + 1,
      againstSeller: before.disputes.againstSeller + 4500,
      forSeller: before.disputes.forSeller,
    })

    // Its outcome is the next row of the same reference: it follows seq 1, and the dispute is the same one, now for the seller.
    const won = await adminCall(fresh, record(p, { providerRef, follows: 1, direction: 'for_seller', resolution: 'ربحنا النزاع', occurredOn: riyadh(1) }))
    expect(won.status, JSON.stringify(won.body)).toBe(201)
    expect(won.body.data).toMatchObject({ duplicate: false, dispute: { seq: 2, direction: 'for_seller', resolution: 'ربحنا النزاع' } })
    expect((await rowsOf(providerRef)).map((entry) => entry.seq)).toEqual([1, 2])
    const again = await adminCall(fresh, record(p, { providerRef, follows: 1, direction: 'for_seller', resolution: 'ربحنا النزاع', occurredOn: riyadh(1) }))
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ duplicate: true, dispute: { id: won.body.data.dispute.id } })
    expect(await rowsOf(providerRef)).toHaveLength(2)

    // The latest row is the current state, and the money is as it was: the dispute is in no refund, no net, no gross.
    const closed = await commerceOf()
    expect(closed.disputes).toEqual({
      count: before.disputes.count + 1,
      againstSeller: before.disputes.againstSeller,
      forSeller: before.disputes.forSeller + 4500,
    })
    expect({ ...closed, disputes: 0 }).toEqual({ ...before, disputes: 0 })
    expect(await h.count('select count(*)::int as n from finance.refunds where order_id = $1', [p.id])).toBe(0)
    expect((await h.row('select status from finance.orders where id = $1', [p.id])).status).toBe('paid')
  })

  it('revokes the named entitlement of a digital order, and refuses what does not fit with a stable code', async () => {
    const digital = await h.digital(3000)
    const printed = await h.physical(4000, 50)
    const p = await h.paid([{ variantId: digital, quantity: 1 }, { variantId: printed, quantity: 1 }])
    const book = p.items.find((item) => item.variantId === digital)!.id
    const print = p.items.find((item) => item.variantId === printed)!.id
    const revoked = await adminCall(fresh, record(p, { decision: 'entitlement_revoked', itemIds: [book] }))
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(201)
    expect(revoked.body.data.dispute).toMatchObject({ decision: 'entitlement_revoked', itemIds: [book] })
    expect((await h.row('select revoked_at is not null as revoked, revoke_reason from finance.entitlements where order_item_id = $1', [book]))).toEqual({
      revoked: true,
      revoke_reason: 'dispute',
    })
    // A printed item has no entitlement to revoke; an unknown attempt is not found; a follow-up needs its predecessor.
    const wrongItem = await adminCall(fresh, record(p, { decision: 'entitlement_revoked', itemIds: [print] }))
    expect(wrongItem).toMatchObject({ status: 422, body: { ok: false, error: { code: 'INVALID_ITEMS' } } })
    const unknown = await adminCall(fresh, record(p, { attemptId: randomUUID() }))
    expect(unknown).toMatchObject({ status: 404, body: { ok: false, error: { code: 'NOT_FOUND' } } })
    const noPredecessor = await adminCall(fresh, record(p, { follows: 1 }))
    expect(noPredecessor).toMatchObject({ status: 409, body: { ok: false, error: { code: 'NO_PREDECESSOR' } } })
    for (const reply of [wrongItem, unknown, noPredecessor]) expect(reply.body.error.message).toMatch(/[؀-ۿ]/)
    // The request is validated before the database: a date in the future, a chargeback with no target.
    const tomorrow = await adminCall(fresh, record(p, { occurredOn: new Date(Date.now() + 3 * HOUR + DAY).toISOString().slice(0, 10) }))
    expect(tomorrow).toMatchObject({ status: 422, body: { error: { code: 'INVALID' } } })
    const noTarget = await adminCall(fresh, record(p, { attemptId: undefined }))
    expect(noTarget).toMatchObject({ status: 422, body: { error: { code: 'INVALID' } } })
  })

  it('refuses everyone but an owner with a fresh TOTP, before anything is read, and writes nothing', async () => {
    const p = await h.paid([{ variantId: await h.digital(2500), quantity: 1 }])
    const providerRef = ref('DENIED')
    const before = await disputeCount()
    for (const [who, client] of [['operations', operations], ['an editor', editor]] as Array<[string, SupabaseClient]>) {
      const refused = await adminCall(client, record(p, { providerRef }))
      expect(refused.status, who).toBe(403)
      expect(refused.body, who).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    // An owner whose TOTP is not fresh is told to step up, even with a body that would be refused for another reason.
    for (const body of [record(p, { providerRef }), { action: 'dispute-record' }, record(p, { amount: -5 })]) {
      const refused = await adminCall(stale, body)
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED' } })
    }
    // No session at all: the function's own answer (the gateway lets the publishable key through).
    expect(await adminCall(null, record(p, { providerRef }))).toMatchObject({ status: 401, body: { ok: false, error: { code: 'UNAUTHENTICATED' } } })
    expect(await rowsOf(providerRef)).toHaveLength(0)
    expect(await disputeCount()).toBe(before)

    // An owner revoked a moment ago, with a session that is still valid, is refused at once.
    const revoked = await h.makeStaff('owner')
    const session = await signIn(revoked.email)
    await stepUp(session)
    await h.postgres.query('update public.staff set active = false where user_id = $1', [revoked.userId])
    expect((await adminCall(session, record(p, { providerRef }))).status).toBe(403)
    expect(await rowsOf(providerRef)).toHaveLength(0)
  })

  it('stats answers the commerce figures for an explicit range, refuses a range that is not valid, and stays the owner\'s alone', async () => {
    const day = (n: number): string => new Date(Date.now() - n * DAY).toISOString()
    const ranged = await adminCall(fresh, { action: 'stats', from: day(7), to: day(0) })
    expect(ranged.status, JSON.stringify(ranged.body)).toBe(200)
    expect(Object.keys(ranged.body.data.commerce).sort()).toEqual(
      ['customers', 'disputes', 'environment', 'grossPaid', 'netCollected', 'paidOrders', 'refundsConfirmed', 'review'].sort(),
    )
    expect(ranged.body.data.commerce.environment).toBe('test')
    expect(ranged.body.data.analytics).toBeDefined()
    // The old placeholder is gone.
    expect(ranged.body.data.commerce.status).toBeUndefined()
    // A week of the last seven days is inside the default 30: never more than it.
    const month = await commerceOf()
    expect(ranged.body.data.commerce.grossPaid).toBeLessThanOrEqual(month.grossPaid)
    for (const body of [
      { from: day(0), to: day(7) },
      { from: day(400), to: day(0) },
      { from: '2026-01-01', to: '2026-02-01' },
      { from: 'last month' },
      { limit: 5 },
    ]) {
      const refused = await adminCall(fresh, { action: 'stats', ...body })
      expect(refused.status, JSON.stringify(body)).toBe(422)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    }
    for (const client of [operations, editor]) expect((await adminCall(client, { action: 'stats' })).status).toBe(403)
    expect(await adminCall(null, { action: 'stats' })).toMatchObject({ status: 401, body: { ok: false, error: { code: 'UNAUTHENTICATED' } } })
  })

  // FABLE-AUDIT T-8 (TEST-DB-07): the step-up is read from the token's claims (aal, amr), so a token whose payload was
  // edited, or one that another key signed, must never pass for a real one. Both are refused by the gateway
  // (verify_jwt) and, without it, by the handler's own staff check (getClaims, called in process here), and nothing is
  // written.
  it('a token whose claims were edited to a fresh TOTP, or that another key signed, is 401 and writes nothing', async () => {
    const p = await h.paid([{ variantId: await h.digital(2500), quantity: 1 }])
    const providerRef = ref('FORGED')
    const before = await disputeCount()
    // A real owner at aal1: the step-up is all that stands between this session and a write.
    const owner = await signIn((await h.makeStaff('owner')).email)
    expect(await adminCall(owner, record(p, { providerRef }))).toMatchObject({ status: 403, body: { error: { code: 'STEP_UP_REQUIRED' } } })

    const [header, payload, signature] = (await owner.auth.getSession()).data.session!.access_token.split('.')
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    const raised = Buffer.from(JSON.stringify({ ...claims, aal: 'aal2', amr: [{ method: 'totp', timestamp: now }, ...(claims.amr ?? [])] })).toString('base64url')
    const hs256 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const forgeries = {
      'the payload edited, the old signature kept': `${header}.${raised}.${signature}`,
      'signed with another key': `${hs256}.${raised}.${createHmac('sha256', randomBytes(32)).update(`${hs256}.${raised}`).digest('base64url')}`,
    }
    vi.stubEnv('SUPABASE_URL', status.API_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.SECRET_KEY)
    try {
      for (const [label, token] of Object.entries(forgeries)) {
        expect((await adminCall(token, record(p, { providerRef }))).status, label).toBe(401)
        const direct = await handleAdmin(
          new Request(`${FUNCTIONS_URL}/admin`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(record(p, { providerRef })),
          }),
        )
        expect(direct.status, label).toBe(401)
        expect(await direct.json(), label).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
      }
    } finally {
      vi.unstubAllEnvs()
    }
    expect(await rowsOf(providerRef)).toHaveLength(0)
    expect(await disputeCount()).toBe(before)
  })
})
