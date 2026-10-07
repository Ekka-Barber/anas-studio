// P06 round 3, step 4: the privacy request functions (I31) and contact
// retention (D36). The grants are read straight from the catalog; the
// functions themselves run as the local superuser — no role has execute,
// which is the point — and only on staff and contacts this file creates.
// Everything that would persist (contacts, outbox rows, the audit rows for
// them) runs inside a transaction that is rolled back, so the shared local
// database is left as it was. The one erased member stays erased: that is
// the production shape (the append-only trail keeps the id, I31), and the
// account is inert.
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaff, settledWithin, signIn } from './support'

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

/** Runs `body` in a transaction that is always rolled back. */
async function rolledBack(body: () => Promise<void>): Promise<void> {
  await postgres.query('begin')
  try {
    await body()
  } finally {
    await postgres.query('rollback')
  }
}

/** Rows per `auth` table still referencing the user (refresh_tokens and the Auth log match on text). */
async function authRowCounts(userId: string): Promise<Record<string, number>> {
  const one = async (fragment: string): Promise<number> =>
    (await postgres.query<{ n: number }>(`select count(*)::int as n ${fragment}`, [userId])).rows[0]!.n
  return {
    flow_state: await one('from auth.flow_state where user_id = $1'),
    identities: await one('from auth.identities where user_id = $1'),
    mfa_factors: await one('from auth.mfa_factors where user_id = $1'),
    oauth_authorizations: await one('from auth.oauth_authorizations where user_id = $1'),
    oauth_consents: await one('from auth.oauth_consents where user_id = $1'),
    one_time_tokens: await one('from auth.one_time_tokens where user_id = $1'),
    refresh_tokens: await one('from auth.refresh_tokens where user_id = $1::text'),
    sessions: await one('from auth.sessions where user_id = $1'),
    webauthn_challenges: await one('from auth.webauthn_challenges where user_id = $1'),
    webauthn_credentials: await one('from auth.webauthn_credentials where user_id = $1'),
    audit_log_entries: await one("from auth.audit_log_entries where payload->>'actor_id' = $1::text"),
  }
}

async function insertContact(email: string): Promise<string> {
  const result = await postgres.query<{ id: string }>(
    "insert into public.contacts (name, email, message, submission_key) values ('زائر', $1, 'رسالة اختبار', gen_random_uuid()) returning id",
    [email],
  )
  return result.rows[0]!.id
}

/** One contact notice in the outbox, with a unique dedupe key. */
async function insertNotice(
  contactId: string,
  status: string,
  sentAt: string | null,
  delivery: string | null,
): Promise<void> {
  await postgres.query(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, delivery, sent_at)
     values ($1, 'contact_notice', 1, 'owner@example.com', $2::jsonb, $3, $4, $5)`,
    [`privacy-test-${contactId}-${status}-${delivery ?? 'none'}`, JSON.stringify({ contactId }), status, delivery, sentAt],
  )
}

const ERASE_FUNCTIONS = [
  'public.privacy_erase_staff(uuid)',
  'public.privacy_erase_contacts(uuid[])',
  'finance.contacts_purge()',
  // P08 round 9: the buyer's export and erase.
  'public.privacy_buyer_export(text)',
  'public.privacy_buyer_erase(text)',
  'finance.payment_events_purge()',
]

describe('grants (I31)', () => {
  it.each(ERASE_FUNCTIONS)('%s: no API role can execute it', async (signature) => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await canExecute(role, signature), `${role} ${signature}`).toBe(false)
    }
  })
})

describe('privacy_erase_staff', () => {
  it('refuses an active member and changes nothing', async () => {
    const member = await createStaff('editor')
    const before = await authRowCounts(member.userId)
    await expect(
      postgres.query('select public.privacy_erase_staff($1)', [member.userId]),
    ).rejects.toMatchObject({ code: '55000' })

    const user = (await postgres.query<{ email: string }>('select email from auth.users where id = $1', [member.userId])).rows[0]!
    expect(user.email).toBe(member.email)
    expect(await authRowCounts(member.userId)).toEqual(before)
    const staff = (
      await postgres.query<{ display_name: string; active: boolean }>(
        'select display_name, active from public.staff where user_id = $1',
        [member.userId],
      )
    ).rows[0]!
    expect(staff.display_name).toBe(member.email)
    expect(staff.active).toBe(true)
    expect(
      (await postgres.query<{ n: number }>(
        "select count(*)::int as n from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )).rows[0]!.n,
    ).toBe(0)
  })

  it('erases a revoked member: Auth tables emptied, earlier audit rows identical, staff renamed, repeat is a no-op', async () => {
    const member = await createStaff('editor')
    await signIn(member.email)
    await postgres.query(
      "insert into public.audit_events (actor, action, entity, entity_id, summary) values ($1, 'test.member', 'test', '1', '{}'::jsonb)",
      [member.userId],
    )
    // The revoke path leaves active = false; Auth also bans the user.
    await postgres.query('update public.staff set active = false where user_id = $1', [member.userId])

    const auditBefore = (
      await postgres.query<{ row: Record<string, unknown> }>(
        'select to_jsonb(a) as row from public.audit_events a where actor = $1 order by id',
        [member.userId],
      )
    ).rows.map((r) => r.row)
    expect(auditBefore.length).toBeGreaterThanOrEqual(1)

    const before = await authRowCounts(member.userId)
    expect(before.identities).toBeGreaterThanOrEqual(1)
    expect(before.sessions).toBeGreaterThanOrEqual(1)
    expect(before.refresh_tokens).toBeGreaterThanOrEqual(1)
    expect(before.audit_log_entries).toBeGreaterThanOrEqual(1)

    // Their address also sits where others acted on them (Auth's own log of
    // the account being created) and on notices addressed to them.
    const addressInAuthLog = async () =>
      (
        await postgres.query<{ n: number }>(
          "select count(*)::int as n from auth.audit_log_entries where payload::text ilike '%' || $1 || '%'",
          [member.email],
        )
      ).rows[0]!.n
    expect(await addressInAuthLog()).toBeGreaterThanOrEqual(1)
    const notice = (status: string) =>
      postgres.query(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at)
         values ($1, 'contact_notice', 1, $2, '{"contactId": null}'::jsonb, $3, case when $3 = 'sent' then now() end)`,
        [`privacy-staff-${member.userId}-${status}`, member.email.toLowerCase(), status],
      )
    await notice('sent')
    await notice('pending')

    await postgres.query('select public.privacy_erase_staff($1)', [member.userId])

    expect(await addressInAuthLog()).toBe(0)
    const outbox = (
      await postgres.query<{ status: string; recipient: string }>(
        "select status, recipient from finance.email_outbox where dedupe_key like 'privacy-staff-' || $1 || '-%' order by status",
        [member.userId],
      )
    ).rows
    // The unsent notice is dropped; the sent one keeps its history under the placeholder.
    expect(outbox).toEqual([{ status: 'sent', recipient: `erased-${member.userId}@erased.invalid` }])

    expect(await authRowCounts(member.userId)).toEqual(
      Object.fromEntries(Object.keys(before).map((table) => [table, 0])),
    )
    const user = (
      await postgres.query<{ email: string; phone: string | null; raw_user_meta_data: unknown }>(
        'select email, phone, raw_user_meta_data from auth.users where id = $1',
        [member.userId],
      )
    ).rows[0]!
    expect(user.email).toBe(`erased-${member.userId}@erased.invalid`)
    expect(user.phone).toBeNull()
    expect(user.raw_user_meta_data).toEqual({})
    expect(
      (await postgres.query<{ n: number }>('select count(*)::int as n from auth.users where email = $1', [member.email]))
        .rows[0]!.n,
    ).toBe(0)
    const staff = (
      await postgres.query<{ display_name: string }>('select display_name from public.staff where user_id = $1', [member.userId])
    ).rows[0]!
    expect(staff.display_name).toBe('موظف سابق')

    const auditAfter = (
      await postgres.query<{ row: Record<string, unknown> }>(
        'select to_jsonb(a) as row from public.audit_events a where actor = $1 order by id',
        [member.userId],
      )
    ).rows.map((r) => r.row)
    expect(auditAfter.filter((row) => row.action !== 'privacy.erase_staff')).toEqual(auditBefore)
    const eraseRows = (
      await postgres.query<{ actor: string | null; entity: string; entity_id: string; summary: unknown }>(
        "select actor, entity, entity_id, summary from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )
    ).rows
    expect(eraseRows).toEqual([
      { actor: null, entity: 'staff', entity_id: member.userId, summary: {} },
    ])

    // A second call succeeds, removes nothing and audits nothing.
    const second = (
      await postgres.query<{ r: Record<string, number> }>('select public.privacy_erase_staff($1) as r', [member.userId])
    ).rows[0]!.r
    expect(Object.values(second).every((n) => n === 0)).toBe(true)
    expect(
      (await postgres.query<{ n: number }>(
        "select count(*)::int as n from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )).rows[0]!.n,
    ).toBe(1)
  })
})

describe('privacy_erase_contacts', () => {
  it('deletes the named contacts and their unsent notices, keeps sent rows, audits the count only', async () => {
    const marker = Date.now()
    await rolledBack(async () => {
      const a = await insertContact(`privacy-a-${marker}@example.com`)
      const b = await insertContact(`privacy-b-${marker}@example.com`)
      await insertNotice(a, 'pending', null, null)
      await insertNotice(a, 'sent', new Date().toISOString(), null)

      const deleted = (
        await postgres.query<{ r: number }>('select public.privacy_erase_contacts($1::uuid[]) as r', [[a, b]])
      ).rows[0]!.r
      expect(deleted).toBe(2)
      const gone = (
        await postgres.query<{ n: number }>('select count(*)::int as n from public.contacts where id = any($1::uuid[])', [[a, b]])
      ).rows[0]!.n
      expect(gone).toBe(0)
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1 and status = 'pending'",
          [a],
        )).rows[0]!.n,
      ).toBe(0)
      // The sent row stays, holding only a dangling contactId.
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1 and status = 'sent'",
          [a],
        )).rows[0]!.n,
      ).toBe(1)

      const audit = (
        await postgres.query<{ entity_id: string; summary: { count: number } }>(
          // `at = now()`: only this transaction's rows, not a runbook run left behind on the local stack.
          "select entity_id, summary from public.audit_events where action = 'privacy.erase_contacts' and entity = 'contacts' and at = now()",
        )
      ).rows
      expect(audit).toEqual([{ entity_id: '2', summary: { count: 2 } }])

      expect(
        (await postgres.query<{ r: number }>('select public.privacy_erase_contacts($1::uuid[]) as r', [[a, b]])).rows[0]!.r,
      ).toBe(0)
      // The no-op call wrote no second audit row.
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from public.audit_events where action = 'privacy.erase_contacts' and at = now()",
        )).rows[0]!.n,
      ).toBe(1)
    })
  })
})

describe('contacts_purge (D36)', () => {
  it('purges a contact only once a notice reached a mailbox over 90 days ago and nothing is still pending', async () => {
    const marker = Date.now()
    const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()
    await rolledBack(async () => {
      const old91 = await insertContact(`purge-91-${marker}@example.com`)
      const old89 = await insertContact(`purge-89-${marker}@example.com`)
      const bounced = await insertContact(`purge-bounced-${marker}@example.com`)
      const partlyPending = await insertContact(`purge-pending-${marker}@example.com`)
      const unsent = await insertContact(`purge-unsent-${marker}@example.com`)

      await insertNotice(old91, 'sent', daysAgo(91), null)
      await insertNotice(old91, 'exhausted', null, null) // every outbox row of a purged contact goes
      await insertNotice(old89, 'sent', daysAgo(89), null)
      await insertNotice(bounced, 'sent', daysAgo(91), 'bounced')
      await insertNotice(partlyPending, 'sent', daysAgo(91), null)
      await insertNotice(partlyPending, 'pending', null, null) // still waiting: the contact stays
      await insertNotice(unsent, 'pending', null, null) // reached nobody yet: stays

      const purged = (await postgres.query<{ r: number }>('select finance.contacts_purge() as r')).rows[0]!.r
      expect(purged).toBe(1)

      const remaining = (
        await postgres.query<{ id: string }>('select id from public.contacts where id = any($1::uuid[])', [
          [old91, old89, bounced, partlyPending, unsent],
        ])
      ).rows.map((r) => r.id)
      expect(new Set(remaining)).toEqual(new Set([old89, bounced, partlyPending, unsent]))
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1",
          [old91],
        )).rows[0]!.n,
      ).toBe(0)
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1",
          [partlyPending],
        )).rows[0]!.n,
      ).toBe(2)
    })
  })

  it('the period lives in the function, not a column; the daily job exists', async () => {
    expect(
      (
        await postgres.query<{ n: number }>(
          "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'retain_until'",
        )
      ).rows[0]!.n,
    ).toBe(0)
    expect(
      (await postgres.query<{ n: number }>("select count(*)::int as n from cron.job where jobname = 'contacts-purge'")).rows[0]!
        .n,
    ).toBe(1)
  })
})

// --- P08 round 9: a buyer's export and erase (`20261002170000_stats_disputes.sql`) --------------------------------------
// Like everything above, every fixture is written as the local superuser inside a transaction that is rolled back: nothing
// of a buyer stays in the shared database, and `now()` is the transaction's start (the one test that needs two sessions at
// once cannot, and removes its own rows). The two functions have no API grant, so they run as that role too; the last
// test shows that no API role can call them.

type Row = Record<string, any>
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const orderNumber = (): string => Array.from({ length: 8 }, () => ORDER_ALPHABET[Math.floor(Math.random() * ORDER_ALPHABET.length)]).join('')
const addressOf = (label: string): string => `${label}-${randomUUID()}@example.com`
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await postgres.query(sql, params)).rows
const row = async (sql: string, params: unknown[] = []): Promise<Row> => {
  const found = await rows(sql, params)
  expect(found, sql).toHaveLength(1)
  return found[0]!
}
const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await row(sql, params)).n)
const sqlstate = async (call: Promise<unknown>): Promise<string | undefined> => {
  try {
    await call
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

type Shelf = { product: string; digital: string; physical: string; signed: string }
async function shelf(): Promise<Shelf> {
  const product = (
    await row(`insert into public.products (slug, title, summary, status) values ($1, 'كتاب الاختبار', '', 'published') returning id`, [`privacy-${randomUUID()}`])
  ).id as string
  const variant = async (fulfillment: string, stock: number | null): Promise<string> =>
    (
      await row(
        `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock)
         values ($1, $2, $3, $4, 3000, true, $5) returning id`,
        [product, `PRIV-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`, `خيار ${fulfillment}`, fulfillment, stock],
      )
    ).id as string
  return { product, digital: await variant('digital', null), physical: await variant('physical', 10), signed: await variant('signed', 10) }
}

const customer = async (email: string, name = 'سعد المشتري'): Promise<string> =>
  (await row(`insert into public.customers (email, name, phone) values ($1, $2, '966501234567') returning id`, [email, name])).id as string

type Order = { id: string; number: string; accessHash: string; key: string; request: string; session: string }
/**
 * An order of `customerId`; its email hash is that of `hashOf` (the address by default). Live by default: the accounting
 * retention of a paid order is the live environment's, and a test-environment order is erasable once it holds no work
 * (FABLE-AUDIT M2-12), which has its own test.
 */
async function order(customerId: string, email: string, status: string, hashOf = email, environment: 'test' | 'live' = 'live'): Promise<Order> {
  const number = orderNumber()
  const accessHash = sha(`access-${randomUUID()}`)
  const request = sha(`request-${randomUUID()}`)
  const key = randomUUID()
  const session = randomUUID()
  const inserted = await row(
    `insert into finance.orders (order_number, access_token_hash, access_token_expires_at, customer_id, customer_email, customer_name, customer_phone,
       city_key, city_name_ar, address, seller, policy_revisions, subtotal_halalas, discount_halalas, shipping_halalas, total_halalas, coupon_code,
       environment, idempotency_key, request_hash, checkout_session, email_hash, status, paid_at, hold_expires_at)
     values ($1, $2, now() + interval '7 days', $3, $4, 'سعد المشتري', '966501234567', 'riyadh', 'الرياض', 'حي النخيل شارع الملك فهد', '{}', '{}',
       9000, 0, 1000, 10000, null, $10, $5, $6, $7, finance.recipient_hash($8), $9,
       case when $9 in ('paid', 'paid_needs_resolution', 'refunded') then now() end, now())
     returning id`,
    [number, accessHash, customerId, email, key, request, session, hashOf, status, environment],
  )
  return { id: inserted.id as string, number, accessHash, key, request, session }
}

async function line(orderId: string, s: Shelf, lineNo: number, fulfillment: 'digital' | 'physical' | 'signed', dedication: string | null = null): Promise<string> {
  return (
    await row(
      `insert into finance.order_items (order_id, line_no, variant_id, product_id, sku, product_title, variant_title, fulfillment,
         unit_price_halalas, quantity, line_subtotal_halalas, discount_halalas, dedication)
       values ($1, $2, $3, $4, $5, 'كتاب الاختبار', $6, $7, 3000, 1, 3000, 0, $8) returning id`,
      [orderId, lineNo, s[fulfillment], s.product, `SKU-${lineNo}`, `خيار ${fulfillment}`, fulfillment, dedication],
    )
  ).id as string
}

async function attempt(
  orderId: string,
  status: string,
  extra: { payment?: string | null; lastError?: string; due?: boolean } = {},
): Promise<{ id: string; invoice: string; payment: string | null }> {
  const invoice = randomUUID()
  const payment = extra.payment === undefined ? (status === 'paid' ? randomUUID() : null) : extra.payment
  const id = (
    await row(
      `insert into finance.payment_attempts (order_id, status, amount_halalas, environment, invoice_expires_at, provider_invoice_id,
         provider_payment_id, captured_halalas, paid_at, last_error, next_check_at)
       values ($1, $2, 10000, (select o.environment from finance.orders o where o.id = $1), now() - interval '95 days', $3, $4, case when $2 = 'paid' then 10000 end,
         case when $2 = 'paid' then now() end, $5, case when $6::boolean then now() + interval '1 day' end)
       returning id`,
      [orderId, status, invoice, payment, extra.lastError ?? null, extra.due ?? false],
    )
  ).id as string
  return { id, invoice, payment }
}

const notification = async (email: string, variantId: string, status: string): Promise<string> =>
  (
    await row(
      `insert into public.notifications (email, variant_id, status, confirmed_at) values ($1, $2, $3, case when $3 = 'confirmed' then now() end) returning id`,
      [email, variantId, status],
    )
  ).id as string

const PRIORITY: Record<string, number> = {
  receipt: 0,
  order_shipped: 0,
  order_refunded: 0,
  owner_alert: 0,
  order_link: 1,
  contact_notice: 1,
  notify_confirm: 2,
  availability: 2,
}
const mail = (recipient: string, kind: string, status: string, payload: Record<string, unknown> = {}) =>
  postgres.query(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, case when $6 = 'sent' then now() end)`,
    [`privacy-${randomUUID()}`, kind, PRIORITY[kind]!, recipient, JSON.stringify(payload), status],
  )

const sortedKeys = (value: object): string[] => Object.keys(value).sort()
/** Every key of a JSON value, however deep. */
const allKeys = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(allKeys)
    : value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)])
      : []

describe('privacy_buyer_export', () => {
  const exportOf = async (email: string | null): Promise<Row> => (await row('select public.privacy_buyer_export($1) as r', [email])).r

  it('answers what the system holds of one address, with exactly these keys, and nothing secret or staff-written in it', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('export-buyer')
      const other = addressOf('export-other')
      const buyer = await customer(email)
      const stranger = await customer(other, 'غريب الأطوار')
      const paid = await order(buyer, email, 'paid')
      const book = await line(paid.id, s, 1, 'digital')
      const print = await line(paid.id, s, 2, 'physical')
      const signed = await line(paid.id, s, 3, 'signed', 'إلى سعد مع التحية')
      const paying = await attempt(paid.id, 'paid')
      const storageKey = `assets/${s.digital}/${randomUUID()}`
      const asset = (
        await row(
          `insert into finance.paid_assets (variant_id, storage_key, filename, mime, bytes) values ($1, $2, 'ملف سري.pdf', 'application/pdf', 2048) returning id`,
          [s.digital, storageKey],
        )
      ).id as string
      await postgres.query('insert into finance.entitlements (order_id, order_item_id, variant_id, asset_id) values ($1, $2, $3, $4)', [paid.id, book, s.digital, asset])
      await postgres.query(
        `insert into finance.fulfillments (order_id, order_item_id, state, carrier, tracking, shipped_at, dedication_done)
         values ($1, $2, 'shipped', 'SMSA', 'TRK-778899', now(), false), ($1, $3, 'preparing', null, null, null, true)`,
        [paid.id, print, signed],
      )
      const refundReason = 'سبب داخلي لا يراه المشتري'
      await postgres.query(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, source, request_hash, provider_refunded_before, provider_refunded_after, succeeded_at)
         values ($1, $2, 1500, $3, 'succeeded', 'admin', $4, 0, 1500, now())`,
        [paid.id, paying.id, refundReason, sha('refund-request')],
      )
      const staffNote = 'ملاحظة داخلية: المشتري كثير الطلبات'
      await postgres.query(
        `insert into finance.return_requests (order_id, items, reason, state, staff_note) values ($1, $2::jsonb, 'وصل تالفًا', 'received', $3)`,
        [paid.id, JSON.stringify([{ itemId: print, quantity: 1 }]), staffNote],
      )
      const expired = await order(buyer, email, 'expired')
      const strangers = await order(stranger, other, 'paid')
      await line(strangers.id, s, 1, 'physical')
      const note = await notification(email, s.physical, 'confirmed')
      await notification(other, s.physical, 'pending')
      await mail(email, 'receipt', 'sent', { orderId: paid.id })
      await mail(email, 'order_link', 'pending', { orderId: paid.id })
      await mail(other, 'availability', 'sent', { notificationId: note })

      const before = await count("select count(*)::int as n from public.audit_events where action like 'privacy.%' and at = now()")
      const result = await exportOf(email)

      expect(sortedKeys(result)).toEqual(
        ['customer', 'email', 'entitlements', 'fulfillments', 'items', 'mail', 'notifications', 'orders', 'refunds', 'returns'],
      )
      expect(result.email).toBe(email)
      expect(sortedKeys(result.customer)).toEqual(['createdAt', 'email', 'name', 'phone', 'updatedAt'])
      expect(result.customer).toMatchObject({ email, name: 'سعد المشتري', phone: '966501234567' })

      // The address's two orders, and not the other buyer's.
      expect(result.orders.map((entry: Row) => entry.orderNumber).sort()).toEqual([paid.number, expired.number].sort())
      expect(sortedKeys(result.orders[0])).toEqual(
        ['address', 'city', 'couponCode', 'createdAt', 'currency', 'discount', 'email', 'environment', 'name', 'orderNumber', 'paidAt', 'phone', 'shipping', 'status', 'subtotal', 'total'],
      )
      const mine = result.orders.find((entry: Row) => entry.orderNumber === paid.number)
      expect(mine).toMatchObject({ status: 'paid', total: 10000, shipping: 1000, name: 'سعد المشتري', email, phone: '966501234567', city: 'الرياض', address: 'حي النخيل شارع الملك فهد' })

      expect(result.items).toHaveLength(3)
      expect(sortedKeys(result.items[0])).toEqual(
        ['dedication', 'discount', 'fulfillment', 'lineNo', 'orderNumber', 'preorderNote', 'preorderShipsOn', 'productTitle', 'quantity', 'sku', 'unitPrice', 'variantTitle'],
      )
      expect(result.items.find((entry: Row) => entry.lineNo === 3)).toMatchObject({ orderNumber: paid.number, fulfillment: 'signed', dedication: 'إلى سعد مع التحية' })

      expect(result.fulfillments).toHaveLength(2)
      expect(sortedKeys(result.fulfillments[0])).toEqual(['carrier', 'deliveredAt', 'lineNo', 'orderNumber', 'shippedAt', 'state', 'tracking'])
      expect(result.fulfillments.find((entry: Row) => entry.lineNo === 2)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'TRK-778899' })

      expect(result.entitlements).toHaveLength(1)
      expect(sortedKeys(result.entitlements[0])).toEqual(['grantedAt', 'hasFile', 'lineNo', 'orderNumber', 'revokedAt'])
      expect(result.entitlements[0]).toMatchObject({ lineNo: 1, hasFile: true, revokedAt: null })

      expect(result.refunds).toHaveLength(1)
      expect(sortedKeys(result.refunds[0])).toEqual(['amount', 'createdAt', 'orderNumber', 'source', 'status', 'succeededAt'])
      expect(result.refunds[0]).toMatchObject({ orderNumber: paid.number, amount: 1500, status: 'succeeded', source: 'admin' })

      expect(result.returns).toHaveLength(1)
      expect(sortedKeys(result.returns[0])).toEqual(['createdAt', 'items', 'orderNumber', 'reason', 'state', 'updatedAt'])
      expect(result.returns[0]).toMatchObject({ orderNumber: paid.number, state: 'received', reason: 'وصل تالفًا' })

      expect(result.notifications).toHaveLength(1)
      expect(sortedKeys(result.notifications[0])).toEqual(['confirmedAt', 'consentRevision', 'createdAt', 'productTitle', 'sku', 'status', 'unsubscribedAt', 'variantTitle'])
      expect(result.notifications[0]).toMatchObject({ status: 'confirmed', productTitle: 'كتاب الاختبار', variantTitle: 'خيار physical' })

      expect(result.mail).toHaveLength(2)
      expect(sortedKeys(result.mail[0])).toEqual(['createdAt', 'kind', 'sentAt', 'status'])
      expect(result.mail.map((entry: Row) => [entry.kind, entry.status]).sort()).toEqual([['order_link', 'pending'], ['receipt', 'sent']])
      expect(result.mail.find((entry: Row) => entry.kind === 'receipt').sentAt).not.toBeNull()

      // Nothing the buyer must not hold, nothing staff wrote, nothing of anyone else, and no key that could name one.
      const text = JSON.stringify(result)
      for (const secret of [
        paid.accessHash,
        paid.key,
        paid.request,
        paid.session,
        sha(email),
        storageKey,
        'ملف سري',
        paying.invoice,
        paying.payment!,
        refundReason,
        staffNote,
        other,
        'غريب الأطوار',
        strangers.number,
      ]) {
        expect(text, secret).not.toContain(secret)
      }
      expect(allKeys(result).filter((key) => /token|hash|idempoten|secret|session|storage|staff|invoice|provider|payload|dedupe|lease|key/i.test(key))).toEqual([])

      // Read only: it wrote nothing, and a repeat is the same answer; the address is normalized like checkout does.
      expect(await count("select count(*)::int as n from public.audit_events where action like 'privacy.%' and at = now()")).toBe(before)
      expect(await exportOf(email)).toEqual(result)
      expect(await exportOf(`  ${email.toUpperCase()} `)).toEqual(result)
    })
  })

  it('an address the system holds nothing of gets an empty export, and a malformed address is refused', async () => {
    await rolledBack(async () => {
      const email = addressOf('export-nobody')
      expect(await exportOf(email)).toEqual({
        email,
        customer: null,
        orders: [],
        items: [],
        fulfillments: [],
        entitlements: [],
        refunds: [],
        returns: [],
        notifications: [],
        mail: [],
      })
    })
    for (const bad of [null, '', '   ', 'not-an-email', 'a@b', '@example.com', 'a b@example.com', `${'x'.repeat(250)}@example.com`, 'a@exa mple.com']) {
      await rolledBack(async () => {
        expect(await sqlstate(exportOf(bad)), String(bad)).toBe('22023')
      })
    }
  })
})

describe('privacy_buyer_erase', () => {
  const erase = async (email: string | null): Promise<Row> => (await row('select public.privacy_buyer_erase($1) as r', [email])).r
  const PLACEHOLDER = /^erased-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@erased\.invalid$/
  const exists = async (table: string, id: string): Promise<boolean> => (await count(`select count(*)::int as n from ${table} where id = $1`, [id])) === 1
  const erasures = (): Promise<number> => count("select count(*)::int as n from public.audit_events where action = 'privacy.erase_buyer' and at = now()")
  const byNumber = (kept: Row[]): Record<string, Row> => Object.fromEntries(kept.map((entry) => [entry.orderNumber, entry]))

  it('deletes the notification rows and the unsent mail, replaces the address in the rest, deletes what the retention rule allows with its rows, keeps every other order with its reason', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-buyer')
      const other = addressOf('erase-other')
      const buyer = await customer(email)
      const stranger = await customer(other, 'غريب')

      // Kept: money or an open hold, and an expired order that a payment is attached to.
      const paid = await order(buyer, email, 'paid')
      await line(paid.id, s, 1, 'digital')
      await attempt(paid.id, 'paid')
      const resolving = await order(buyer, email, 'paid_needs_resolution')
      await attempt(resolving.id, 'paid')
      const refunded = await order(buyer, email, 'refunded')
      await attempt(refunded.id, 'paid')
      const pending = await order(buyer, email, 'pending_payment')
      await attempt(pending.id, 'pending')
      const expiredPaid = await order(buyer, email, 'expired')
      await attempt(expiredPaid.id, 'paid')
      // Deleted: an expired and a cancelled hold, with their attempts, lines, reservations, a coupon use and a webhook event.
      const expired = await order(buyer, email, 'expired')
      const expiredLine = await line(expired.id, s, 1, 'physical')
      await attempt(expired.id, 'failed')
      await postgres.query(
        `insert into finance.inventory_reservations (order_id, variant_id, quantity, state, expires_at, released_at) values ($1, $2, 1, 'released', now(), now())`,
        [expired.id, s.physical],
      )
      const cancelled = await order(buyer, email, 'cancelled')
      await line(cancelled.id, s, 1, 'signed', 'إهداء')
      const cancelledAttempt = await attempt(cancelled.id, 'expired', { payment: randomUUID() })
      await postgres.query(
        `insert into finance.payment_events (event_id, type, live, provider_payment_id, payload_hash, outcome) values ($1, 'payment_paid', false, $2, $3, 'closed')`,
        [`privacy-event-${randomUUID()}`, cancelledAttempt.payment, sha('event')],
      )
      const coupon = (
        await row(`insert into public.coupons (code, kind, percent_bp) values ($1, 'percent', 1000) returning id`, [`PRIV${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`])
      ).id as string
      await postgres.query(
        `insert into finance.coupon_redemptions (coupon_id, order_id, state, expires_at, released_at) values ($1, $2, 'released', now(), now())`,
        [coupon, cancelled.id],
      )
      // Somebody else, who must not be touched.
      const strangers = await order(stranger, other, 'expired')
      await line(strangers.id, s, 1, 'physical')
      await attempt(strangers.id, 'failed')

      const first = await notification(email, s.physical, 'pending')
      const second = await notification(email, s.signed, 'confirmed')
      const third = await notification(other, s.physical, 'confirmed')
      await mail(email, 'receipt', 'sent', { orderId: paid.id })
      await mail(email, 'order_shipped', 'sending', { orderId: paid.id })
      await mail(email, 'availability', 'sent', { notificationId: second })
      await mail(email, 'order_link', 'pending', { orderId: paid.id })
      await mail(email, 'notify_confirm', 'pending', { notificationId: first })
      await mail(email, 'availability', 'exhausted', { notificationId: second })
      await mail(email, 'order_refunded', 'uncertain', { orderId: refunded.id })
      await mail(other, 'receipt', 'sent', { orderId: strangers.id })
      await mail(other, 'availability', 'pending', { notificationId: third })

      const result = await erase(email)

      expect(result).toMatchObject({ notifications: 2, orders: 2, outbox_dropped: 4, outbox_redacted: 3, customers: 0 })
      expect(sortedKeys(result)).toEqual(['customers', 'kept', 'notifications', 'orders', 'outbox_dropped', 'outbox_redacted'])
      // Every kept order is reported with its reason.
      const kept = byNumber(result.kept)
      expect(Object.keys(kept).sort()).toEqual([paid.number, resolving.number, refunded.number, pending.number, expiredPaid.number].sort())
      expect(sortedKeys(result.kept[0])).toEqual(['orderNumber', 'reason', 'status'])
      expect(kept[paid.number]).toEqual({ orderNumber: paid.number, status: 'paid', reason: 'ACCOUNTING_RETENTION' })
      expect(kept[resolving.number]).toMatchObject({ status: 'paid_needs_resolution', reason: 'ACCOUNTING_RETENTION' })
      expect(kept[refunded.number]).toMatchObject({ status: 'refunded', reason: 'ACCOUNTING_RETENTION' })
      expect(kept[pending.number]).toMatchObject({ status: 'pending_payment', reason: 'OPEN_HOLD' })
      expect(kept[expiredPaid.number]).toMatchObject({ status: 'expired', reason: 'PAYMENT_RECORDS' })

      // The two holds are gone with everything that hung from them; the kept orders keep theirs.
      for (const gone of [expired, cancelled]) {
        expect(await exists('finance.orders', gone.id), gone.number).toBe(false)
        for (const table of ['finance.order_items', 'finance.payment_attempts', 'finance.inventory_reservations', 'finance.coupon_redemptions']) {
          expect(await count(`select count(*)::int as n from ${table} where order_id = $1`, [gone.id]), `${gone.number} ${table}`).toBe(0)
        }
      }
      expect(await count('select count(*)::int as n from finance.payment_events where provider_payment_id = $1', [cancelledAttempt.payment])).toBe(0)
      expect(await count('select count(*)::int as n from finance.order_items where id = $1', [expiredLine])).toBe(0)
      for (const keptOrder of [paid, resolving, refunded, pending, expiredPaid]) {
        expect(await exists('finance.orders', keptOrder.id), keptOrder.number).toBe(true)
        expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [keptOrder.id]), keptOrder.number).toBe(1)
      }
      expect(await count('select count(*)::int as n from finance.order_items where order_id = $1', [paid.id])).toBe(1)
      // The customer row stays while an order of it does; the buyer's contact snapshot stays on the kept orders.
      expect(await exists('public.customers', buyer)).toBe(true)
      expect((await row('select customer_email from finance.orders where id = $1', [paid.id])).customer_email).toBe(email)
      // Somebody else's order, customer, notification and mail are as they were.
      expect(await exists('finance.orders', strangers.id)).toBe(true)
      expect(await exists('public.customers', stranger)).toBe(true)
      expect(await exists('public.notifications', third)).toBe(true)
      expect(await count('select count(*)::int as n from finance.email_outbox where recipient = $1', [other])).toBe(2)

      // The notification rows and the mail still unsent to the address are gone; the address is in no outbox row; the sent
      // history stays under one placeholder.
      expect(await exists('public.notifications', first)).toBe(false)
      expect(await exists('public.notifications', second)).toBe(false)
      expect(await count('select count(*)::int as n from finance.email_outbox where recipient = $1', [email])).toBe(0)
      expect(await count("select count(*)::int as n from finance.email_outbox where payload::text like '%' || $1 || '%'", [email])).toBe(0)
      const remaining = await rows(
        `select kind, status, recipient from finance.email_outbox
          where (payload ->> 'orderId' = any($1::text[]) or payload ->> 'notificationId' = any($2::text[])) and recipient <> $3
          order by kind`,
        [[paid.id, refunded.id], [first, second], other],
      )
      expect(remaining.map((entry) => [entry.kind, entry.status])).toEqual([['availability', 'sent'], ['order_shipped', 'sending'], ['receipt', 'sent']])
      expect(new Set(remaining.map((entry) => entry.recipient)).size).toBe(1)
      expect(remaining[0]!.recipient).toMatch(PLACEHOLDER)
      expect(remaining[0]!.recipient).not.toContain(email.split('@')[0]!)

      // One count-only audit row: no address, no order number, no id.
      expect(await erasures()).toBe(1)
      const audit = await row("select actor, entity, entity_id, summary from public.audit_events where action = 'privacy.erase_buyer' and at = now()")
      expect(audit).toMatchObject({ actor: null, entity: 'orders', entity_id: null })
      expect(audit.summary).toEqual({ notifications: 2, orders: 2, outbox: 7, customers: 0, kept: 5 })
      const auditText = JSON.stringify(audit)
      for (const secret of [email, paid.number, paid.id, buyer, 'سعد']) expect(auditText).not.toContain(secret)

      // Safe to repeat: nothing is left to remove, nothing is audited, and the state is the same.
      const snapshot = async (): Promise<unknown> => [
        await rows('select id, status from finance.orders where customer_id = $1 order by id', [buyer]),
        await rows('select id, recipient, status from finance.email_outbox where recipient like $1 or recipient = $2 order by id', ['erased-%', other]),
        await rows('select id from public.notifications where email in ($1, $2) order by id', [email, other]),
      ]
      const state = await snapshot()
      const again = await erase(email)
      expect(again).toMatchObject({ notifications: 0, orders: 0, outbox_dropped: 0, outbox_redacted: 0, customers: 0 })
      expect(Object.keys(byNumber(again.kept)).sort()).toEqual(Object.keys(kept).sort())
      expect(await snapshot()).toEqual(state)
      expect(await erasures()).toBe(1)
    })
  })

  it('never deletes an order that money or work is attached to, whatever its status: each blocker keeps it, and the controls beside them go', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-blocked')
      const buyer = await customer(email)
      type Case = { label: string; make: (o: Order) => Promise<unknown>; blocked: boolean }
      const cases: Case[] = [
        { label: 'an attempt creating', make: (o) => attempt(o.id, 'creating'), blocked: true },
        { label: 'an attempt pending', make: (o) => attempt(o.id, 'pending'), blocked: true },
        { label: 'an attempt uncertain', make: (o) => attempt(o.id, 'uncertain'), blocked: true },
        { label: 'an attempt in review', make: (o) => attempt(o.id, 'review'), blocked: true },
        { label: 'an attempt paid', make: (o) => attempt(o.id, 'paid'), blocked: true },
        { label: 'an attempt still due for a check', make: (o) => attempt(o.id, 'expired', { due: true }), blocked: true },
        { label: 'an attempt that could not be verified', make: (o) => attempt(o.id, 'expired', { lastError: 'UNVERIFIED' }), blocked: true },
        {
          label: 'an open review payment',
          make: (o) =>
            postgres.query(
              `insert into finance.payment_reviews (provider_payment_id, order_id, environment, amount_halalas, currency, provider_status, reason)
               values ($1, $2, 'test', 800, 'SAR', 'paid', 'ORDER_ALREADY_PAID')`,
              [randomUUID(), o.id],
            ),
          blocked: true,
        },
        {
          label: 'a closed review payment',
          make: (o) =>
            postgres.query(
              `insert into finance.payment_reviews (provider_payment_id, order_id, environment, amount_halalas, currency, provider_status, reason, closed_at, closed_reason)
               values ($1, $2, 'test', 800, 'SAR', 'paid', 'ORDER_ALREADY_PAID', now(), 'refunded')`,
              [randomUUID(), o.id],
            ),
          blocked: true,
        },
        {
          label: 'a dispute',
          make: async (o) => {
            const closed = await attempt(o.id, 'expired')
            await postgres.query(
              `insert into finance.disputes (kind, provider_ref, seq, attempt_id, environment, amount_halalas, direction, occurred_on, reason)
               values ('chargeback', $2, 1, $1, 'test', 1000, 'against_seller', '2026-09-01', 'سبب')`,
              [closed.id, `PRIV-${randomUUID()}`],
            )
          },
          blocked: true,
        },
        { label: 'no attempt at all', make: async () => undefined, blocked: false },
        { label: 'an attempt failed', make: (o) => attempt(o.id, 'failed'), blocked: false },
        { label: 'an attempt expired', make: (o) => attempt(o.id, 'expired'), blocked: false },
        { label: 'an attempt cancelled', make: (o) => attempt(o.id, 'cancelled'), blocked: false },
        { label: 'an attempt abandoned', make: (o) => attempt(o.id, 'abandoned'), blocked: false },
      ]
      const placed: Array<Case & { order: Order }> = []
      for (const [index, entry] of cases.entries()) {
        // Expired and cancelled alike.
        const o = await order(buyer, email, index % 2 === 0 ? 'expired' : 'cancelled')
        await line(o.id, s, 1, 'physical')
        await entry.make(o)
        placed.push({ ...entry, order: o })
      }
      const result = await erase(email)
      const kept = byNumber(result.kept)
      for (const { label, order: o, blocked } of placed) {
        expect(await exists('finance.orders', o.id), label).toBe(blocked)
        if (blocked) expect(kept[o.number], label).toMatchObject({ reason: 'PAYMENT_RECORDS' })
        else expect(kept[o.number], label).toBeUndefined()
      }
      expect(result.orders).toBe(cases.filter((entry) => !entry.blocked).length)
      expect(result.kept).toHaveLength(cases.filter((entry) => entry.blocked).length)
      // The customer row stays: its blocked orders are left.
      expect(result.customers).toBe(0)
      expect(await exists('public.customers', buyer)).toBe(true)
    })
  })

  // FABLE-AUDIT M2-12 (OPS-PRIVACY-20): sandbox payments are no money, so a test-environment order is not kept for the
  // accounting retention; the guards for work still attached hold, and a live order is kept as before.
  it('deletes a test-environment order that holds no work whatever its payment, with every row of it; keeps one with work attached, and a live one', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-sandbox')
      const buyer = await customer(email)
      const sandbox = (status: string): Promise<Order> => order(buyer, email, status, email, 'test')
      const reviewOf = async (o: Order, attemptId: string, closed: boolean): Promise<string> => {
        const paymentId = randomUUID()
        await postgres.query(
          `insert into finance.payment_reviews (provider_payment_id, order_id, attempt_id, environment, amount_halalas, currency, provider_status, reason, closed_at, closed_reason)
           values ($1, $2, $3, 'test', 800, 'SAR', 'paid', 'SECOND_PAYMENT', case when $4 then now() end, case when $4 then 'refunded' end)`,
          [paymentId, o.id, attemptId, closed],
        )
        return paymentId
      }
      const dispute = (target: { attempt?: string; review?: string }): Promise<unknown> =>
        postgres.query(
          `insert into finance.disputes (kind, provider_ref, seq, attempt_id, review_payment_id, environment, amount_halalas, direction, occurred_on, reason)
           values ('chargeback', $1, 1, $2, $3, 'test', 1000, 'against_seller', '2026-09-01', 'سبب')`,
          [`PRIV-${randomUUID()}`, target.attempt ?? null, target.review ?? null],
        )

      // Paid in the sandbox and settled: a printed line shipped, a digital one granted with a download link, a refund that
      // settled a received return (the two rows refer to each other), and a second payment in review, refunded and closed.
      const paid = await sandbox('paid')
      const printLine = await line(paid.id, s, 1, 'physical')
      const bookLine = await line(paid.id, s, 2, 'digital')
      const paying = await attempt(paid.id, 'paid')
      await postgres.query(
        `insert into finance.fulfillments (order_id, order_item_id, state, carrier, tracking, shipped_at) values ($1, $2, 'shipped', 'SMSA', 'TRK-1', now())`,
        [paid.id, printLine],
      )
      const entitlement = (await row('insert into finance.entitlements (order_id, order_item_id, variant_id) values ($1, $2, $3) returning id', [paid.id, bookLine, s.digital])).id as string
      await postgres.query('insert into finance.download_tokens (token_hash, entitlement_id) values ($1, $2)', [sha(`download-${randomUUID()}`), entitlement])
      const returned = (
        await row(`insert into finance.return_requests (order_id, items, reason, state) values ($1, $2::jsonb, 'وصل تالفًا', 'received') returning id`, [
          paid.id,
          JSON.stringify([{ itemId: printLine, quantity: 1 }]),
        ])
      ).id as string
      const refund = (
        await row(
          `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, source, return_id, succeeded_at)
           values ($1, $2, 1500, 'سبب', 'succeeded', 'admin', $3, now()) returning id`,
          [paid.id, paying.id, returned],
        )
      ).id as string
      await postgres.query("update finance.return_requests set state = 'refunded', refund_id = $2 where id = $1", [returned, refund])
      const review = await reviewOf(paid, paying.id, true)
      await postgres.query(
        `insert into finance.refunds (order_id, review_payment_id, amount_halalas, reason, status, source, succeeded_at) values ($1, $2, 800, 'سبب', 'succeeded', 'admin', now())`,
        [paid.id, review],
      )
      // Refunded in the sandbox, and an expired one whose sandbox payment came too late.
      const refunded = await sandbox('refunded')
      await attempt(refunded.id, 'paid')
      const late = await sandbox('expired')
      await attempt(late.id, 'paid')

      // Kept: sandbox orders with work still attached.
      const kept: Array<[string, Order]> = []
      const keep = async (label: string, status: string, make: (o: Order) => Promise<unknown>): Promise<void> => {
        const o = await sandbox(status)
        await make(o)
        kept.push([label, o])
      }
      await keep('awaiting the owner\'s resolution', 'paid_needs_resolution', (o) => attempt(o.id, 'paid'))
      await keep('still open', 'pending_payment', (o) => attempt(o.id, 'pending'))
      await keep('an attempt in flight', 'paid', async (o) => {
        await attempt(o.id, 'paid')
        await attempt(o.id, 'uncertain')
      })
      await keep('a check still due', 'paid', (o) => attempt(o.id, 'paid', { due: true }))
      await keep('an attempt that could not be verified', 'refunded', async (o) => {
        await attempt(o.id, 'paid')
        await attempt(o.id, 'expired', { lastError: 'UNVERIFIED' })
      })
      await keep('an open review payment', 'paid', async (o) => reviewOf(o, (await attempt(o.id, 'paid')).id, false))
      await keep('a refund in flight', 'paid', async (o) => {
        const a = await attempt(o.id, 'paid')
        await postgres.query(`insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, source) values ($1, $2, 500, 'سبب', 'submitting', 'admin')`, [o.id, a.id])
      })
      await keep('a dispute on its payment', 'paid', async (o) => dispute({ attempt: (await attempt(o.id, 'paid')).id }))
      await keep('a dispute on its closed review payment', 'paid', async (o) => dispute({ review: await reviewOf(o, (await attempt(o.id, 'paid')).id, true) }))
      // And live, paid and settled: the accounting retention.
      const live = await order(buyer, email, 'paid')
      await attempt(live.id, 'paid')

      const result = await erase(email)
      expect(result.orders).toBe(3)
      for (const gone of [paid, refunded, late]) expect(await exists('finance.orders', gone.id), gone.number).toBe(false)
      for (const table of ['finance.order_items', 'finance.payment_attempts', 'finance.fulfillments', 'finance.entitlements', 'finance.refunds', 'finance.return_requests', 'finance.payment_reviews']) {
        expect(await count(`select count(*)::int as n from ${table} where order_id = $1`, [paid.id]), table).toBe(0)
      }
      expect(await count('select count(*)::int as n from finance.download_tokens where entitlement_id = $1', [entitlement])).toBe(0)
      expect(await count('select count(*)::int as n from finance.refunds where review_payment_id = $1 or id = $2', [review, refund])).toBe(0)
      expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [review])).toBe(0)
      const reasons = byNumber(result.kept)
      for (const [label, o] of kept) {
        expect(await exists('finance.orders', o.id), label).toBe(true)
        expect(reasons[o.number], label).toBeDefined()
      }
      expect(reasons[live.number]).toEqual({ orderNumber: live.number, status: 'paid', reason: 'ACCOUNTING_RETENTION' })
      expect(await exists('finance.orders', live.id)).toBe(true)
      expect(result.kept).toHaveLength(kept.length + 1)
    })
  })

  it('deletes the customer row once no order of it is left, and an address with nothing but a notification is erased too', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-customer')
      const buyer = await customer(email)
      const expired = await order(buyer, email, 'expired')
      await line(expired.id, s, 1, 'physical')
      await attempt(expired.id, 'failed')
      const cancelled = await order(buyer, email, 'cancelled')
      await line(cancelled.id, s, 1, 'digital')
      const result = await erase(email)
      expect(result).toMatchObject({ orders: 2, customers: 1, kept: [], notifications: 0 })
      expect(await exists('public.customers', buyer)).toBe(false)
      expect(await count('select count(*)::int as n from finance.orders where customer_id = $1', [buyer])).toBe(0)
      expect(await erasures()).toBe(1)
      // The customer's own audit names the fields it changed, never the buyer's values.
      const deleted = await rows("select summary from public.audit_events where action = 'customers.delete' and entity_id = $1", [buyer])
      for (const entry of deleted) expect(JSON.stringify(entry)).not.toContain(email)

      // An address that never bought, only asked to be told about a book: no customer, no order, nothing but its notification.
      const visitor = addressOf('erase-visitor')
      const note = await notification(visitor, s.physical, 'confirmed')
      await mail(visitor, 'notify_confirm', 'pending', { notificationId: note })
      const done = await erase(visitor)
      expect(done).toMatchObject({ notifications: 1, orders: 0, customers: 0, outbox_dropped: 1, outbox_redacted: 0, kept: [] })
      expect(await exists('public.notifications', note)).toBe(false)
      expect(await count('select count(*)::int as n from finance.email_outbox where recipient = $1', [visitor])).toBe(0)
      // An address the system never saw changes nothing and audits nothing.
      const before = await erasures()
      expect(await erase(addressOf('erase-nobody'))).toEqual({ notifications: 0, orders: 0, outbox_dropped: 0, outbox_redacted: 0, customers: 0, kept: [] })
      expect(await erasures()).toBe(before)
    })
  })

  it('an order is the address\'s by its email hash or by its customer row, and the address is normalized like checkout does', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-linked')
      const other = addressOf('erase-linked-other')
      const buyer = await customer(email)
      const stranger = await customer(other, 'غريب')
      // The buyer's customer row, with a hash of another address; another customer's order that carries the buyer's hash; and
      // an order that is neither.
      const byCustomer = await order(buyer, email, 'expired', other)
      const byHash = await order(stranger, other, 'expired', email)
      const neither = await order(stranger, other, 'expired')
      for (const o of [byCustomer, byHash, neither]) await line(o.id, s, 1, 'physical')
      const result = await erase(`  ${email.toUpperCase()}  `)
      expect(result).toMatchObject({ orders: 2, customers: 1, kept: [] })
      expect(await exists('finance.orders', byCustomer.id)).toBe(false)
      expect(await exists('finance.orders', byHash.id)).toBe(false)
      expect(await exists('finance.orders', neither.id)).toBe(true)
      expect(await exists('public.customers', buyer)).toBe(false)
      expect(await exists('public.customers', stranger)).toBe(true)
    })
  })

  it('leaves the mail that is not the buyer\'s: an owner alert and a contact notice to an address that is also a staff address stay as they are', async () => {
    await rolledBack(async () => {
      const s = await shelf()
      const email = addressOf('erase-staff-buyer')
      const buyer = await customer(email)
      const expired = await order(buyer, email, 'expired')
      await line(expired.id, s, 1, 'physical')
      // The owner bought from his own shop: staff mail to the address, sent and not, beside the mail it got as a buyer.
      await mail(email, 'owner_alert', 'pending', { alert: 'low_stock' })
      await mail(email, 'owner_alert', 'sent', { alert: 'needs_resolution' })
      for (const status of ['pending', 'uncertain', 'exhausted', 'sent']) await mail(email, 'contact_notice', status, { contactId: null })
      await mail(email, 'order_link', 'pending', { orderId: expired.id })
      await mail(email, 'receipt', 'sent', { orderId: expired.id })
      const staffMail = (): Promise<Row[]> =>
        rows("select id, kind, status, recipient, updated_at from finance.email_outbox where recipient = $1 and kind in ('owner_alert', 'contact_notice') order by id", [email])
      const before = await staffMail()
      expect(before).toHaveLength(6)

      const result = await erase(email)

      // Only the two rows of the buyer were touched: the unsent one dropped, the sent one given the placeholder.
      expect(result).toMatchObject({ notifications: 0, orders: 1, outbox_dropped: 1, outbox_redacted: 1, customers: 1, kept: [] })
      expect(await staffMail()).toEqual(before)
      expect(await count('select count(*)::int as n from finance.email_outbox where recipient = $1', [email])).toBe(6)
      expect(await count("select count(*)::int as n from finance.email_outbox where payload ->> 'orderId' = $1 and kind = 'order_link'", [expired.id])).toBe(0)
      expect((await row("select recipient from finance.email_outbox where payload ->> 'orderId' = $1 and kind = 'receipt'", [expired.id])).recipient).toMatch(PLACEHOLDER)
      expect((await row("select summary from public.audit_events where action = 'privacy.erase_buyer' and at = now()")).summary).toMatchObject({ outbox: 2 })
    })
  })

  it('locks the address\'s orders before it touches any notification or mail row: a writer that holds an order never meets a row the erase already took', async () => {
    // Two sessions at once cannot share a rolled-back transaction, so this test writes its fixtures for real and removes them
    // itself. The erase never completes here (it is made to give up on the order's lock), so it deletes nothing and audits nothing.
    const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const holder = new Client({ connectionString: url })
    const eraser = new Client({ connectionString: url })
    const s = await shelf()
    const email = addressOf('erase-lock')
    const buyer = await customer(email)
    const held = await order(buyer, email, 'expired')
    const note = await notification(email, s.physical, 'pending')
    await mail(email, 'order_link', 'pending', { orderId: held.id })
    const queued = (await row('select id from finance.email_outbox where recipient = $1', [email])).id as string
    try {
      await holder.connect()
      await eraser.connect()
      await holder.query('begin')
      await holder.query('select 1 from finance.orders where id = $1 for update', [held.id])
      await eraser.query("set lock_timeout = '4s'")
      const pid = (await eraser.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
      let settled = false
      const erasing = sqlstate(eraser.query('select public.privacy_buyer_erase($1)', [email])).finally(() => {
        settled = true
      })
      // The erase waits for the order the holder has. While it waits it has taken nothing else of the address: the
      // notification and the mail are free to lock (a row it had already deleted would be locked by it).
      expect(await settledWithin(erasing, 1500)).toBe('blocked')
      expect((await row('select wait_event_type from pg_stat_activity where pid = $1', [pid])).wait_event_type).toBe('Lock')
      expect(await rows('select id from public.notifications where id = $1 for update skip locked', [note])).toHaveLength(1)
      expect(await rows('select id from finance.email_outbox where id = $1 for update skip locked', [queued])).toHaveLength(1)
      expect(settled).toBe(false)
      // It gives up on the lock and changes nothing.
      expect(await erasing).toBe('55P03')
      expect(await exists('public.notifications', note)).toBe(true)
      expect(await exists('finance.email_outbox', queued)).toBe(true)
      expect(await exists('finance.orders', held.id)).toBe(true)
    } finally {
      await holder.query('rollback').catch(() => undefined)
      await holder.end().catch(() => undefined)
      await eraser.end().catch(() => undefined)
      await postgres.query('delete from finance.email_outbox where recipient = $1', [email])
      await postgres.query('delete from public.notifications where email = $1', [email])
      await postgres.query('delete from finance.orders where id = $1', [held.id])
      await postgres.query('delete from public.customers where id = $1', [buyer])
      await postgres.query('delete from public.product_variants where product_id = $1', [s.product])
      await postgres.query('delete from public.products where id = $1', [s.product])
    }
  })

  it('a malformed address is refused with 22023 and changes nothing', async () => {
    for (const bad of [null, '', '   ', 'not-an-email', 'a@b', '@example.com', 'a b@example.com', `${'x'.repeat(250)}@example.com`]) {
      await rolledBack(async () => {
        const email = addressOf('erase-bad')
        const buyer = await customer(email)
        await order(buyer, email, 'expired')
        expect(await sqlstate(erase(bad)), String(bad)).toBe('22023')
      })
    }
  })

  it('no API role can call either function: anon, authenticated and the service role are refused', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const call of ['select public.privacy_buyer_export($1)', 'select public.privacy_buyer_erase($1)']) {
        await postgres.query('begin')
        try {
          const email = addressOf('erase-denied')
          const buyer = await customer(email)
          await order(buyer, email, 'expired')
          // Written as the superuser, called as the role.
          await postgres.query(`set local role ${role}`)
          expect(await sqlstate(postgres.query(call, [email])), `${role} ${call}`).toBe('42501')
        } finally {
          await postgres.query('rollback')
        }
      }
    }
  })
})

// --- P08 round 9: the daily purge of processed webhook events (`finance.payment_events_purge`, contract section 4) ----------
// The grants are in the list at the top. Fixtures are written inside a transaction that is rolled back, like the buyer's.

describe('payment_events_purge: processed webhook events older than 180 days', () => {
  const purge = async (): Promise<number> => Number((await row('select finance.payment_events_purge() as n')).n)
  /** One webhook event, processed `processedAgo` ago (null: never processed). */
  const event = async (processedAgo: string | null, outcome: string | null, payment: string | null = randomUUID()): Promise<string> => {
    const id = `privacy-event-${randomUUID()}`
    await postgres.query(
      `insert into finance.payment_events (event_id, type, live, provider_payment_id, payload_hash, received_at, processed_at, outcome)
       values ($1, 'payment_paid', false, $2, $3, now() - interval '400 days', now() - $4::interval, $5)`,
      [id, payment, sha(id), processedAgo, outcome],
    )
    return id
  }
  const held = async (id: string): Promise<boolean> => (await count('select count(*)::int as n from finance.payment_events where event_id = $1', [id])) === 1
  const purges = (): Promise<number> => count("select count(*)::int as n from public.audit_events where action = 'payments.events_purge' and at = now()")

  it('removes an event processed more than 180 days ago and keeps every other: a younger one, one not processed, one that still needs a person', async () => {
    await rolledBack(async () => {
      const settledPayment = randomUUID()
      const gone = {
        old: await event('181 days', 'closed'),
        older: await event('2 years', 'ignored'),
        justOver: await event('180 days 1 second', 'closed'),
        // An exhausted event goes once it needs nobody: its payment was dismissed, or the ledger holds it since.
        dismissed: await event('200 days', 'dismissed'),
        settled: await event('200 days', 'exhausted', settledPayment),
      }
      await postgres.query(
        `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason)
         values ($1, 'test', 800, 'SAR', 'paid', 'UNMAPPED_INVOICE')`,
        [settledPayment],
      )
      const stays = {
        // The cutoff is exclusive: an event processed exactly 180 days ago stays until the next run.
        edge: await event('180 days', 'closed'),
        young: await event('179 days', 'closed'),
        fresh: await event('1 minute', 'closed'),
        // Never processed, however old: the job still owns it.
        unprocessed: await event(null, null),
        // Exhausted, its payment settled nowhere and not dismissed: the owner's open work, however old.
        exhausted: await event('400 days', 'exhausted'),
      }

      const removed = await purge()

      for (const [label, id] of Object.entries(gone)) expect(await held(id), label).toBe(false)
      for (const [label, id] of Object.entries(stays)) expect(await held(id), label).toBe(true)
      expect(removed).toBeGreaterThanOrEqual(Object.keys(gone).length)
      // One count-only audit row; a second run finds nothing, removes nothing and audits nothing.
      expect(await purges()).toBe(1)
      expect((await row("select summary from public.audit_events where action = 'payments.events_purge' and at = now()")).summary).toEqual({ events: removed })
      expect(await purge()).toBe(0)
      expect(await purges()).toBe(1)
      for (const id of Object.values(stays)) expect(await held(id)).toBe(true)
    })
  })

  it('is scheduled daily', async () => {
    expect(await rows("select schedule, command from cron.job where jobname = 'payment-events-purge'")).toEqual([
      { schedule: '47 3 * * *', command: 'select finance.payment_events_purge()' },
    ])
  })
})
