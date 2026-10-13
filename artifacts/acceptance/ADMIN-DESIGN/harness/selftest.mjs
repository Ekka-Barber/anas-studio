#!/usr/bin/env node
// A browser-free check of the mock layer: node harness/selftest.mjs --site <dir>
// It drives the router with fake routes and checks the answers a screen depends on
// (Content-Range, single-object replies, RPC scalars, the 501 path). Exit code 1 on a failure.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { buildData } from './lib/data.mjs'
import { createMock } from './lib/mock.mjs'
import { NOW_DEFAULT } from './lib/util.mjs'
import { buildWorld } from './lib/world.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { site: { type: 'string' } } })
const siteDir = path.resolve(values.site ?? path.join(here, '..', 'site'))
const now = Date.parse(NOW_DEFAULT)
const data = buildData({ now, siteDir })

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`)
}

async function call(world, { method = 'GET', url, headers = {}, body }) {
  const mock = createMock({ world, now })
  let out = null
  const route = {
    request: () => ({ url: () => `https://mock.supabase.invalid${url}`, method: () => method, headers: () => headers, postData: () => (body === undefined ? null : JSON.stringify(body)) }),
    fulfill: async (options) => {
      out = options
    },
  }
  await mock.handle(route)
  const text = typeof out.body === 'string' ? out.body : ''
  return { status: out.status, headers: out.headers, json: text ? JSON.parse(text) : undefined, raw: out.body, mock }
}

const owner = buildWorld(data, { role: 'owner' })

let r = await call(owner, { url: '/rest/v1/content_documents?select=*&collection=eq.rooms&order=latest_at.desc' })
check('rest: filter, order and select', r.status === 200 && r.json.length === 5 && r.json[0].doc_id === 'built', JSON.stringify(r.json?.map((x) => x.doc_id)))

r = await call(owner, { method: 'HEAD', url: '/rest/v1/content_documents?select=doc_id&scheduled_at=gt.2026-10-08T07%3A25%3A00.000Z', headers: { prefer: 'count=exact' } })
check('rest: HEAD count has a Content-Range', r.status === 200 && /\/2$/.test(r.headers['content-range']), r.headers?.['content-range'])
check('rest: Content-Range is exposed to the page', /content-range/.test(r.headers['access-control-expose-headers']))

r = await call(owner, { url: `/rest/v1/staff?select=display_name%2Crole&user_id=eq.${owner.person.id}`, headers: { accept: 'application/vnd.pgrst.object+json' } })
check('rest: single object reply', r.status === 200 && r.json.role === 'owner', JSON.stringify(r.json))
r = await call(owner, { url: '/rest/v1/staff?select=role&user_id=eq.nobody', headers: { accept: 'application/vnd.pgrst.object+json' } })
check('rest: single object with no row is 406 PGRST116', r.status === 406 && r.json.code === 'PGRST116')

r = await call(owner, { url: '/rest/v1/media?select=folder&order=folder&offset=1000&limit=1000' })
check('rest: a range past the end is an empty list', r.status === 200 && r.json.length === 0)

r = await call(owner, { url: '/rest/v1/notifications?select=id%2Cemail%2Cproduct_variants(sku)&order=created_at.desc&limit=500' })
check('rest: an embed is kept', r.status === 200 && r.json[0].product_variants?.sku, JSON.stringify(r.json?.[0]))

r = await call(owner, { method: 'POST', url: '/rest/v1/rpc/current_staff_role', body: {} })
check('rpc: scalar reply', r.status === 200 && r.json === 'owner', JSON.stringify(r.json))
r = await call(owner, { method: 'POST', url: '/rest/v1/rpc/orders_list', body: { p_filter: 'paid', p_query: null, p_before: null, p_limit: 50 } })
check('rpc: orders_list filter', r.status === 200 && r.json.rows.every((row) => row.status === 'paid') && r.json.rows.length > 3, JSON.stringify(r.json?.rows?.length))
r = await call(owner, { method: 'POST', url: '/rest/v1/rpc/order_detail', body: { p_order: data.ids.mainOrder } })
check('rpc: order_detail has the owner-only parts', r.json.ok === true && Array.isArray(r.json.disputes) && Array.isArray(r.json.audit))
const ops = buildWorld(data, { role: 'operations' })
r = await call(ops, { method: 'POST', url: '/rest/v1/rpc/order_detail', body: { p_order: data.ids.mainOrder } })
check('rpc: order_detail for operations has no disputes or audit', r.json.ok === true && !('disputes' in r.json) && !('audit' in r.json))
const failing = buildWorld(data, { role: 'owner', scenario: { failRpc: { orders_list: 500 } } })
r = await call(failing, { method: 'POST', url: '/rest/v1/rpc/orders_list', body: {} })
check('rpc: a failing scenario answers 500', r.status === 500)

r = await call(owner, { method: 'POST', url: '/functions/v1/admin', body: { action: 'stats' } })
check('function: admin stats', r.status === 200 && r.json.ok === true && r.json.data.commerce.paidOrders > 0)
r = await call(owner, { method: 'POST', url: '/auth/v1/factors/x/challenge', body: {} })
check('auth: mfa challenge', r.status === 200 && r.json.type === 'totp')
r = await call(owner, { url: '/auth/v1/user' })
check('auth: user has a verified totp factor', r.status === 200 && r.json.factors?.[0]?.status === 'verified')
r = await call(owner, { url: `/storage/v1/object/public/media-public/m/${data.media[0].id}/360.webp` })
check('storage: a media derivative is the repository photo', r.status === 200 && Buffer.isBuffer(r.raw) && r.raw.length > 1000 && r.headers['content-type'] === 'image/webp')

// The 501 path, and its log.
r = await call(owner, { method: 'POST', url: '/rest/v1/rpc/no_such_function', body: {} })
check('unmocked rpc: 501 and logged', r.status === 501 && r.mock.unmocked.length === 1 && /rpc no_such_function/.test(r.mock.unmocked[0].reason), JSON.stringify(r.mock.unmocked))
r = await call(owner, { url: '/rest/v1/no_such_table?select=*' })
check('unmocked table: 501 and logged', r.status === 501 && r.mock.unmocked.length === 1)
r = await call(owner, { method: 'POST', url: '/functions/v1/admin', body: { action: 'no-such-action' } })
check('unmocked function action: 501 and logged', r.status === 501 && r.mock.unmocked.length === 1 && /admin:no-such-action/.test(r.mock.unmocked[0].reason))
r = await call(owner, { url: '/somewhere/else' })
check('unmocked path: 501 and logged', r.status === 501 && r.mock.unmocked.length === 1)

console.log(failures === 0 ? 'selftest passed' : `selftest: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
