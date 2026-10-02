// P08 round 8: the REAL local `notify` Edge Function over HTTP (Docker), against the local
// database. A visitor signs up for a variant that is out of stock; the confirmation link is
// derived the way the dispatcher does it (`notify_email_data` and the dispatcher's own
// `renderNotifyConfirm`, whose token comes from `tokens.ts`); the link is opened over HTTP;
// the owner restocks and `finance.availability_sweep()` queues one `availability` notice;
// the unsubscribe link of that notice is opened over HTTP, after which the old confirm token
// answers 404. Then every outcome of a sign-up gives the same reply, the confirm link
// expires after 7 days and the unsubscribe link does not, and every bad token gets the same
// 404. Turnstile runs with the local always-pass test secret, so any non-empty token works.
// Nothing here sends a mail or reaches Moyasar. This file switches
// `finance.commerce_settings.checkout_enabled` on (saved and restored by the fixtures) and
// removes the subscriptions, availability rows and mail of its own variants when it ends.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderAvailability, renderNotifyConfirm, type NotifyEmailData } from '../../supabase/functions/_shared/email.ts'
import { notificationToken } from '../../supabase/functions/_shared/tokens.ts'
import { commerceHarness, type Harness, localEnv, type Row, status, uniqueEmail } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const env = localEnv()
const FUNCTIONS_URL = status.FUNCTIONS_URL
const SITE = env.SITE_URL!
const PEPPER = env.TOKEN_HASH_PEPPER!
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const NOT_FOUND = { ok: false, error: { code: 'NOT_FOUND', message: 'الرابط غير صالح أو انتهت صلاحيته.' } }

let h: Harness

beforeAll(async () => {
  h = await commerceHarness(PEPPER)
})

afterAll(async () => {
  await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:all'")
  await h.stop()
})

beforeEach(async () => {
  // The day's total of confirmation mails is one bucket for the whole machine, and a test below spends it on purpose.
  await h.postgres.query("delete from finance.rate_limits where bucket = 'notify-confirm:all'")
})

// --- the function ---------------------------------------------------------------------------------------------------

type Reply = { status: number; body: any; headers: Headers }
/** A random visitor address per request: the function throttles by it, and every request is its own visitor unless a test pins one. */
const visitorIp = (): string => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function callNotify(body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const response = await fetch(`${FUNCTIONS_URL}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': visitorIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json(), headers: response.headers }
}
const signUp = (variantId: string, email: string, over: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Reply> =>
  callNotify({ action: 'subscribe', variantId, email, consentRevision: 3, turnstileToken: TURNSTILE_TOKEN, ...over }, headers)
const confirm = (token: string): Promise<Reply> => callNotify({ action: 'confirm', token })
const unsubscribe = (token: string): Promise<Reply> => callNotify({ action: 'unsubscribe', token })

// --- the dispatcher's side ---------------------------------------------------------------------------------------------

const soldOut = (): Promise<string> => h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0 })
const noteOf = (email: string, variantId: string): Promise<Row> => h.row('select * from public.notifications where email = $1 and variant_id = $2', [email, variantId])
const mailOf = (notificationId: string, kind: string): Promise<Row[]> =>
  h.rows("select * from finance.email_outbox where kind = $2 and payload ->> 'notificationId' = $1 order by id", [notificationId, kind])
const sweep = (): Promise<unknown> => h.postgres.query('select finance.availability_sweep() as n')

/** The link in a mail, derived the way the dispatcher derives it: the row's data, the pepper and the row's current version, put in the page's own text. */
async function linkOf(notificationId: string, mail: 'confirm' | 'unsubscribe'): Promise<string> {
  const data = (await h.call('notify_email_data', { p_id: notificationId })) as NotifyEmailData
  const token = await notificationToken(PEPPER, notificationId, data.tokenVersion)
  const text = (mail === 'confirm' ? renderNotifyConfirm(data, SITE, token) : renderAvailability(data, SITE, token)).text
  const link = text.match(new RegExp(`${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/notify/${mail}#(\\S+)`))
  expect(link, `the ${mail} mail carries its link`).not.toBeNull()
  return link![1]!
}

// --- the whole journey ------------------------------------------------------------------------------------------------

describe('a sign-up, its confirmation, the notice and the unsubscribe, end to end', () => {
  it('goes from a visitor to a confirmed subscriber to one availability notice to an unsubscribed row whose old links are dead', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('journey')

    // 1. The visitor signs up.
    const signedUp = await signUp(variantId, email)
    expect(signedUp.status, JSON.stringify(signedUp.body)).toBe(200)
    expect(signedUp.body).toEqual({ ok: true, data: { sent: true } })
    expect(signedUp.headers.get('referrer-policy')).toBe('no-referrer')
    expect(signedUp.headers.get('cache-control')).toBe('no-store')
    const note = await noteOf(email, variantId)
    expect(note).toMatchObject({ status: 'pending', token_version: 1, consent_revision: 3 })
    const confirmMails = await mailOf(note.id, 'notify_confirm')
    expect(confirmMails).toHaveLength(1)
    expect(confirmMails[0]).toMatchObject({ recipient: email, priority: 2, payload: { notificationId: note.id } })
    expect(JSON.stringify(signedUp.body)).not.toContain(email)

    // 2. The confirmation link, as the dispatcher would put it in the mail, opened.
    const confirmToken = await linkOf(note.id, 'confirm')
    expect(confirmToken).toBe(await notificationToken(PEPPER, note.id, 1))
    const confirmed = await confirm(confirmToken)
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body).toEqual({ ok: true, data: { status: 'confirmed' } })
    expect(confirmed.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await noteOf(email, variantId)).toMatchObject({ status: 'confirmed', token_version: 1 })
    // A second click on the same link is the same success.
    expect((await confirm(confirmToken)).body).toEqual({ ok: true, data: { status: 'confirmed' } })

    // 3. Nothing is sent while the variant is out of stock; the owner restocks and the sweep queues the notice.
    await sweep()
    expect(await mailOf(note.id, 'availability')).toHaveLength(0)
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [variantId])
    await sweep()
    await sweep()
    const notices = await mailOf(note.id, 'availability')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ dedupe_key: `availability:${variantId}:1:${note.id}`, recipient: email, priority: 2, payload: { notificationId: note.id } })

    // 4. The notice's unsubscribe link, opened: the row is unsubscribed and its version has moved on.
    const unsubscribeToken = await linkOf(note.id, 'unsubscribe')
    expect(unsubscribeToken).toBe(confirmToken)
    const left = await unsubscribe(unsubscribeToken)
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    expect(left.body).toEqual({ ok: true, data: { status: 'unsubscribed' } })
    expect(await noteOf(email, variantId)).toMatchObject({ status: 'unsubscribed', token_version: 2 })
    // The notice it had not been sent is gone with it.
    expect((await mailOf(note.id, 'availability')).filter((mail) => ['pending', 'uncertain'].includes(mail.status))).toEqual([])

    // 5. Every link of version 1 is dead: the confirm token, the unsubscribe token, whichever action takes it.
    for (const reply of [await confirm(confirmToken), await unsubscribe(unsubscribeToken), await confirm(unsubscribeToken), await unsubscribe(confirmToken)]) {
      expect(reply.status).toBe(404)
      expect({ ok: reply.body.ok, error: reply.body.error }).toEqual(NOT_FOUND)
    }
    // The next restock mails nobody: the row is unsubscribed.
    await h.postgres.query('update public.product_variants set stock = 0 where id = $1', [variantId])
    await sweep()
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [variantId])
    await sweep()
    expect((await mailOf(note.id, 'availability')).filter((mail) => mail.dedupe_key.includes(':2:'))).toEqual([])
  })

  it('refuses a foreign origin and a missing one on every action, and a wrong method, with the no-referrer and no-store headers', async () => {
    const email = uniqueEmail('origin')
    const bodies = [
      { action: 'subscribe', variantId: randomUUID(), email, consentRevision: null, turnstileToken: TURNSTILE_TOKEN },
      { action: 'confirm', token: `${randomUUID()}.${'A'.repeat(43)}` },
      { action: 'unsubscribe', token: `${randomUUID()}.${'A'.repeat(43)}` },
    ]
    for (const body of bodies) {
      const foreign = await callNotify(body, { origin: 'https://evil.test' })
      expect(foreign.status, body.action).toBe(403)
      expect(foreign.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      expect(foreign.headers.get('referrer-policy')).toBe('no-referrer')
      expect(foreign.headers.get('cache-control')).toBe('no-store')
      const noOrigin = await fetch(`${FUNCTIONS_URL}/notify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(noOrigin.status, body.action).toBe(403)
    }
    // A refused origin did nothing: no row was made for the address it tried.
    expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [email])).toBe(0)
    const get = await fetch(`${FUNCTIONS_URL}/notify`, { method: 'GET', headers: { origin: SITE } })
    expect(get.status).toBe(405)
  })
})

// --- a sign-up says the same whatever happened ----------------------------------------------------------------------

describe('subscribe over HTTP', () => {
  it('gives one reply to a variant that is out of stock, an unknown one, a sellable one, an address already confirmed and a spent day', async () => {
    const outOfStock = await soldOut()
    const sellable = await h.physical(4000, 5)
    const confirmedEmail = uniqueEmail('already')
    expect((await signUp(outOfStock, confirmedEmail)).status).toBe(200)
    const confirmedNote = await noteOf(confirmedEmail, outOfStock)
    expect((await confirm(await linkOf(confirmedNote.id, 'confirm'))).status).toBe(200)

    const replies: Array<[string, Reply]> = [
      ['out of stock', await signUp(outOfStock, uniqueEmail('stock'))],
      ['unknown variant', await signUp(randomUUID(), uniqueEmail('unknown'))],
      ['sellable variant', await signUp(sellable, uniqueEmail('sellable'))],
      ['address already confirmed', await signUp(outOfStock, confirmedEmail)],
      ['the same address in another case', await signUp(outOfStock, confirmedEmail.toUpperCase())],
      ['no privacy revision published', await signUp(outOfStock, uniqueEmail('null'), { consentRevision: null })],
    ]
    // The day's 30 spent: the row is stored, no mail, the same answer.
    await h.postgres.query(
      `insert into finance.rate_limits (bucket, key_hash, window_start, hits)
       values ('notify-confirm:all', repeat('0', 64), to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 30)
       on conflict (bucket, key_hash, window_start) do update set hits = 30`,
    )
    const spent = uniqueEmail('spent')
    replies.push(['the day is spent', await signUp(outOfStock, spent)])
    expect(await mailOf((await noteOf(spent, outOfStock)).id, 'notify_confirm')).toHaveLength(0)

    for (const [label, reply] of replies) {
      expect(reply.status, label).toBe(200)
      expect(reply.body, label).toEqual({ ok: true, data: { sent: true } })
      expect(reply.headers.get('referrer-policy'), label).toBe('no-referrer')
      expect(reply.headers.get('cache-control'), label).toBe('no-store')
    }
    // What differed is only what the database stored, and none of it is in the reply.
    expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [confirmedEmail])).toBe(1)
    expect(await h.count("select count(*)::int as n from public.notifications where email like 'sellable-%' and variant_id = $1", [sellable])).toBe(0)
  })

  it('throttles one caller at 5 an hour with 429, whatever it asks for', async () => {
    const variantId = await soldOut()
    const ip = visitorIp()
    for (let i = 0; i < 5; i += 1) expect((await signUp(i % 2 === 0 ? variantId : randomUUID(), uniqueEmail('flood'), {}, { 'cf-connecting-ip': ip })).status).toBe(200)
    const [real, unknown] = [await signUp(variantId, uniqueEmail('flood'), {}, { 'cf-connecting-ip': ip }), await signUp(randomUUID(), uniqueEmail('anyone'), {}, { 'cf-connecting-ip': ip })]
    for (const reply of [real, unknown]) {
      expect(reply.status).toBe(429)
      expect(reply.body).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    }
    expect(real.body.error).toEqual(unknown.body.error)
    // Another caller is not held back.
    expect((await signUp(variantId, uniqueEmail('calm'))).status).toBe(200)
  })

  it('refuses a malformed request before any database work, with a field error and no row', async () => {
    const variantId = await soldOut()
    const email = uniqueEmail('bad')
    for (const [label, over] of [
      ['an address that is not one', { email: 'not-an-address' }],
      ['no Turnstile token', { turnstileToken: '' }],
      ['a variant that is not a uuid', { variantId: 'nope' }],
      ['a revision that is not an integer', { consentRevision: 'three' }],
      ['a stray key', { website: 'x' }],
    ] as const) {
      const reply = await signUp(variantId, email, over)
      expect(reply.status, label).toBe(422)
      expect(reply.body.error.code, label).toBe('INVALID')
    }
    expect((await callNotify('not json')).status).toBe(400)
    expect((await callNotify({ action: 'delete' })).status).toBe(422)
    expect(await h.count('select count(*)::int as n from public.notifications where email = $1', [email])).toBe(0)
  })
})

// --- the links over HTTP ---------------------------------------------------------------------------------------------

describe('confirm and unsubscribe over HTTP', () => {
  async function pendingSubscriber(): Promise<{ id: string; variantId: string; email: string; token: string }> {
    const variantId = await soldOut()
    const email = uniqueEmail('link')
    expect((await signUp(variantId, email)).status).toBe(200)
    const note = await noteOf(email, variantId)
    return { id: note.id as string, variantId, email, token: await linkOf(note.id, 'confirm') }
  }

  it('gives a confirm link 7 days from the moment its mail was queued, and an unsubscribe link no end', async () => {
    const { id, token } = await pendingSubscriber()
    const queued = (when: string): Promise<unknown> => h.postgres.query(`update public.notifications set confirm_sent_at = ${when} where id = $1`, [id])
    await queued("now() - interval '7 days' - interval '1 minute'")
    const late = await confirm(token)
    expect(late.status).toBe(404)
    expect({ ok: late.body.ok, error: late.body.error }).toEqual(NOT_FOUND)
    expect((await h.row('select status from public.notifications where id = $1', [id])).status).toBe('pending')
    // A row that never had a mail has no link at all.
    await queued('null')
    expect((await confirm(token)).status).toBe(404)
    await queued("now() - interval '6 days'")
    expect((await confirm(token)).body).toEqual({ ok: true, data: { status: 'confirmed' } })

    // The unsubscribe link of a notice sent a year ago still works.
    await queued("now() - interval '400 days'")
    const left = await unsubscribe(token)
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    expect(left.body).toEqual({ ok: true, data: { status: 'unsubscribed' } })
  })

  it('gives every bad token the same 404: a forged mac, an older version, an unknown id and a token that is not one', async () => {
    const { id, token } = await pendingSubscriber()
    const forged = `${id}.${'A'.repeat(43)}`
    const older = await notificationToken(PEPPER, id, 0)
    const foreignId = await notificationToken(PEPPER, randomUUID(), 1)
    const bad = [forged, older, foreignId, `${randomUUID()}.${'A'.repeat(43)}`, `${id}.`, id, 'garbage', `${token}x`]
    const replies: Reply[] = []
    for (const candidate of bad) {
      replies.push(await confirm(candidate), await unsubscribe(candidate))
    }
    for (const reply of replies) {
      expect(reply.status).toBe(404)
      expect({ ok: reply.body.ok, error: reply.body.error }).toEqual(NOT_FOUND)
      expect(reply.headers.get('referrer-policy')).toBe('no-referrer')
      expect(reply.headers.get('cache-control')).toBe('no-store')
    }
    // Nothing moved: the row is still pending at its version.
    expect(await h.row('select status, token_version from public.notifications where id = $1', [id])).toEqual({ status: 'pending', token_version: 1 })
    // The genuine token still opens it afterwards.
    expect((await confirm(token)).status).toBe(200)
  })

  it('throttles the two link actions at 60 an hour per caller with 429', async () => {
    const ip = visitorIp()
    const bogus = `${randomUUID()}.${'A'.repeat(43)}`
    let refused: Reply | undefined
    for (let i = 0; i < 62 && !refused; i += 1) {
      const reply = await callNotify({ action: i % 2 === 0 ? 'confirm' : 'unsubscribe', token: bogus }, { 'cf-connecting-ip': ip })
      if (reply.status === 429) refused = reply
      else expect(reply.status).toBe(404)
    }
    expect(refused?.body).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
  })
})
