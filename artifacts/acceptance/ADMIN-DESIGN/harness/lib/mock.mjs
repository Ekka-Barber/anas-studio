// The network mock for https://mock.supabase.invalid: auth, PostgREST tables,
// RPCs, Edge Functions and public storage, answered from one screen's world.
// Anything it cannot answer is a 501 and goes into `unmocked`.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { handleRest } from './postgrest.mjs'
import { uid } from './util.mjs'
import { HttpFailure } from './world.mjs'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS',
  'access-control-expose-headers': 'content-range, content-location, x-supabase-api-version',
}
const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
const fileCache = new Map()

export function createMock({ world, now }) {
  const served = []
  const unmocked = []
  const state = { inflight: 0, lastActivity: Date.now() }

  const send = (route, status, body, headers = {}) =>
    route.fulfill({
      status,
      headers: { ...CORS, ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }), ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    })

  function refuse(route, request, url, reason) {
    unmocked.push({ method: request.method(), url: `${url.pathname}${url.search}`, reason })
    return send(route, 501, { code: 'HARNESS501', message: `harness: unmocked call (${reason})`, details: null, hint: null })
  }

  function bodyOf(request) {
    const text = request.postData()
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  async function handle(route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const headers = request.headers()
    state.inflight += 1
    state.lastActivity = Date.now()
    try {
      if (method === 'OPTIONS') return await send(route, 204, undefined)
      const p = url.pathname

      // ------------------------------------------------------------- RPC
      if (p.startsWith('/rest/v1/rpc/')) {
        const name = p.slice('/rest/v1/rpc/'.length)
        const handler = world.rpc[name]
        if (!handler) return await refuse(route, request, url, `rpc ${name}`)
        const args = bodyOf(request) ?? Object.fromEntries(url.searchParams.entries())
        try {
          const result = handler(args)
          served.push({ kind: 'rpc', name, method, status: 200 })
          return await (result === null || result === undefined ? send(route, 204, undefined) : send(route, 200, result))
        } catch (error) {
          if (error instanceof HttpFailure) {
            served.push({ kind: 'rpc', name, method, status: error.status })
            return await send(route, error.status, error.body)
          }
          throw error
        }
      }

      // ------------------------------------------------------------ REST
      if (p.startsWith('/rest/v1/')) {
        const table = p.slice('/rest/v1/'.length)
        if (!(table in world.db)) return await refuse(route, request, url, `table ${table}`)
        const result = handleRest({
          method,
          table,
          params: url.searchParams,
          headers,
          body: bodyOf(request),
          db: world.db,
          hooks: {
            beforeInsert: (name, row) => {
              if (name !== 'content_versions') return undefined
              const clash = world.db.content_versions.some((v) => v.collection === row.collection && v.doc_id === row.doc_id && v.seq === row.seq)
              return clash ? { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "content_versions_pkey"', details: null, hint: null } } : undefined
            },
            afterInsert: (name, row) => {
              if (name !== 'content_versions') return
              row.created_at ??= new Date(now).toISOString()
              const doc = world.db.content_documents.find((d) => d.collection === row.collection && d.doc_id === row.doc_id)
              if (doc) Object.assign(doc, { latest_seq: row.seq, latest_data: row.data, latest_at: new Date(now).toISOString() })
              else world.db.content_documents.push({ collection: row.collection, doc_id: row.doc_id, latest_seq: row.seq, latest_data: row.data, latest_at: new Date(now).toISOString(), live_seq: null, scheduled_at: null, scheduled_seq: null })
            },
          },
        })
        served.push({ kind: 'rest', name: table, method, status: result.status })
        return await send(route, result.status, result.body, result.headers)
      }

      // ------------------------------------------------------------ auth
      if (p.startsWith('/auth/v1/')) {
        const sub = p.slice('/auth/v1/'.length)
        served.push({ kind: 'auth', name: `${method} ${sub}`, method, status: 200 })
        if (sub === 'user' && method === 'GET') return await send(route, 200, world.authUser)
        if (sub === 'token') return await send(route, 200, world.session())
        if (sub === 'logout') return await send(route, 204, undefined)
        if (sub === 'otp') return await send(route, 200, {})
        if (sub === 'verify') return await send(route, 200, world.session())
        if (sub === 'settings') return await send(route, 200, { external: { email: true, google: false }, disable_signup: true, mailer_autoconfirm: false })
        if (sub === 'factors' && method === 'POST') return await send(route, 200, world.enrolment())
        const factor = /^factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(sub)
        if (factor && method === 'DELETE') return await send(route, 200, { id: factor[1] })
        if (factor && factor[2] === 'challenge') return await send(route, 200, { id: uid('challenge'), type: 'totp', expires_at: Math.floor(now / 1000) + 300 })
        if (factor && factor[2] === 'verify') return await send(route, 200, world.session())
        served.pop()
        return await refuse(route, request, url, `auth ${method} ${sub}`)
      }

      // -------------------------------------------------- Edge Functions
      if (p.startsWith('/functions/v1/')) {
        const name = p.slice('/functions/v1/'.length)
        const handler = world.functions[name]
        const body = bodyOf(request) ?? {}
        const label = body.action ? `${name}:${body.action}` : name
        const result = handler ? handler(body) : undefined
        if (result === undefined) {
          unmocked.push({ method, url: `${p}${url.search}`, reason: `function ${label}` })
          served.push({ kind: 'function', name: label, method, status: 501 })
          return await send(route, 501, { ok: false, error: { code: 'HARNESS501', message: `harness: unmocked function call (${label})` } })
        }
        const status = typeof result.status === 'number' && 'body' in result ? result.status : 200
        const payload = typeof result.status === 'number' && 'body' in result ? result.body : result
        served.push({ kind: 'function', name: label, method, status })
        return await send(route, status, payload)
      }

      // --------------------------------------------------------- storage
      const media = /^\/storage\/v1\/object\/public\/media-public\/m\/([0-9a-f-]{36})\/(\d+)\.webp$/.exec(p)
      if (media) {
        const file = world.mediaFiles.get(media[1])
        if (!file) return await send(route, 404, { message: 'harness: no such image' })
        let buffer = fileCache.get(file)
        if (!buffer) {
          buffer = readFileSync(file)
          fileCache.set(file, buffer)
        }
        served.push({ kind: 'storage', name: 'media-public', method, status: 200 })
        return await route.fulfill({
          status: 200,
          headers: { ...CORS, 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' },
          body: buffer,
        })
      }

      // A signed upload (media parts, paid files): the mock accepts the bytes and keeps none.
      const upload = /^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(p)
      if (upload && (method === 'PUT' || method === 'POST')) {
        served.push({ kind: 'storage', name: `upload ${upload[1]}`, method, status: 200 })
        return await send(route, 200, { Key: `${upload[1]}/${upload[2]}` })
      }

      return await refuse(route, request, url, `path ${p}`)
    } finally {
      state.inflight -= 1
      state.lastActivity = Date.now()
    }
  }

  return { handle, served, unmocked, state }
}
