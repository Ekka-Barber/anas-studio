// P08 round 8: notifications against the real local database
// (`supabase/migrations/20261002150000_notifications.sql`): the public state of a variant
// and `catalog_availability`, the sign-up and its silent caps, the confirmation and
// unsubscribe links, the availability sweep, the purges and the grants of every function.
// The server-only functions are called as `service_role` (the Edge Functions' role, D32)
// through direct sessions; the sweep and the purge, which only pg_cron runs, as the local
// `postgres` superuser. Products and variants are the shared fixtures of `support.ts`
// (orders placed through `checkout_create`, paid through `apply_verified_payment`), and
// what only the database could write (an aged row, a restock, a queued mail) is written
// as the superuser. Nothing here reaches Moyasar or sends a mail.
//
// The sweep also runs from pg_cron every minute on this database, so a test that restocks
// a variant and then sweeps may find the mail already queued by the job: every assertion
// about the sweep is about what it left (the rows, the revision, the outbox), never about
// which of the two runs queued it. This file switches `finance.commerce_settings.checkout_enabled`
// on (saved and restored by the fixtures) and clears the day's sign-up total before each
// test; every fixture carries a per-run unique slug, SKU or address.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { anonClient, commerceHarness, type Harness, type Row, settledWithin, sha256, signIn, uniqueEmail } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const PEPPER = `notify-pepper-${randomUUID()}`
const OK = { ok: true }
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }
const PREFIX = `p08r8-${Date.now()}-${process.pid}-`
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const STATES = ['available', 'preorder', 'out_of_stock', 'unpriced']

let h: Harness

beforeAll(async () => {
  h = await commerceHarness(PEPPER)
})

afterAll(async () => {
  await h.postgres.query('delete from finance.email_outbox where dedupe_key like $1', [`${PREFIX}%`])
  await h.stop()
})

beforeEach(async () => {
  // The day's total of confirmation mails is one bucket for the whole machine.
  await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:all'")
})

// --- fixtures ------------------------------------------------------------------------------------------------------

let counter = 0
const soldOut = (): Promise<string> => h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0 })
const preorderVariant = (capacity = 2): Promise<string> => h.makeVariant({ fulfillment: 'physical', price: 5000, stock: 0, preorder: { capacity } })
const productOf = async (variantId: string): Promise<string> => (await h.row('select product_id from public.product_variants where id = $1', [variantId])).product_id as string
const setVariant = (variantId: string, set: string, params: unknown[] = []): Promise<unknown> =>
  h.postgres.query(`update public.product_variants set ${set} where id = $1`, [variantId, ...params])
const restock = (variantId: string, stock = 5): Promise<unknown> => setVariant(variantId, 'stock = $2', [stock])
const utcDay = async (): Promise<string> => (await h.row("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as d")).d as string

type Subscribe = { email?: string; ip?: string; consent?: number | null }
const subscribe = (variantId: string, over: Subscribe = {}, client?: Client): Promise<any> =>
  h.call(
    'notify_subscribe',
    { p_ip_hash: over.ip ?? h.ipHash(), p_email: over.email ?? uniqueEmail('reader'), p_variant: variantId, p_consent_revision: over.consent === undefined ? 1 : over.consent },
    client,
  )
const noteOf = (email: string, variantId: string): Promise<Row> => h.row('select * from public.notifications where email = $1 and variant_id = $2', [email, variantId])
const noteById = (id: string): Promise<Row> => h.row('select * from public.notifications where id = $1', [id])
const mailOf = (notificationId: string): Promise<Row[]> => h.rows("select * from finance.email_outbox where payload ->> 'notificationId' = $1 order by id", [notificationId])
const availabilityMail = (variantId: string): Promise<Row[]> =>
  h.rows("select * from finance.email_outbox where kind = 'availability' and dedupe_key like $1 order by dedupe_key", [`availability:${variantId}:%`])
const availabilityOf = async (variantId: string): Promise<Row | undefined> => (await h.rows('select * from finance.variant_availability where variant_id = $1', [variantId]))[0]
const sweep = (client: { query: Client['query'] } = h.postgres): Promise<unknown> => client.query('select finance.availability_sweep() as n')
const confirmed = async (variantId: string, email = uniqueEmail('reader')): Promise<string> => {
  expect(await subscribe(variantId, { email })).toEqual(OK)
  const note = await noteOf(email, variantId)
  expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: note.token_version })).toMatchObject({ ok: true })
  return note.id as string
}
/** A row written the way the owner's SQL editor could: any status, no caps, the availability row beside it. */
async function insertNote(variantId: string, status: 'pending' | 'confirmed' | 'unsubscribed', email = uniqueEmail('subscriber')): Promise<Row> {
  await h.postgres.query('insert into finance.variant_availability (variant_id) values ($1) on conflict do nothing', [variantId])
  return h.row(
    `insert into public.notifications (email, variant_id, status, confirm_sent_at, confirmed_at, unsubscribed_at, token_version)
     values ($1, $2, $3::text, now(), case when $3::text = 'confirmed' then now() end, case when $3::text = 'unsubscribed' then now() end, case when $3::text = 'unsubscribed' then 2 else 1 end)
     returning *`,
    [email, variantId, status],
  )
}
/**
 * An outbox row for a subscription, in any status (its dedupe key is this run's, so `afterAll` removes what a test leaves). It is
 * parked a day ahead, so the dispatcher the minute job starts cannot claim it while the test looks at it.
 */
async function queueMail(notificationId: string, kind: 'notify_confirm' | 'availability', status: string): Promise<Row> {
  counter += 1
  return h.row(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, next_at, lease_id, lease_until)
     values ($1, $2, 2, $3, $4::jsonb, $5::text, now() + interval '1 day', case when $5::text = 'sending' then gen_random_uuid() end, case when $5::text = 'sending' then now() + interval '1 day' end)
     returning *`,
    [`${PREFIX}${counter}`, kind, uniqueEmail('recipient'), JSON.stringify({ notificationId }), status],
  )
}
async function superuser(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  return client
}

// --- the public state -----------------------------------------------------------------------------------------------

describe('catalog_availability', () => {
  it('gives every kind of variant its public state, and leaves the disabled and the unpublished out', async () => {
    const digital = await h.digital(3500)
    const stocked = await h.physical(4000, 5)
    const outOfStock = await soldOut()
    const preorder = await preorderVariant(2)
    const digitalPreorder = await h.makeVariant({ fulfillment: 'digital', price: 3000, preorder: { capacity: 2 } })
    const full = await preorderVariant(2)
    await h.paid([{ variantId: full, quantity: 2 }])
    const late = await preorderVariant(2)
    await setVariant(late, "preorder_ships_on = '2020-01-01'")
    const today = await preorderVariant(2)
    // The delivery date counts as a day of Riyadh: today is still for sale.
    await setVariant(today, "preorder_ships_on = (now() at time zone 'Asia/Riyadh')::date")
    const unpriced = await h.physical(4000, 5)
    await setVariant(unpriced, 'price_halalas = null')
    const unpricedDigital = await h.digital(3500)
    await setVariant(unpricedDigital, 'price_halalas = null')
    const disabled = await h.physical(4000, 5)
    await setVariant(disabled, 'enabled = false')
    const unpublished = await h.physical(4000, 5)
    await h.postgres.query("update public.products set status = 'draft' where id = $1", [await productOf(unpublished)])
    const archived = await h.physical(4000, 5)
    await h.postgres.query("update public.products set status = 'archived' where id = $1", [await productOf(archived)])

    const ids = [digital, stocked, outOfStock, preorder, digitalPreorder, full, late, today, unpriced, unpricedDigital, disabled, unpublished, archived]
    const read = await anonClient().rpc('catalog_availability').in('variant_id', ids)
    expect(read.error).toBeNull()
    const states = new Map((read.data as Array<{ variant_id: string; state: string }>).map((row) => [row.variant_id, row.state]))
    expect(Object.fromEntries(['digital', 'stocked', 'outOfStock', 'preorder', 'digitalPreorder', 'full', 'late', 'today', 'unpriced', 'unpricedDigital'].map((label, i) => [label, states.get(ids[i]!)]))).toEqual({
      digital: 'available',
      stocked: 'available',
      outOfStock: 'out_of_stock',
      preorder: 'preorder',
      digitalPreorder: 'preorder',
      full: 'out_of_stock',
      late: 'out_of_stock',
      today: 'preorder',
      unpriced: 'unpriced',
      unpricedDigital: 'unpriced',
    })
    for (const hidden of [disabled, unpublished, archived]) expect(states.has(hidden)).toBe(false)
    // The same rule, read from SQL, for the variants it leaves out too: nothing.
    for (const hidden of [disabled, unpublished, archived]) expect((await h.row('select finance.variant_public_state($1) as s', [hidden])).s).toBeNull()
    expect((await h.row('select finance.variant_public_state($1) as s', [randomUUID()])).s).toBeNull()
  })

  it('follows the owner at once: a restock, a sell-out, a new price, a moved date and a raised capacity', async () => {
    const stateOf = async (variantId: string): Promise<string | null> => (await h.row('select finance.variant_public_state($1) as s', [variantId])).s as string | null
    const book = await soldOut()
    expect(await stateOf(book)).toBe('out_of_stock')
    await restock(book, 1)
    expect(await stateOf(book)).toBe('available')
    await restock(book, 0)
    expect(await stateOf(book)).toBe('out_of_stock')
    await setVariant(book, 'price_halalas = null')
    expect(await stateOf(book)).toBe('unpriced')
    await setVariant(book, 'price_halalas = 4000, stock = 3')
    expect(await stateOf(book)).toBe('available')

    const pre = await preorderVariant(1)
    expect(await stateOf(pre)).toBe('preorder')
    await h.paid([{ variantId: pre, quantity: 1 }])
    expect(await stateOf(pre)).toBe('out_of_stock')
    await setVariant(pre, 'preorder_capacity = 2')
    expect(await stateOf(pre)).toBe('preorder')
    await setVariant(pre, "preorder_ships_on = '2020-01-01'")
    expect(await stateOf(pre)).toBe('out_of_stock')
    await setVariant(pre, "preorder_ships_on = '2031-06-01'")
    expect(await stateOf(pre)).toBe('preorder')
  })

  it('ignores an unpaid hold: the last unit held by a pending order leaves the state as it was, while checkout says held', async () => {
    const last = await h.physical(4000, 1)
    const capacity = await preorderVariant(1)
    await h.place([{ variantId: last, quantity: 1 }])
    await h.place([{ variantId: capacity, quantity: 1 }])
    const read = await anonClient().rpc('catalog_availability').in('variant_id', [last, capacity])
    expect(Object.fromEntries((read.data as Array<{ variant_id: string; state: string }>).map((row) => [row.variant_id, row.state]))).toEqual({ [last]: 'available', [capacity]: 'preorder' })
    for (const variantId of [last, capacity]) {
      // The hold is real: nothing is left for another buyer, and checkout says why.
      expect(Number((await h.row('select finance.availability($1) as n', [variantId])).n)).toBe(0)
      const quote = await h.call('checkout_quote', { p_ip_hash: h.ipHash(), p_lines: [{ variantId, quantity: 1 }], p_city_key: h.city, p_coupon_code: null })
      expect(quote).toMatchObject({ ok: false, errors: [{ code: 'OUT_OF_STOCK', held: true }] })
    }
  })

  it('answers exactly two columns, and no number of any kind reaches anon', async () => {
    await h.physical(4000, 7)
    const direct = await h.postgres.query('select * from public.catalog_availability()')
    expect(direct.fields.map((field) => field.name)).toEqual(['variant_id', 'state'])
    const read = await anonClient().rpc('catalog_availability')
    expect(read.error).toBeNull()
    const rows = read.data as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['state', 'variant_id'])
      expect(Object.values(row).every((value) => typeof value === 'string')).toBe(true)
      expect(STATES).toContain(row.state)
    }
    // Nothing else of the variant opens for anon: the stock the state was made from is still not selectable.
    const stock = await anonClient().from('product_variants').select('stock')
    expect(stock.error?.code).toBe('42501')
  })

  it('is callable by a signed-in member as well as by anon, and gives them the same answer', async () => {
    const variantId = await h.physical(4000, 2)
    const member = await signIn((await h.makeStaff('editor')).email)
    const [asAnon, asMember] = await Promise.all([anonClient().rpc('catalog_availability').eq('variant_id', variantId), member.rpc('catalog_availability').eq('variant_id', variantId)])
    expect(asAnon.error).toBeNull()
    expect(asMember.error).toBeNull()
    expect(asAnon.data).toEqual([{ variant_id: variantId, state: 'available' }])
    expect(asMember.data).toEqual(asAnon.data)
  })
})

// --- the sign-up ---------------------------------------------------------------------------------------------------

describe('notify_subscribe', () => {
  it('says the same {ok: true} and stores nothing for a variant that cannot be waited for', async () => {
    const stocked = await h.physical(4000, 5)
    const digital = await h.digital()
    const preorder = await preorderVariant(2)
    const unpriced = await soldOut()
    await setVariant(unpriced, 'price_halalas = null')
    const disabled = await soldOut()
    await setVariant(disabled, 'enabled = false')
    const unpublished = await soldOut()
    await h.postgres.query("update public.products set status = 'draft' where id = $1", [await productOf(unpublished)])
    const cases = { unknown: randomUUID(), stocked, digital, preorder, unpriced, disabled, unpublished }
    for (const [label, variantId] of Object.entries(cases)) {
      const email = uniqueEmail(label)
      expect(await subscribe(variantId, { email }), label).toEqual(OK)
      expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [email]), label).toBe(0)
      expect(await h.count('select count(*)::int as n from finance.email_outbox where recipient = $1', [email]), label).toBe(0)
      expect(await availabilityOf(variantId), label).toBeUndefined()
    }
  })

  it('stores one pending row and queues one mail for a variant that is out of stock', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('first')
    expect(await subscribe(variantId, { email, consent: 7 })).toEqual(OK)
    const note = await noteOf(email, variantId)
    expect(note).toMatchObject({ status: 'pending', token_version: 1, consent_revision: 7, notified_revision: 0, confirmed_at: null, unsubscribed_at: null })
    expect(note.confirm_sent_at).toBeInstanceOf(Date)
    expect(Math.abs(note.confirm_sent_at.getTime() - Date.now())).toBeLessThan(60_000)
    const mails = await mailOf(note.id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({
      dedupe_key: `notify_confirm:${note.id}:1:${await utcDay()}`,
      kind: 'notify_confirm',
      priority: 2,
      recipient: email,
      payload: { notificationId: note.id },
    })
    // Ids only: no token, no address in the payload.
    expect(Object.keys(mails[0]!.payload)).toEqual(['notificationId'])
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 0 })
  })

  it('stores the address normalized (lower case, trimmed), and the same address in another case is the same subscription', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('Mixed')
    expect(await subscribe(variantId, { email: `  ${email.toUpperCase()} ` })).toEqual(OK)
    const note = await noteOf(email.toLowerCase(), variantId)
    expect(note.email).toBe(email.toLowerCase())
    expect((await mailOf(note.id))[0]).toMatchObject({ recipient: email.toLowerCase() })
    expect(await subscribe(variantId, { email })).toEqual(OK)
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(1)
  })

  it('stores the consent revision as given, an integer or null, and takes the latest one on a repeat', async () => {
    const variantId = await soldOut()
    const [withRevision, withNull] = [uniqueEmail('rev'), uniqueEmail('null')]
    await subscribe(variantId, { email: withRevision, consent: 12 })
    await subscribe(variantId, { email: withNull, consent: null })
    expect((await noteOf(withRevision, variantId)).consent_revision).toBe(12)
    expect((await noteOf(withNull, variantId)).consent_revision).toBeNull()
    await subscribe(variantId, { email: withNull, consent: 13 })
    expect((await noteOf(withNull, variantId)).consent_revision).toBe(13)
  })

  it('stores a second sign-up of the same address the same day for another variant, with no second mail', async () => {
    const [first, second] = [await soldOut(), await soldOut()]
    const email = uniqueEmail('two-variants')
    expect(await subscribe(first, { email })).toEqual(OK)
    expect(await subscribe(second, { email })).toEqual(OK)
    const [a, b] = [await noteOf(email, first), await noteOf(email, second)]
    expect(b).toMatchObject({ status: 'pending', token_version: 1, confirm_sent_at: null })
    expect(await mailOf(a.id)).toHaveLength(1)
    expect(await mailOf(b.id)).toHaveLength(0)
    expect(await h.count('select count(*)::int as n from finance.email_outbox where recipient = $1', [email])).toBe(1)
    // The row and the variant's availability row exist all the same, so the notice will come.
    expect(await availabilityOf(second)).toMatchObject({ sellable: false, revision: 0 })
    // Another address the same day is not held back by it.
    const other = uniqueEmail('other')
    await subscribe(second, { email: other })
    expect(await mailOf((await noteOf(other, second)).id)).toHaveLength(1)
  })

  it('queues one mail for a repeat of the same sign-up the same day: one row, one mail, the older link still the one sent', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('repeat')
    await subscribe(variantId, { email })
    const before = await noteOf(email, variantId)
    await subscribe(variantId, { email })
    await subscribe(variantId, { email })
    const after = await noteOf(email, variantId)
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(1)
    expect(await mailOf(after.id)).toHaveLength(1)
    expect(after.id).toBe(before.id)
    expect(after.confirm_sent_at).toEqual(before.confirm_sent_at)
  })

  it('does not spend the address or the day on a request that was refused', async () => {
    const [variantId, gone] = [await soldOut(), randomUUID()]
    const email = uniqueEmail('refused')
    await subscribe(gone, { email })
    await subscribe(await h.physical(4000, 5), { email })
    expect(await h.count("select count(*)::int as n from finance.rate_limits where bucket = 'notify-confirm:all'")).toBe(0)
    // Its one mail of the day is still there to be spent on the real request.
    await subscribe(variantId, { email })
    expect(await mailOf((await noteOf(email, variantId)).id)).toHaveLength(1)
    expect(await h.count("select hits::int as n from finance.rate_limits where bucket = 'notify-confirm:all'")).toBe(1)
  })

  it('stores the row and queues no mail once the day has sent 30, and says the same', async () => {
    const variantId = await soldOut()
    const emails = Array.from({ length: 31 }, (_, i) => uniqueEmail(`day-${i}`))
    for (const email of emails) expect(await subscribe(variantId, { email })).toEqual(OK)
    const mailed = await h.count("select count(*)::int as n from finance.email_outbox where kind = 'notify_confirm' and recipient = any($1::text[])", [emails])
    expect(mailed).toBe(30)
    const last = await noteOf(emails[30]!, variantId)
    expect(last).toMatchObject({ status: 'pending', confirm_sent_at: null })
    expect(await mailOf(last.id)).toHaveLength(0)
    expect(await noteOf(emails[29]!, variantId)).toMatchObject({ status: 'pending' })
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(31)
    // The address that was turned away today still has its own allowance tomorrow: the cap was the day's, not the address's.
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:all'")
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(emails[30]!)])
    await subscribe(variantId, { email: emails[30]! })
    expect(await mailOf(last.id)).toHaveLength(1)
  })

  it('throttles one caller at 5 an hour with 54000 and says nothing of the address or the variant; another caller is not held back', async () => {
    const variantId = await soldOut()
    const ip = h.ipHash()
    for (let i = 0; i < 5; i += 1) expect(await subscribe(i % 2 === 0 ? variantId : randomUUID(), { ip })).toEqual(OK)
    // The sixth is refused whatever it asks for: a real variant, an unknown one, an address already stored, a malformed one is not even asked.
    const email = uniqueEmail('throttled')
    await expect(subscribe(variantId, { ip, email })).rejects.toMatchObject({ code: '54000' })
    await expect(subscribe(randomUUID(), { ip, email: uniqueEmail('anyone') })).rejects.toMatchObject({ code: '54000' })
    expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [email])).toBe(0)
    expect(await subscribe(variantId, { ip: h.ipHash(), email })).toEqual(OK)
    expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [email])).toBe(1)
  })

  it('leaves a confirmed row exactly as it is: no change, no mail, whatever the repeat says', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('confirmed')
    const id = await confirmed(variantId, email)
    const before = await noteById(id)
    expect(before).toMatchObject({ status: 'confirmed' })
    // Its allowance for the day is back, so nothing but the status can be why no mail goes.
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(email)])
    const mailsBefore = (await mailOf(id)).length
    expect(await subscribe(variantId, { email: email.toUpperCase(), consent: 99 })).toEqual(OK)
    expect(await noteById(id)).toEqual(before)
    expect(await mailOf(id)).toHaveLength(mailsBefore)
    expect(await h.count("select count(*)::int as n from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(email)])).toBe(0)
  })

  it('re-opens an unsubscribed row as pending: the same row, a new version, no old link alive and a new mail', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('back')
    const id = await confirmed(variantId, email)
    expect(await h.call('notify_unsubscribe', { p_id: id, p_token_version: 1 })).toMatchObject({ ok: true })
    expect(await noteById(id)).toMatchObject({ status: 'unsubscribed', token_version: 2 })

    // The same day: the address has had its mail, so the row comes back without one.
    expect(await subscribe(variantId, { email, consent: 5 })).toEqual(OK)
    expect(await noteById(id)).toMatchObject({ status: 'pending', token_version: 2, consent_revision: 5, confirmed_at: null, unsubscribed_at: null, confirm_sent_at: null })
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(1)
    expect((await mailOf(id)).filter((mail) => mail.status === 'pending')).toHaveLength(0)
    // Its old links stay dead: version 1 is gone, and the new one has not been mailed yet.
    expect(await h.call('notify_confirm', { p_id: id, p_token_version: 1 })).toEqual(NOT_FOUND)

    // Another day: the mail is queued for the new version.
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(email)])
    expect(await subscribe(variantId, { email })).toEqual(OK)
    const after = await noteById(id)
    expect(after.confirm_sent_at).toBeInstanceOf(Date)
    const mails = await mailOf(id)
    expect(mails.map((mail) => mail.dedupe_key)).toEqual([`notify_confirm:${id}:2:${await utcDay()}`])
  })

  it('makes a stale `sellable = true` false again, so a restock after the sign-up is a transition the sweep sees', async () => {
    const variantId = await soldOut()
    await h.postgres.query('insert into finance.variant_availability (variant_id, sellable, revision) values ($1, true, 3)', [variantId])
    const email = uniqueEmail('stale')
    await subscribe(variantId, { email })
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 3 })
    const note = await noteOf(email, variantId)
    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toMatchObject({ ok: true })
    await restock(variantId)
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 4 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:4:${note.id}`])
  })

  it('decides under the availability row: a sign-up that waited behind a sweep which saw a restock stores nothing and does not undo the sweep', async () => {
    const variantId = await soldOut()
    const waiting = await confirmed(variantId)
    const email = uniqueEmail('late')
    const holder = await superuser()
    try {
      await holder.query('begin')
      await holder.query('select 1 from finance.variant_availability where variant_id = $1 for update', [variantId])
      // The sign-up reads "out of stock", then waits for the row.
      const pending = subscribe(variantId, { email }, h.pool[1])
      expect(await settledWithin(pending)).toBe('blocked')
      // The owner restocks, and the sweep that holds the row tells the subscriber.
      await holder.query('update public.product_variants set stock = 5 where id = $1', [variantId])
      await sweep(holder)
      await holder.query('commit')
      expect(await pending).toEqual(OK)
    } finally {
      await holder.query('rollback').catch(() => undefined)
      await holder.end()
    }
    // The variant is on sale: no subscription for it, and the row is as the sweep left it.
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect(await h.rows('select 1 from public.notifications where email = $1', [email])).toHaveLength(0)
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${waiting}`])
  })

  it('makes one row and one mail of two sign-ups at once for one address and variant', async () => {
    const variantId = await soldOut()
    await h.postgres.query('insert into finance.variant_availability (variant_id) values ($1)', [variantId])
    const email = uniqueEmail('twice')
    // Both wait for the variant's availability row, the first lock a sign-up takes, then race.
    const held = await h.holdLock('select 1 from finance.variant_availability where variant_id = $1 for update', [variantId])
    const first = subscribe(variantId, { email }, h.pool[1])
    const second = subscribe(variantId, { email }, h.pool[2])
    expect(await settledWithin(first)).toBe('blocked')
    expect(await settledWithin(second)).toBe('blocked')
    await held.release()
    expect(await first).toEqual(OK)
    expect(await second).toEqual(OK)
    const note = await noteOf(email, variantId)
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(1)
    expect(await mailOf(note.id)).toHaveLength(1)
    expect(note.confirm_sent_at).toBeInstanceOf(Date)
  })

  it('refuses a malformed call by raising, before anything is stored and whatever the variant', async () => {
    const variantId = await soldOut()
    const good = { p_ip_hash: h.ipHash(), p_email: uniqueEmail('bad'), p_variant: variantId, p_consent_revision: 1 }
    const bad: Array<[string, Record<string, unknown>]> = [
      ['a caller hash that is not a hash', { p_ip_hash: 'not-a-hash' }],
      ['no caller hash', { p_ip_hash: null }],
      ['an upper-case caller hash', { p_ip_hash: h.ipHash().toUpperCase() }],
      ['no address', { p_email: null }],
      ['an address that is not one', { p_email: 'not-an-address' }],
      ['an address with a space', { p_email: 'two words@example.com' }],
      ['an address that could carry a header', { p_email: 'x@evil.test?bcc=y@z.co' }],
      ['an address of 255 characters', { p_email: `${'a'.repeat(250)}@x.co` }],
      ['no variant', { p_variant: null }],
    ]
    for (const [label, over] of bad) {
      await expect(h.call('notify_subscribe', { ...good, ...over }), label).rejects.toMatchObject({ code: '22023' })
    }
    // The same malformed address is refused for a variant that does not exist too: nothing depends on the variant.
    await expect(h.call('notify_subscribe', { ...good, p_variant: randomUUID(), p_email: 'not-an-address' })).rejects.toMatchObject({ code: '22023' })
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [variantId])).toBe(0)
  })
})

// --- the links -----------------------------------------------------------------------------------------------------

describe('notify_token_info, notify_confirm and notify_unsubscribe', () => {
  it('reports the version, the status and when the confirmation mail was queued, and null for an id nobody has', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('info')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    const info = await h.call('notify_token_info', { p_id: note.id })
    expect(Object.keys(info).sort()).toEqual(['confirmSentAt', 'status', 'tokenVersion'])
    expect(info).toMatchObject({ tokenVersion: 1, status: 'pending' })
    expect(Math.abs(Date.parse(info.confirmSentAt) - Date.now())).toBeLessThan(60_000)
    expect(await h.call('notify_token_info', { p_id: randomUUID() })).toBeNull()
    await h.call('notify_unsubscribe', { p_id: note.id, p_token_version: 1 })
    expect(await h.call('notify_token_info', { p_id: note.id })).toMatchObject({ tokenVersion: 2, status: 'unsubscribed' })
    // A row that never got a mail has no confirmation time.
    const silent = await insertNote(variantId, 'pending')
    await h.postgres.query('update public.notifications set confirm_sent_at = null where id = $1', [silent.id])
    expect((await h.call('notify_token_info', { p_id: silent.id })).confirmSentAt).toBeNull()
  })

  it('confirms a pending row at the version of its link, once, and answers the same success to a repeat', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('confirm')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toEqual({ ok: true, status: 'confirmed' })
    const once = await noteById(note.id)
    expect(once).toMatchObject({ status: 'confirmed', token_version: 1, unsubscribed_at: null })
    expect(once.confirmed_at).toBeInstanceOf(Date)
    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toEqual({ ok: true, status: 'confirmed' })
    expect((await noteById(note.id)).confirmed_at).toEqual(once.confirmed_at)
  })

  it('refuses every other confirm with NOT_FOUND and moves nothing: the wrong version, an unknown id, an unsubscribed row', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('refuse')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    for (const version of [0, 2, 3, -1]) expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: version }), `version ${version}`).toEqual(NOT_FOUND)
    expect(await h.call('notify_confirm', { p_id: randomUUID(), p_token_version: 1 })).toEqual(NOT_FOUND)
    expect(await noteById(note.id)).toEqual(note)
    // An unsubscribed row cannot be confirmed, at its old version or at its current one.
    await h.call('notify_unsubscribe', { p_id: note.id, p_token_version: 1 })
    const gone = await noteById(note.id)
    for (const version of [1, 2]) expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: version }), `version ${version}`).toEqual(NOT_FOUND)
    expect(await noteById(note.id)).toEqual(gone)
    // A call with no id or no version is malformed, not a refusal.
    await expect(h.call('notify_confirm', { p_id: null, p_token_version: 1 })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('notify_confirm', { p_id: note.id, p_token_version: null })).rejects.toMatchObject({ code: '22023' })
  })

  it('unsubscribes a pending row and a confirmed one, moves the version on so every older link dies, and says so once', async () => {
    const variantId = await soldOut()
    const pendingEmail = uniqueEmail('pending')
    await subscribe(variantId, { email: pendingEmail })
    const pending = await noteOf(pendingEmail, variantId)
    const confirmedId = await confirmed(variantId)

    for (const id of [pending.id as string, confirmedId]) {
      expect(await h.call('notify_unsubscribe', { p_id: id, p_token_version: 1 })).toEqual({ ok: true, status: 'unsubscribed' })
      const row = await noteById(id)
      expect(row).toMatchObject({ status: 'unsubscribed', token_version: 2 })
      expect(row.unsubscribed_at).toBeInstanceOf(Date)
      // The link that did it is dead, and so is every other of version 1.
      expect(await h.call('notify_unsubscribe', { p_id: id, p_token_version: 1 })).toEqual(NOT_FOUND)
      expect(await h.call('notify_confirm', { p_id: id, p_token_version: 1 })).toEqual(NOT_FOUND)
      // The version it moved to was never mailed; a row that is unsubscribed is not unsubscribed again.
      expect(await h.call('notify_unsubscribe', { p_id: id, p_token_version: 2 })).toEqual(NOT_FOUND)
      expect(await noteById(id)).toEqual(row)
    }
  })

  it('refuses an unsubscribe for a wrong version or an unknown id with NOT_FOUND and moves nothing', async () => {
    const variantId = await soldOut()
    const id = await confirmed(variantId)
    const before = await noteById(id)
    for (const version of [0, 2, 9]) expect(await h.call('notify_unsubscribe', { p_id: id, p_token_version: version }), `version ${version}`).toEqual(NOT_FOUND)
    expect(await h.call('notify_unsubscribe', { p_id: randomUUID(), p_token_version: 1 })).toEqual(NOT_FOUND)
    expect(await noteById(id)).toEqual(before)
    await expect(h.call('notify_unsubscribe', { p_id: null, p_token_version: 1 })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('notify_unsubscribe', { p_id: id, p_token_version: null })).rejects.toMatchObject({ code: '22023' })
  })

  it('takes the unsent mail of an unsubscribed row with it, and keeps what was sent, what is being sent and everyone else\'s', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('mail')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    expect(await mailOf(note.id)).toHaveLength(1)
    const unsent = [await queueMail(note.id, 'availability', 'pending'), await queueMail(note.id, 'availability', 'uncertain'), await queueMail(note.id, 'notify_confirm', 'exhausted'), await queueMail(note.id, 'availability', 'suppressed')]
    const kept = [await queueMail(note.id, 'notify_confirm', 'sent'), await queueMail(note.id, 'availability', 'sending')]
    const bystander = await insertNote(variantId, 'confirmed')
    const others = [await queueMail(bystander.id, 'availability', 'pending'), await queueMail(randomUUID(), 'availability', 'pending')]

    expect(await h.call('notify_unsubscribe', { p_id: note.id, p_token_version: 1 })).toMatchObject({ ok: true })
    const left = await h.rows('select id, status from finance.email_outbox where id = any($1::bigint[])', [[...unsent, ...kept, ...others].map((mail) => mail.id)])
    expect(left.map((mail) => String(mail.id)).sort()).toEqual([...kept, ...others].map((mail) => String(mail.id)).sort())
    // Nothing of its is left to be sent.
    expect((await mailOf(note.id)).filter((mail) => ['pending', 'uncertain'].includes(mail.status))).toEqual([])
    // A refused unsubscribe takes nothing: the bystander's mail is still there after one with a wrong version.
    expect(await h.call('notify_unsubscribe', { p_id: bystander.id, p_token_version: 7 })).toEqual(NOT_FOUND)
    expect((await mailOf(bystander.id)).map((mail) => String(mail.id))).toEqual([String(others[0]!.id)])
  })

  it('answers two confirms at once with the same success, and two unsubscribes at once with one success and one NOT_FOUND', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('race')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    for (const [fn, expected] of [
      ['notify_confirm', [{ ok: true, status: 'confirmed' }, { ok: true, status: 'confirmed' }]],
      ['notify_unsubscribe', [NOT_FOUND, { ok: true, status: 'unsubscribed' }]],
    ] as const) {
      const held = await h.holdLock('select 1 from public.notifications where id = $1 for update', [note.id])
      const calls = [h.call(fn, { p_id: note.id, p_token_version: 1 }, h.pool[1]), h.call(fn, { p_id: note.id, p_token_version: 1 }, h.pool[2])]
      expect(await settledWithin(calls[0]!)).toBe('blocked')
      expect(await settledWithin(calls[1]!)).toBe('blocked')
      await held.release()
      const answers = (await Promise.all(calls)).sort((a, b) => Number(b.ok) - Number(a.ok))
      expect(answers, fn).toEqual([...expected].sort((a, b) => Number(b.ok) - Number(a.ok)))
    }
    expect(await noteById(note.id)).toMatchObject({ status: 'unsubscribed', token_version: 2 })
  })

  it('throttles the two link actions at 60 an hour per caller with 54000, and another caller is not held back', async () => {
    const ip = h.ipHash()
    // The function answers nothing (void); a refusal is the only way it speaks.
    for (let i = 0; i < 60; i += 1) await h.call('notify_link_throttle', { p_ip_hash: ip })
    await expect(h.call('notify_link_throttle', { p_ip_hash: ip })).rejects.toMatchObject({ code: '54000' })
    await h.call('notify_link_throttle', { p_ip_hash: h.ipHash() })
    for (const bad of ['x', null, h.ipHash().toUpperCase()]) await expect(h.call('notify_link_throttle', { p_ip_hash: bad })).rejects.toMatchObject({ code: '22023' })
  })
})

// --- the sweep ------------------------------------------------------------------------------------------------------

describe('finance.availability_sweep', () => {
  it('queues one availability mail per confirmed subscriber when a variant comes back, and never to a pending or an unsubscribed one', async () => {
    const variantId = await soldOut()
    const confirmedNotes = [await insertNote(variantId, 'confirmed'), await insertNote(variantId, 'confirmed'), await insertNote(variantId, 'confirmed')]
    const pending = await insertNote(variantId, 'pending')
    const gone = await insertNote(variantId, 'unsubscribed')

    // Out of stock: nothing is queued and nothing changes.
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 0 })
    expect(await availabilityMail(variantId)).toHaveLength(0)

    await restock(variantId)
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    const mails = await availabilityMail(variantId)
    expect(mails.map((mail) => mail.dedupe_key).sort()).toEqual(confirmedNotes.map((note) => `availability:${variantId}:1:${note.id}`).sort())
    for (const mail of mails) {
      const note = confirmedNotes.find((candidate) => mail.payload.notificationId === candidate.id)!
      expect(mail).toMatchObject({ kind: 'availability', priority: 2, recipient: note.email, payload: { notificationId: note.id } })
      expect(Object.keys(mail.payload)).toEqual(['notificationId'])
    }
    for (const note of confirmedNotes) expect((await noteById(note.id)).notified_revision).toBe(1)
    for (const note of [pending, gone]) {
      expect((await noteById(note.id)).notified_revision).toBe(0)
      expect(await mailOf(note.id)).toHaveLength(0)
    }
    // It returns the mails it queued (a whole number; the minute job may have been first).
    const again = (await sweep()) as { rows: Array<{ n: number }> }
    expect(Number.isInteger(again.rows[0]!.n)).toBe(true)
  })

  it('queues nothing on a second run, and again nothing on a third', async () => {
    const variantId = await soldOut()
    await insertNote(variantId, 'confirmed')
    await insertNote(variantId, 'confirmed')
    await restock(variantId)
    await sweep()
    const settled = await availabilityOf(variantId)
    const mails = await availabilityMail(variantId)
    expect(mails).toHaveLength(2)
    for (let run = 0; run < 2; run += 1) {
      const result = (await sweep()) as { rows: Array<{ n: number }> }
      expect(await availabilityOf(variantId)).toEqual(settled)
      expect((await availabilityMail(variantId)).map((mail) => mail.id)).toEqual(mails.map((mail) => mail.id))
      expect(result.rows[0]!.n).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps a notice single when one for the same revision and subscriber is already queued (a retried run), and still marks the subscriber told', async () => {
    const variantId = await soldOut()
    const note = await insertNote(variantId, 'confirmed')
    await restock(variantId)
    // An earlier run that was cut off after queueing its notice: the dedupe key is all that is left of it.
    const key = `availability:${variantId}:1:${note.id}`
    await h.postgres.query(
      "insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, next_at) values ($1, 'availability', 2, $2, $3::jsonb, now() + interval '1 day')",
      [key, note.email, JSON.stringify({ notificationId: note.id })],
    )
    await sweep()
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([key])
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await noteById(note.id)).notified_revision).toBe(1)
  })

  it('treats true to false to true as a new revision and mails the subscribers again, once', async () => {
    const variantId = await soldOut()
    const note = await insertNote(variantId, 'confirmed')
    await restock(variantId)
    await sweep()
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${note.id}`])

    await restock(variantId, 0)
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 1 })
    expect(await availabilityMail(variantId)).toHaveLength(1)
    expect((await noteById(note.id)).notified_revision).toBe(1)

    await restock(variantId, 2)
    await sweep()
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 2 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${note.id}`, `availability:${variantId}:2:${note.id}`])
    expect((await noteById(note.id)).notified_revision).toBe(2)
  })

  it('mails a subscriber who confirms after the restock at the next sweep: the row started false', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('late')
    expect(await subscribe(variantId, { email })).toEqual(OK)
    const note = await noteOf(email, variantId)
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 0 })

    // The owner restocks while the subscriber has not confirmed yet: nobody is waiting, so the variant is not even read.
    await restock(variantId)
    const before = await availabilityOf(variantId)
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(before)
    expect(await availabilityMail(variantId)).toHaveLength(0)

    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toMatchObject({ ok: true })
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${note.id}`])
    expect((await noteById(note.id)).notified_revision).toBe(1)
  })

  it('mails a subscriber who confirms after the restock even though another subscriber already turned the row true', async () => {
    const variantId = await soldOut()
    const early = await confirmed(variantId)
    const email = uniqueEmail('late-pair')
    expect(await subscribe(variantId, { email })).toEqual(OK)
    const late = await noteOf(email, variantId)

    // The restock: the early subscriber's notice turns the row true, and the pending one is not told.
    await restock(variantId)
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${early}`])

    // It confirms now, with the variant in stock and the row already true: the next sweep tells it, at the same revision.
    expect(await h.call('notify_confirm', { p_id: late.id, p_token_version: 1 })).toMatchObject({ ok: true })
    await sweep()
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key).sort()).toEqual([`availability:${variantId}:1:${early}`, `availability:${variantId}:1:${late.id}`].sort())
    expect((await noteById(late.id)).notified_revision).toBe(1)
    expect((await noteById(early)).notified_revision).toBe(1)
  })

  it('mails a subscriber who confirms while the variant is in stock and its row is already true (a stale true), once, at the revision of the row', async () => {
    const variantId = await h.physical(4000, 3)
    // A true left by an earlier cycle: nobody confirmed was waiting when the stock went, so no run made it false.
    await h.postgres.query('insert into finance.variant_availability (variant_id, sellable, revision) values ($1, true, 3)', [variantId])
    const note = await insertNote(variantId, 'pending')
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 3 })
    expect(await availabilityMail(variantId)).toHaveLength(0)

    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toMatchObject({ ok: true })
    await sweep()
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 3 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:3:${note.id}`])
    expect((await noteById(note.id)).notified_revision).toBe(3)
  })

  it('is not moved by a hold that comes and goes: an unpaid hold on the last unit, its release by the buyer and its expiry change nothing', async () => {
    const variantId = await h.physical(4000, 1)
    await insertNote(variantId, 'confirmed')
    await sweep()
    const settled = await availabilityOf(variantId)
    expect(settled).toMatchObject({ sellable: true, revision: 1 })
    const mails = (await availabilityMail(variantId)).map((mail) => mail.id)
    expect(mails).toHaveLength(1)
    const available = async (): Promise<number> => Number((await h.row('select finance.availability($1) as n', [variantId])).n)

    // An order holds the last unit: for the buyers' checkout there is nothing left, for the sweep the variant is as it was.
    const cancelled = await h.place([{ variantId, quantity: 1 }])
    expect(await available()).toBe(0)
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(settled)
    // The buyer lets it go: the unit is back, and still nothing happened.
    expect(await h.call('checkout_cancel', { p_order_number: cancelled.number, p_access_token_hash: cancelled.hash })).toMatchObject({ ok: true })
    expect(await available()).toBe(1)
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(settled)

    // The same with a hold that runs out by its clock.
    const expiring = await h.place([{ variantId, quantity: 1 }])
    expect(await available()).toBe(0)
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(settled)
    await h.postgres.query("update finance.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [expiring.id])
    expect(await available()).toBe(1)
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(settled)
    expect((await availabilityMail(variantId)).map((mail) => mail.id)).toEqual(mails)
  })

  it('queues each mail once when two sweeps run at once', async () => {
    const variantId = await soldOut()
    const notes = [await insertNote(variantId, 'confirmed'), await insertNote(variantId, 'confirmed'), await insertNote(variantId, 'confirmed'), await insertNote(variantId, 'confirmed')]
    await restock(variantId)
    const [first, second] = [await superuser(), await superuser()]
    try {
      // Both wait for the variant's availability row, then run one after the other.
      const held = await h.holdLock('select 1 from finance.variant_availability where variant_id = $1 for update', [variantId])
      const runs = [sweep(first), sweep(second)]
      expect(await settledWithin(runs[0]!)).toBe('blocked')
      expect(await settledWithin(runs[1]!)).toBe('blocked')
      await held.release()
      await Promise.all(runs)
    } finally {
      await first.end()
      await second.end()
    }
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key).sort()).toEqual(notes.map((note) => `availability:${variantId}:1:${note.id}`).sort())
    for (const note of notes) expect((await noteById(note.id)).notified_revision).toBe(1)
  })

  it('does not touch a variant that has no confirmed subscriber', async () => {
    const variantId = await soldOut()
    await insertNote(variantId, 'pending')
    await insertNote(variantId, 'unsubscribed')
    await restock(variantId)
    const before = await availabilityOf(variantId)
    await sweep()
    await sweep()
    expect(await availabilityOf(variantId)).toEqual(before)
    expect(before).toMatchObject({ sellable: false, revision: 0 })
    expect(await availabilityMail(variantId)).toHaveLength(0)
  })

  it('stores false when the variant leaves the shelf, and a return to it is a new revision', async () => {
    const variantId = await h.physical(4000, 3)
    const note = await insertNote(variantId, 'confirmed')
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })

    // Disabled, unpublished and unpriced are each "not sellable", with stock on the shelf all the time.
    const leave: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
      ['disabled', () => setVariant(variantId, 'enabled = false'), () => setVariant(variantId, 'enabled = true')],
      ['unpublished', async () => h.postgres.query("update public.products set status = 'draft' where id = $1", [await productOf(variantId)]), async () => h.postgres.query("update public.products set status = 'published' where id = $1", [await productOf(variantId)])],
      ['unpriced', () => setVariant(variantId, 'price_halalas = null'), () => setVariant(variantId, 'price_halalas = 4000')],
    ]
    let revision = 1
    for (const [label, away, back] of leave) {
      await away()
      await sweep()
      expect(await availabilityOf(variantId), label).toMatchObject({ sellable: false, revision })
      await back()
      await sweep()
      revision += 1
      expect(await availabilityOf(variantId), label).toMatchObject({ sellable: true, revision })
    }
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([1, 2, 3, 4].map((revision) => `availability:${variantId}:${revision}:${note.id}`))
  })

  it('counts a preorder as sellable, so moving its date or raising its capacity is what brings a subscriber back', async () => {
    // A preorder past its date is out of stock for the visitor, and can be waited for.
    const late = await preorderVariant(3)
    await setVariant(late, "preorder_ships_on = '2020-01-01'")
    const email = uniqueEmail('preorder')
    expect(await subscribe(late, { email })).toEqual(OK)
    const note = await noteOf(email, late)
    expect(await h.call('notify_confirm', { p_id: note.id, p_token_version: 1 })).toMatchObject({ ok: true })
    await sweep()
    expect(await availabilityOf(late)).toMatchObject({ sellable: false, revision: 0 })
    await setVariant(late, "preorder_ships_on = '2099-01-01'")
    await sweep()
    expect(await availabilityOf(late)).toMatchObject({ sellable: true, revision: 1 })
    expect(await availabilityMail(late)).toHaveLength(1)

    // A preorder that is full: the owner raises its capacity.
    const full = await preorderVariant(1)
    await h.paid([{ variantId: full, quantity: 1 }])
    const waiting = await confirmed(full)
    await sweep()
    expect(await availabilityOf(full)).toMatchObject({ sellable: false, revision: 0 })
    await setVariant(full, 'preorder_capacity = 3')
    await sweep()
    expect(await availabilityOf(full)).toMatchObject({ sellable: true, revision: 1 })
    expect((await availabilityMail(full)).map((mail) => mail.dedupe_key)).toEqual([`availability:${full}:1:${waiting}`])
  })

  it('does nothing while checkout is switched off, and tells the subscribers once it opens', async () => {
    const variantId = await soldOut()
    const note = await insertNote(variantId, 'confirmed')
    await restock(variantId)
    await h.postgres.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
    try {
      await sweep()
      expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 0 })
      expect(await availabilityMail(variantId)).toHaveLength(0)
    } finally {
      await h.postgres.query('update finance.commerce_settings set checkout_enabled = true where id = 1')
    }
    await sweep()
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${note.id}`])
    // Closing and opening the shop again tells nobody twice.
    await h.postgres.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
    try {
      await sweep()
    } finally {
      await h.postgres.query('update finance.commerce_settings set checkout_enabled = true where id = 1')
    }
    await sweep()
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
    expect(await availabilityMail(variantId)).toHaveLength(1)
  })

  // FABLE-AUDIT M2-7 (FIX-A2-04): the switch alone is not an open store. The store is closed here before the restock, so
  // the minute job, which reads the same settings, cannot send the notice in between.
  it('does nothing while checkout is closed in effect though the switch is on (the policies unapproved, the seller unregistered), and spends no notice', async () => {
    const variantId = await soldOut()
    const note = await insertNote(variantId, 'confirmed')
    const settings = await h.row('select checkout_enabled, seller_registration, policy_revisions from finance.commerce_settings where id = 1')
    expect(settings.checkout_enabled).toBe(true)
    const restore = (): Promise<unknown> =>
      h.postgres.query('update finance.commerce_settings set seller_registration = $1, policy_revisions = $2::jsonb where id = 1', [
        settings.seller_registration,
        JSON.stringify(settings.policy_revisions),
      ])
    for (const [label, closing] of [
      ['the policies unapproved', "policy_revisions = '{}'::jsonb"],
      ['the seller unregistered', 'seller_registration = null'],
    ] as const) {
      await h.postgres.query(`update finance.commerce_settings set ${closing} where id = 1`)
      try {
        await restock(variantId)
        await sweep()
        expect(await availabilityOf(variantId), label).toMatchObject({ sellable: false, revision: 0 })
        expect(await availabilityMail(variantId), label).toHaveLength(0)
        expect((await noteById(note.id)).notified_revision, label).toBe(0)
      } finally {
        await setVariant(variantId, 'stock = 0')
        await restore()
      }
    }
    // Open again: the subscriber is told once.
    await restock(variantId)
    await sweep()
    expect((await availabilityMail(variantId)).map((mail) => mail.dedupe_key)).toEqual([`availability:${variantId}:1:${note.id}`])
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: true, revision: 1 })
  })

  it('is scheduled every minute, and nothing but the migration role and pg_cron can run it', async () => {
    const job = await h.row("select schedule, command from cron.job where jobname = 'availability-sweep'")
    expect(job).toEqual({ schedule: '* * * * *', command: 'select finance.availability_sweep()' })
  })
})

// --- the backlog -----------------------------------------------------------------------------------------------------

describe('finance.notify_confirm_backlog and the caps of a confirmation mail', () => {
  const backlog = (): Promise<unknown> => h.postgres.query('select finance.notify_confirm_backlog() as n')
  /** A new day for one address. */
  const nextDay = async (email: string): Promise<void> => {
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(email)])
    await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:all'")
  }
  /** Leaves only this row in the backlog: what other tests left waiting must not spend the day before it. */
  const alone = (id: string): Promise<unknown> =>
    h.postgres.query("update public.notifications set confirm_sent_at = now() where status = 'pending' and confirm_sent_at is null and id <> $1", [id])

  it('queues the confirmation a cap held back, once the cap allows: the second variant of one address gets its mail the next day, once', async () => {
    const [first, second] = [await soldOut(), await soldOut()]
    const email = uniqueEmail('two-items')
    expect(await subscribe(first, { email })).toEqual(OK)
    expect(await subscribe(second, { email })).toEqual(OK)
    const held = await noteOf(email, second)
    expect(held.confirm_sent_at).toBeNull()
    await alone(held.id)
    // Still today: the address has had its mail.
    await backlog()
    expect(await mailOf(held.id)).toHaveLength(0)
    await nextDay(email)
    await backlog()
    expect((await mailOf(held.id)).map((mail) => mail.kind)).toEqual(['notify_confirm'])
    expect((await noteById(held.id)).confirm_sent_at).toBeInstanceOf(Date)
    // A row that has its mail is no longer in the backlog.
    await nextDay(email)
    await backlog()
    expect(await mailOf(held.id)).toHaveLength(1)
  })

  it('queues what the day\'s total held back, and stops when the day is spent again', async () => {
    const variantId = await soldOut()
    const emails = Array.from({ length: 32 }, (_, i) => uniqueEmail(`backlog-${i}`))
    for (const email of emails) expect(await subscribe(variantId, { email })).toEqual(OK)
    const late = [await noteOf(emails[30]!, variantId), await noteOf(emails[31]!, variantId)]
    for (const note of late) expect(note.confirm_sent_at).toBeNull()
    await h.postgres.query("update public.notifications set confirm_sent_at = now() where status = 'pending' and confirm_sent_at is null and id <> all($1::uuid[])", [late.map((note) => note.id)])
    // One slot left in the new day: the one that waited longest takes it.
    await nextDay(emails[30]!)
    await nextDay(emails[31]!)
    await h.postgres.query("insert into finance.rate_limits (bucket, key_hash, window_start, hits) select 'notify-confirm:all', repeat('0', 64), to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 29")
    await backlog()
    expect(await mailOf(late[0]!.id)).toHaveLength(1)
    expect(await mailOf(late[1]!.id)).toHaveLength(0)
  })

  it('stops at five confirmation mails to one address in 30 days, whoever asks and however often, and the backlog does not get round it', async () => {
    const email = uniqueEmail('victim')
    const variants: string[] = []
    for (let i = 0; i < 6; i += 1) {
      variants.push(await soldOut())
      await nextDay(email)
      expect(await subscribe(variants[i]!, { email })).toEqual(OK)
    }
    const mails = (): Promise<number> => h.count("select count(*)::int as n from finance.email_outbox where kind = 'notify_confirm' and recipient = $1", [email])
    expect(await mails()).toBe(5)
    const sixth = await noteOf(email, variants[5]!)
    expect(sixth).toMatchObject({ status: 'pending', confirm_sent_at: null })
    await alone(sixth.id)
    await nextDay(email)
    await backlog()
    expect(await mails()).toBe(5)
    // A month on, the oldest mail no longer counts.
    await h.postgres.query("update finance.email_outbox set created_at = now() - interval '31 days' where kind = 'notify_confirm' and recipient = $1", [email])
    await nextDay(email)
    await backlog()
    expect(await mailOf(sixth.id)).toHaveLength(1)
  })

  it('is scheduled hourly', async () => {
    const job = await h.row("select schedule, command from cron.job where jobname = 'notify-confirm-backlog'")
    expect(job).toEqual({ schedule: '17 * * * *', command: 'select finance.notify_confirm_backlog()' })
  })
})

// --- the bounce brake ------------------------------------------------------------------------------------------------

// FABLE-AUDIT M2-6 (VENDOR-PAY-02): a confirmation goes to an address a visitor typed. More than 3 of them bounced or
// complained in the last 7 days, and nothing more is queued until the run of bounces ages out; the owners are told
// once a day.
describe('finance.notify_confirm_queue: the bounce brake', () => {
  beforeAll(async () => {
    // Someone to tell.
    await h.makeStaff('owner')
  })

  type Outcome = { reply: unknown; note: Row; mails: Row[]; alerts: Row[]; allowance: number; backlog: number }
  /**
   * One sign-up for a sold-out variant, in a transaction on a superuser session that is rolled back: the
   * confirmations sent in the last 7 days are made to bounce `recent` times, with `older` more bounces sent 8 days
   * ago (every other confirmation's delivery is cleared inside it, so the count is the test's own), and the visitor
   * signs up as the service role does. Answers what the sign-up stored and queued, the day's brake alerts, the
   * allowance the address spent, and what the hourly backlog then queued.
   */
  async function signUpWith(recent: number, older = 0): Promise<Outcome> {
    const variantId = await soldOut()
    const email = uniqueEmail('braked')
    const client = await superuser()
    await client.query('begin')
    try {
      await client.query("update finance.email_outbox set delivery = null where kind = 'notify_confirm' and delivery in ('bounced', 'complained')")
      for (let i = 0; i < recent + older; i += 1) {
        counter += 1
        await client.query(
          `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at, delivery)
           values ($1, 'notify_confirm', 2, $2, '{}'::jsonb, 'sent', now() - $3::interval, $4)`,
          [`${PREFIX}${counter}`, uniqueEmail('bounced'), i < recent ? '1 day' : '8 days', i % 2 === 0 ? 'bounced' : 'complained'],
        )
      }
      await client.query('set local role service_role')
      const reply = (await client.query('select public.notify_subscribe($1, $2, $3, 1) as r', [h.ipHash(), email, variantId])).rows[0].r
      await client.query('set local role postgres')
      const note = (await client.query('select * from public.notifications where email = $1 and variant_id = $2', [email, variantId])).rows[0]
      const mails = (await client.query("select * from finance.email_outbox where payload ->> 'notificationId' = $1", [note.id])).rows
      const day = (await client.query("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as d")).rows[0].d as string
      const alerts = (await client.query("select * from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1", [`confirm_mail_braked:${day}:%`])).rows
      const allowance = Number(
        (await client.query("select count(*)::int as n from finance.rate_limits where bucket = 'notify-confirm:email' and key_hash = $1", [sha256(email)])).rows[0].n,
      )
      const backlog = Number((await client.query('select finance.notify_confirm_backlog() as n')).rows[0].n)
      return { reply, note, mails, alerts, allowance, backlog }
    } finally {
      await client.query('rollback')
      await client.end()
    }
  }

  it('with 4 bounced or complained confirmations this week queues no confirmation, spends no allowance, and alerts the owners once', async () => {
    const braked = await signUpWith(4)
    // The visitor is told the same: the row is stored and waits.
    expect(braked.reply).toEqual(OK)
    expect(braked.note).toMatchObject({ status: 'pending', confirm_sent_at: null })
    expect(braked.mails).toEqual([])
    expect(braked.allowance).toBe(0)
    // Nor does the hourly backlog get round it.
    expect(braked.backlog).toBe(0)
    expect(braked.alerts.length).toBeGreaterThan(0)
    for (const alert of braked.alerts) expect(alert).toMatchObject({ kind: 'owner_alert', priority: 0, payload: { alert: 'confirm_mail_braked', bounced: 4 } })
    // One per owner: the sign-up and the backlog's try both met the brake, and the day's key took the second.
    expect(new Set(braked.alerts.map((alert) => alert.recipient)).size).toBe(braked.alerts.length)
  })

  it('with 3 this week (and an older one) it queues as before, and nobody is alerted', async () => {
    const open = await signUpWith(3, 1)
    expect(open.reply).toEqual(OK)
    expect(open.mails.map((mail) => mail.kind)).toEqual(['notify_confirm'])
    expect(open.note.confirm_sent_at).toBeInstanceOf(Date)
    expect(open.allowance).toBe(1)
    expect(open.alerts).toEqual([])
  })
})

// --- the purges ------------------------------------------------------------------------------------------------------

describe('finance.notifications_purge', () => {
  /** A row of the given status, last touched `days` days ago. */
  async function aged(variantId: string, status: 'pending' | 'confirmed' | 'unsubscribed', days: number, email?: string): Promise<string> {
    const note = await insertNote(variantId, status, email)
    await h.postgres.query(
      `update public.notifications
          set created_at = now() - make_interval(days => $2), updated_at = now() - make_interval(days => $2),
              unsubscribed_at = case when status = 'unsubscribed' then now() - make_interval(days => $2) end
        where id = $1`,
      [note.id, days],
    )
    return note.id as string
  }
  const exists = async (id: string): Promise<boolean> => (await h.rows('select 1 from public.notifications where id = $1', [id])).length === 1
  const purge = (): Promise<unknown> => h.postgres.query('select finance.notifications_purge() as n')

  it('removes unsubscribed rows after 30 days and pending rows after 7, with their unsent mail, and nothing else', async () => {
    const variantId = await soldOut()
    const old = { unsubscribed: await aged(variantId, 'unsubscribed', 31), pending: await aged(variantId, 'pending', 8) }
    const fresh = { unsubscribed: await aged(variantId, 'unsubscribed', 29), pending: await aged(variantId, 'pending', 6), confirmed: await aged(variantId, 'confirmed', 400) }
    const goneMail = [
      await queueMail(old.unsubscribed, 'availability', 'pending'),
      await queueMail(old.unsubscribed, 'notify_confirm', 'uncertain'),
      await queueMail(old.pending, 'notify_confirm', 'pending'),
      await queueMail(old.pending, 'notify_confirm', 'exhausted'),
    ]
    const keptMail = [
      await queueMail(old.pending, 'notify_confirm', 'sent'),
      await queueMail(old.unsubscribed, 'availability', 'sending'),
      await queueMail(fresh.unsubscribed, 'availability', 'pending'),
      await queueMail(fresh.pending, 'notify_confirm', 'pending'),
      await queueMail(fresh.confirmed, 'availability', 'pending'),
    ]
    const auditBefore = Number((await h.row("select coalesce(max(id), 0) as id from public.audit_events where action = 'privacy.notifications_purge'")).id)

    const result = (await purge()) as { rows: Array<{ n: number }> }
    expect(result.rows[0]!.n).toBeGreaterThanOrEqual(2)
    expect(await exists(old.unsubscribed)).toBe(false)
    expect(await exists(old.pending)).toBe(false)
    for (const id of Object.values(fresh)) expect(await exists(id)).toBe(true)
    const left = new Set((await h.rows('select id from finance.email_outbox where id = any($1::bigint[])', [[...goneMail, ...keptMail].map((mail) => mail.id)])).map((mail) => String(mail.id)))
    expect(goneMail.filter((mail) => left.has(String(mail.id)))).toEqual([])
    expect(keptMail.filter((mail) => !left.has(String(mail.id)))).toEqual([])

    // One count-only audit row: three numbers, no address, no id.
    const audit = await h.rows("select id, summary from public.audit_events where action = 'privacy.notifications_purge' and id > $1 order by id", [auditBefore])
    expect(audit.length).toBeGreaterThanOrEqual(1)
    const summary = audit.at(-1)!.summary
    expect(Object.keys(summary).sort()).toEqual(['availability', 'mail', 'notifications'])
    expect(Object.values(summary).every((value) => typeof value === 'number')).toBe(true)
    expect(summary.notifications).toBeGreaterThanOrEqual(2)
    expect(summary.mail).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(audit)).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('counts a pending row from its last request, not from the day it was first made', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('requested-again')
    await subscribe(variantId, { email })
    const note = await noteOf(email, variantId)
    // Made 20 days ago, asked for again just now (the sign-up sets `updated_at`): the confirmation it sent is alive.
    await h.postgres.query("update public.notifications set created_at = now() - interval '20 days' where id = $1", [note.id])
    await purge()
    expect(await exists(note.id)).toBe(true)
    // A row nobody asked for in 8 days goes.
    await h.postgres.query("update public.notifications set updated_at = now() - interval '8 days' where id = $1", [note.id])
    await purge()
    expect(await exists(note.id)).toBe(false)
  })

  it('removes the availability row of a variant that no subscription refers to any more, and keeps the others', async () => {
    const [only, shared, never] = [await soldOut(), await soldOut(), await soldOut()]
    await aged(only, 'unsubscribed', 40)
    await aged(shared, 'unsubscribed', 40)
    const staying = await insertNote(shared, 'confirmed')
    await h.postgres.query('insert into finance.variant_availability (variant_id) values ($1)', [never])
    await purge()
    expect(await availabilityOf(only)).toBeUndefined()
    expect(await availabilityOf(never)).toBeUndefined()
    expect(await availabilityOf(shared)).toMatchObject({ sellable: false, revision: 0 })
    expect(await exists(staying.id)).toBe(true)
    expect(await h.count('select count(*)::int as n from public.notifications where variant_id = $1', [shared])).toBe(1)
  })

  it('never removes a confirmed row, however old', async () => {
    const variantId = await soldOut()
    const id = await aged(variantId, 'confirmed', 3000)
    await purge()
    expect(await exists(id)).toBe(true)
    expect(await availabilityOf(variantId)).toBeDefined()
  })

  it('does not wait behind a sign-up that holds the availability row, and the row is still there when the sign-up commits', async () => {
    const variantId = await soldOut()
    // No subscription yet: until the sign-up below commits, the row is an orphan as the purge sees it.
    await h.postgres.query('insert into finance.variant_availability (variant_id) values ($1)', [variantId])
    const email = uniqueEmail('in-flight')
    const held = await h.holdLock('select public.notify_subscribe($1, $2, $3, 1)', [h.ipHash(), email, variantId])
    const apart = await superuser()
    let answered: unknown
    try {
      const purging = apart.query('select finance.notifications_purge() as n')
      // The sign-up has the row and its subscription is not committed: the purge goes past the row, it does not wait for it.
      answered = await settledWithin(purging)
      await held.release()
      await purging
    } finally {
      await apart.end()
    }
    expect(answered).not.toBe('blocked')
    const note = await noteOf(email, variantId)
    expect(note).toMatchObject({ status: 'pending' })
    expect(await mailOf(note.id)).toHaveLength(1)
    expect(await availabilityOf(variantId)).toMatchObject({ sellable: false, revision: 0 })
    // A later run keeps the row: a subscription refers to it now.
    await purge()
    expect(await availabilityOf(variantId)).toBeDefined()
    expect(await exists(note.id)).toBe(true)
  })

  it('does not deadlock with a sign-up for the address it purges, and takes a row another writer held on its next run', async () => {
    const [first, second] = [await soldOut(), await soldOut()]
    // `other` comes first in the table (the purge reads it by id: the planner's choice is pinned below) and is held, as another
    // writer could hold it: the purge, past the old subscription it deleted, must not wait for it while a sign-up for the
    // purged address and variant takes `purged`'s row.
    const [other, purged] = first < second ? [first, second] : [second, first]
    await h.postgres.query('insert into finance.variant_availability (variant_id) values ($1)', [other])
    const email = uniqueEmail('purged')
    await aged(purged, 'unsubscribed', 40, email)
    const lock = await h.holdLock('select 1 from finance.variant_availability where variant_id = $1 for update', [other])
    const apart = await superuser()
    await apart.query('set enable_seqscan = off')
    let answered: unknown
    let results: Array<PromiseSettledResult<unknown>>
    try {
      const purging = apart.query('select finance.notifications_purge() as n')
      answered = await settledWithin(purging)
      const signingUp = subscribe(purged, { email }, h.pool[1])
      // Given the time to take `purged`'s row, and to wait for the subscription the purge deleted if it is still in flight.
      await settledWithin(signingUp)
      await lock.release()
      results = await Promise.allSettled([purging, signingUp])
    } finally {
      await apart.end()
    }
    // Neither raises: not 40P01, the deadlock the purge and the sign-up made between them.
    expect(results.map((result) => (result.status === 'fulfilled' ? 'ok' : (result.reason as { code?: string }).code))).toEqual(['ok', 'ok'])
    expect(results[1]).toMatchObject({ value: OK })
    expect(answered).not.toBe('blocked')
    expect(await noteOf(email, purged)).toMatchObject({ status: 'pending' })
    expect(await availabilityOf(purged)).toBeDefined()
    // The held row was passed by; the next run takes it.
    expect(await availabilityOf(other)).toBeDefined()
    await purge()
    expect(await availabilityOf(other)).toBeUndefined()
    expect(await availabilityOf(purged)).toBeDefined()
  })

  it('is scheduled daily', async () => {
    const job = await h.row("select schedule, command from cron.job where jobname = 'notifications-purge'")
    expect(job.command).toBe('select finance.notifications_purge()')
    expect(job.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/)
  })
})

// --- grants ----------------------------------------------------------------------------------------------------------

const SERVER_ONLY = [
  'public.notify_subscribe(text, text, uuid, integer)',
  'public.notify_token_info(uuid)',
  'public.notify_link_throttle(text)',
  'public.notify_confirm(uuid, integer)',
  'public.notify_unsubscribe(uuid, integer)',
]
const HELPERS = [
  'finance.variant_public_state(uuid)',
  'finance.availability_sweep()',
  'finance.notifications_purge()',
  'finance.notify_confirm_queue(uuid)',
  'finance.notify_confirm_backlog()',
]

describe('grants', () => {
  const can = async (role: string, signature: string): Promise<boolean> => (await h.row('select has_function_privilege($1, $2, $3) as ok', [role, signature, 'execute'])).ok as boolean
  const meta = (signature: string): Promise<Row> =>
    h.row(
      `select p.prosecdef, p.proconfig, p.proacl is not null as has_acl,
              (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_entries
         from pg_proc p where p.oid = $1::regprocedure`,
      [signature],
    )

  it('catalog_availability: anon and authenticated, nothing for PUBLIC, security definer with an empty search_path', async () => {
    const signature = 'public.catalog_availability()'
    expect(await can('anon', signature)).toBe(true)
    expect(await can('authenticated', signature)).toBe(true)
    expect(await meta(signature)).toMatchObject({ prosecdef: true, has_acl: true, public_entries: 0 })
    expect((await meta(signature)).proconfig).toContain('search_path=""')
  })

  it.each(SERVER_ONLY)('%s: service_role only, security definer with an empty search_path', async (signature) => {
    expect(await can('service_role', signature)).toBe(true)
    expect(await can('authenticated', signature)).toBe(false)
    expect(await can('anon', signature)).toBe(false)
    expect(await meta(signature)).toMatchObject({ prosecdef: true, has_acl: true, public_entries: 0 })
    expect((await meta(signature)).proconfig).toContain('search_path=""')
  })

  it.each(HELPERS)('%s: no API role at all, the service role included', async (signature) => {
    for (const role of ['anon', 'authenticated', 'service_role']) expect(await can(role, signature), role).toBe(false)
    expect((await meta(signature)).proconfig).toContain('search_path=""')
  })

  it('refuses anon and a signed-in member with 42501 on every server-only function, through the Data API', async () => {
    const member = await signIn((await h.makeStaff('editor')).email)
    const calls: Array<[string, Record<string, unknown>]> = [
      ['notify_subscribe', { p_ip_hash: h.ipHash(), p_email: uniqueEmail('api'), p_variant: randomUUID(), p_consent_revision: null }],
      ['notify_token_info', { p_id: randomUUID() }],
      ['notify_link_throttle', { p_ip_hash: h.ipHash() }],
      ['notify_confirm', { p_id: randomUUID(), p_token_version: 1 }],
      ['notify_unsubscribe', { p_id: randomUUID(), p_token_version: 1 }],
    ]
    for (const [fn, args] of calls) {
      expect((await anonClient().rpc(fn, args)).error?.code, `${fn} anon`).toBe('42501')
      expect((await member.rpc(fn, args)).error?.code, `${fn} authenticated`).toBe('42501')
    }
  })
})
