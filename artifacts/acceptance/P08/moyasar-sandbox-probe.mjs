// A one-off, supervised pass against the Moyasar SANDBOX (test key), approved by the owner on 2026-10-02.
// It creates, reads, lists and cancels test invoices only: no payment is made and nothing is refunded.
// Run from the repository root:  node --env-file=.env <this file> <out.json>
// The key is read from the environment and is never printed or written.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const KEY = process.env.MOYASAR_SECRET_KEY ?? ''
if (!KEY.startsWith('sk_test_')) {
  console.error('Refusing: MOYASAR_SECRET_KEY is not a test key.')
  process.exit(2)
}
const BASE = 'https://api.moyasar.com/v1'
const AUTH = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`
const out = { startedAt: new Date().toISOString(), base: BASE, steps: [] }
const created = new Set()
let calls = 0

/** Types instead of values, so the evidence shows the shape and nothing else. */
function shape(value, depth = 0) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : [shape(value[0], depth + 1)]
  if (typeof value === 'object') {
    if (depth > 2) return '{…}'
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]))
  }
  return typeof value
}

async function raw(method, path, body) {
  calls += 1
  const started = Date.now()
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: AUTH, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error?.name ?? error) }
  }
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  const limits = {}
  for (const [name, value] of response.headers) {
    if (/ratelimit|retry-after|x-request-id/i.test(name)) limits[name] = name.toLowerCase() === 'x-request-id' ? '(present)' : value
  }
  return { status: response.status, ms: Date.now() - started, json, limits, contentType: response.headers.get('content-type') }
}

function step(name, data) {
  out.steps.push({ name, ...data })
  console.log(`- ${name}: ${JSON.stringify(data.summary ?? data).slice(0, 400)}`)
}

const expiry = (seconds) => new Date(Date.now() + seconds * 1000).toISOString()
const baseBody = (extra = {}) => ({
  amount: 100,
  currency: 'SAR',
  description: 'طلب ABCD2345',
  callback_url: 'https://example.com/functions/v1/payments/callback',
  success_url: 'https://example.com/checkout/return?order=ABCD2345',
  back_url: 'https://example.com/checkout/return?order=ABCD2345',
  expired_at: expiry(1200),
  metadata: { order_number: 'ABCD2345', attempt_id: randomUUID() },
  ...extra,
})

// ---- A. Our own client, our exact production shape ------------------------------------------------
const clientUrl = pathToFileURL(resolve('supabase/functions/_shared/payments/moyasar.ts')).href
const { moyasarClient } = await import(clientUrl)
const client = moyasarClient({ baseUrl: BASE, secretKey: KEY })

const attemptId = randomUUID()
const input = baseBody({ metadata: { order_number: 'ABCD2345', attempt_id: attemptId } })
const viaClient = await client.createInvoice(input)
calls += 1
if (!viaClient.ok) {
  step('A client.createInvoice', { summary: { ok: false, kind: viaClient.kind, status: viaClient.status } })
  writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
  process.exit(1)
}
created.add(viaClient.data.id)
step('A client.createInvoice (amount 100, metadata, expired_at ISO with ms and Z)', {
  summary: {
    ok: true,
    httpStatus: viaClient.status,
    status: viaClient.data.status,
    amount: viaClient.data.amount,
    currency: viaClient.data.currency,
    urlHost: new URL(viaClient.data.url).host,
    expiredAtSent: input.expired_at,
    expiredAtEchoed: viaClient.data.expiredAt,
    metadataKept: viaClient.data.metadata.attempt_id === attemptId && viaClient.data.metadata.order_number === 'ABCD2345',
    payments: viaClient.data.payments,
  },
})

// ---- B. The raw invoice object -------------------------------------------------------------------
const fetched = await raw('GET', `/invoices/${viaClient.data.id}`)
step('B GET /invoices/:id (raw shape)', {
  summary: { status: fetched.status, keys: fetched.json ? Object.keys(fetched.json) : null },
  shape: shape(fetched.json),
  values: fetched.json && {
    status: fetched.json.status,
    amount_format: fetched.json.amount_format,
    expired_at: fetched.json.expired_at,
    created_at: fetched.json.created_at,
    payments: fetched.json.payments,
    metadata: fetched.json.metadata,
    callback_url: fetched.json.callback_url,
    success_url: fetched.json.success_url,
    back_url: fetched.json.back_url,
    liveLikeFields: Object.keys(fetched.json).filter((key) => /live|mode|test|account/i.test(key)),
  },
  limits: fetched.limits,
})
const viaClientFetch = await client.fetchInvoice(viaClient.data.id)
calls += 1
step('B client.fetchInvoice', { summary: { ok: viaClientFetch.ok, status: viaClientFetch.ok ? viaClientFetch.data.status : viaClientFetch.kind } })

// ---- C. The list and its metadata filter ----------------------------------------------------------
const listStarted = Date.now()
const listed = await client.listInvoices({ metadata: { attempt_id: attemptId } })
calls += 1
step('C client.listInvoices(metadata[attempt_id]) right after the create', {
  summary: listed.ok
    ? {
        ok: true,
        count: listed.data.invoices.length,
        allMatch: listed.data.invoices.every((invoice) => invoice.metadata.attempt_id === attemptId),
        containsNew: listed.data.invoices.some((invoice) => invoice.id === viaClient.data.id),
        nextPage: listed.data.nextPage,
        msSinceCreateReply: Date.now() - listStarted,
      }
    : { ok: false, kind: listed.kind, status: listed.status },
})
const none = await raw('GET', `/invoices?metadata[attempt_id]=${randomUUID()}`)
step('C GET /invoices?metadata[attempt_id]=<an id no invoice has>', {
  summary: { status: none.status, count: none.json?.invoices?.length ?? null, meta: none.json?.meta ?? null },
})
const page = await raw('GET', '/invoices')
step('C GET /invoices (no filter)', {
  summary: { status: page.status, count: page.json?.invoices?.length ?? null, meta: page.json?.meta ?? null },
})

// ---- I. The hosted page (no key) -------------------------------------------------------------------
try {
  const hosted = await fetch(viaClient.data.url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  const html = await hosted.text()
  step('I GET <invoice url> (the hosted page, no key)', {
    summary: {
      status: hosted.status,
      contentType: hosted.headers.get('content-type'),
      bytes: html.length,
      mentions: Object.fromEntries(['applepay', 'apple pay', 'apple', 'stcpay', 'mada', '3d', 'samsung'].map((word) => [word, html.toLowerCase().includes(word)])),
    },
  })
} catch (error) {
  step('I GET <invoice url>', { summary: { error: String(error?.name ?? error) } })
}

// ---- H. 25 fetches in a row (the reconciliation job's most per minute) ----------------------------
const burst = { statuses: {}, firstLimits: null, ms: 0 }
const burstStarted = Date.now()
for (let i = 0; i < 25; i += 1) {
  const one = await raw('GET', `/invoices/${viaClient.data.id}`)
  burst.statuses[one.status] = (burst.statuses[one.status] ?? 0) + 1
  if (i === 0) burst.firstLimits = one.limits
  if (one.status === 429) {
    burst.limitsAt429 = one.limits
    burst.bodyAt429 = one.json
    break
  }
}
burst.ms = Date.now() - burstStarted
step('H 25 sequential GET /invoices/:id', { summary: burst })

// ---- D. Cancel, and cancel again -------------------------------------------------------------------
const cancelled = await client.cancelInvoice(viaClient.data.id)
calls += 1
step('D client.cancelInvoice (an initiated invoice)', {
  summary: cancelled.ok ? { ok: true, httpStatus: cancelled.status, status: cancelled.data.status, payments: cancelled.data.payments } : { ok: false, kind: cancelled.kind, status: cancelled.status },
})
const again = await raw('PUT', `/invoices/${viaClient.data.id}/cancel`)
step('D PUT /invoices/:id/cancel again (already canceled)', { summary: { status: again.status, body: again.json && { status: again.json.status, type: again.json.type, message: again.json.message, errors: again.json.errors } } })
const hostedAfter = await fetch(viaClient.data.url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) }).then((r) => r.status).catch(() => 0)
step('D the hosted page of the canceled invoice', { summary: { status: hostedAfter } })

// ---- E. Variants of the create ----------------------------------------------------------------------
async function variant(name, body) {
  const reply = await raw('POST', '/invoices', body)
  if (reply.status >= 200 && reply.status < 300 && reply.json?.id) created.add(reply.json.id)
  step(name, {
    summary: {
      status: reply.status,
      ...(reply.status >= 200 && reply.status < 300
        ? { invoiceStatus: reply.json?.status, expired_at: reply.json?.expired_at, callback_url: reply.json?.callback_url, success_url: reply.json?.success_url, metadata: reply.json?.metadata }
        : { type: reply.json?.type, message: reply.json?.message, errors: reply.json?.errors }),
    },
  })
  return reply
}
await variant('E amount 99 (under the documented minimum)', baseBody({ amount: 99 }))
await variant('E callback_url http://localhost', baseBody({ callback_url: 'http://localhost:54321/functions/v1/payments/callback' }))
await variant('E success_url and back_url http://localhost', baseBody({ success_url: 'http://localhost:3000/checkout/return?order=ABCD2345', back_url: 'http://localhost:3000/checkout/return?order=ABCD2345' }))
await variant('E expired_at with a +03:00 offset, no fraction', baseBody({ expired_at: expiry(1200 + 3 * 3600).replace(/\.\d{3}Z$/, '+03:00') }))
await variant('E expired_at in the past', baseBody({ expired_at: expiry(-3600) }))
await variant('E no metadata, no expired_at (control)', (() => {
  const { metadata: _m, expired_at: _e, ...rest } = baseBody()
  return rest
})())
await variant('E a metadata value that is a number', baseBody({ metadata: { order_number: 'ABCD2345', n: 7 } }))

// ---- F. An invoice that expires ----------------------------------------------------------------------
const soon = await variant('F expired_at 15 seconds ahead', baseBody({ expired_at: expiry(15) }))
if (soon.json?.id) {
  await new Promise((done) => setTimeout(done, 22_000))
  const later = await raw('GET', `/invoices/${soon.json.id}`)
  step('F the same invoice 22 seconds later', { summary: { status: later.status, invoiceStatus: later.json?.status, expired_at: later.json?.expired_at } })
  const cancelExpired = await raw('PUT', `/invoices/${soon.json.id}/cancel`)
  step('F PUT cancel on it', { summary: { status: cancelExpired.status, invoiceStatus: cancelExpired.json?.status, type: cancelExpired.json?.type, message: cancelExpired.json?.message } })
  const viaClientExpired = await client.cancelInvoice(soon.json.id)
  calls += 1
  step('F client.cancelInvoice on it', { summary: viaClientExpired.ok ? { ok: true, status: viaClientExpired.data.status } : { ok: false, kind: viaClientExpired.kind, status: viaClientExpired.status } })
}

// ---- G. Unknown ids --------------------------------------------------------------------------------
const unknownPayment = await raw('GET', `/payments/${randomUUID()}`)
step('G GET /payments/<unknown uuid>', { summary: { status: unknownPayment.status, body: unknownPayment.json } })
const clientUnknown = await client.fetchPayment(randomUUID())
calls += 1
step('G client.fetchPayment(<unknown uuid>)', { summary: clientUnknown.ok ? { ok: true } : { ok: false, kind: clientUnknown.kind, status: clientUnknown.status } })
const unknownInvoice = await raw('GET', `/invoices/${randomUUID()}`)
step('G GET /invoices/<unknown uuid>', { summary: { status: unknownInvoice.status, body: unknownInvoice.json } })
const payments = await raw('GET', '/payments')
step('G GET /payments (the account so far)', { summary: { status: payments.status, count: payments.json?.payments?.length ?? null, meta: payments.json?.meta ?? null } })

// ---- Cleanup: nothing this run created stays payable -------------------------------------------------
const leftovers = []
for (const id of created) {
  const state = await raw('GET', `/invoices/${id}`)
  if (state.json?.status === 'initiated') {
    const done = await raw('PUT', `/invoices/${id}/cancel`)
    leftovers.push({ id: `${id.slice(0, 8)}…`, was: 'initiated', now: done.json?.status ?? done.status })
  } else {
    leftovers.push({ id: `${id.slice(0, 8)}…`, was: state.json?.status ?? state.status })
  }
}
step('Cleanup', { summary: { invoices: leftovers } })

out.finishedAt = new Date().toISOString()
out.calls = calls
writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
console.log(`calls: ${calls}`)
