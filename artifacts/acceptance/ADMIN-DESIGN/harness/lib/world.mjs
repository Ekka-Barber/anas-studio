// One screen's world: a private copy of the data for a role and a scenario,
// the RPC and Edge Function handlers over it, and the signed-in user.
import { clone, rng, uid } from './util.mjs'

export class HttpFailure extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

const b64url = (text) => Buffer.from(text).toString('base64url')

/**
 * A placeholder QR image (finder squares and seeded noise) for the enrolment screen; it does not encode
 * anything. GoTrue answers raw SVG markup and auth-js turns it into `data:image/svg+xml;utf-8,<markup>`,
 * so the markup avoids `#` and `%` (colour names only).
 */
function placeholderQr(seed) {
  const random = rng(seed)
  const size = 29
  const cells = []
  const finder = (x, y) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        if (edge || core) cells.push([x + dx, y + dy])
      }
    }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder = (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8)
      if (!inFinder && random() < 0.48) cells.push([x, y])
    }
  }
  const rects = cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${size + 4} ${size + 4}" width="${(size + 4) * 6}" height="${(size + 4) * 6}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="white"/><g fill="black">${rects}</g></svg>`
}

export function buildWorld(data, { role = 'owner', scenario = {} }) {
  const T = data.T
  const person = data.people[role] ?? data.people.owner
  const db = {
    staff: [{ user_id: person.id, display_name: person.name, role, active: true }],
    content_documents: clone(data.contentDocuments),
    content_versions: clone(data.contentVersions),
    published_documents: clone(data.published),
    media: clone(data.media),
    products: clone(data.products),
    product_variants: clone(data.variants),
    shipping_rates: clone(data.shippingRates),
    coupons: clone(data.coupons),
    customers: clone(data.customers),
    notifications: clone(data.notifications),
    audit_events: clone(data.auditEvents),
  }
  // The few lists the handlers change (a save, a revoke) are this world's own.
  const commerceSettings = clone(data.commerceSettings)
  const staffDirectory = clone(data.staffDirectory)
  const variantInfo = new Map([...data.variantInfo].map(([id, info]) => [id, clone(info)]))
  const mediaFiles = new Map(data.mediaFiles)
  const tickets = new Map()

  // ------------------------------------------------------------------ auth
  const hasTotp = scenario.noFactors ? false : role !== 'editor'
  const factors = hasTotp
    ? [{ id: uid(`factor:${role}`), friendly_name: 'تطبيق المصادقة', factor_type: 'totp', status: 'verified', created_at: T.iso(T.ago(60 * 24 * 30)), updated_at: T.iso(T.ago(60 * 24 * 30)) }]
    : []
  const authUser = {
    id: person.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: person.email,
    email_confirmed_at: T.iso(T.ago(60 * 24 * 200)),
    phone: '',
    confirmed_at: T.iso(T.ago(60 * 24 * 200)),
    last_sign_in_at: T.iso(T.ago(25)),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    factors,
    created_at: T.iso(T.ago(60 * 24 * 200)),
    updated_at: T.iso(T.ago(25)),
    is_anonymous: false,
  }
  const expiresAt = Math.floor(T.now / 1000) + 10 * 365 * 24 * 3600
  function session() {
    const payload = {
      iss: 'https://mock.supabase.invalid/auth/v1',
      sub: person.id,
      aud: 'authenticated',
      exp: expiresAt,
      iat: Math.floor(T.now / 1000) - 1500,
      email: person.email,
      phone: '',
      app_metadata: authUser.app_metadata,
      user_metadata: {},
      role: 'authenticated',
      aal: hasTotp ? 'aal2' : 'aal1',
      amr: hasTotp ? [{ method: 'otp', timestamp: Math.floor(T.now / 1000) - 1500 }, { method: 'totp', timestamp: Math.floor(T.now / 1000) - 1400 }] : [{ method: 'otp', timestamp: Math.floor(T.now / 1000) - 1500 }],
      session_id: uid(`session:${role}`),
      is_anonymous: false,
    }
    return {
      access_token: `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.`,
      token_type: 'bearer',
      expires_in: 315360000,
      expires_at: expiresAt,
      refresh_token: 'mock-refresh-token',
      user: authUser,
    }
  }
  const enrolment = () => ({
    id: uid('factor:new'),
    type: 'totp',
    friendly_name: 'تطبيق المصادقة',
    totp: { qr_code: placeholderQr('enrol'), secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/anas.studio:anas?secret=JBSWY3DPEHPK3PXP&issuer=anas.studio' },
  })

  // ------------------------------------------------------------------- rpc
  const fail = (name) => {
    const status = scenario.failRpc?.[name]
    if (status) throw new HttpFailure(status, { code: 'XX000', message: 'harness: this call is made to fail on purpose', details: null, hint: null })
  }
  const detailFor = (orderId) => {
    const found = data.orderDetails.get(orderId)
    if (!found) return { ok: false, code: 'NOT_FOUND' }
    const reply = { ok: true, ...clone(found) }
    if (role !== 'owner') {
      delete reply.disputes
      delete reply.audit
    }
    return reply
  }
  const contentRow = (collection, docId) => db.content_documents.find((row) => row.collection === collection && row.doc_id === docId)

  const rpc = {
    current_staff_role: () => {
      fail('current_staff_role')
      return role
    },
    orders_list: (args) => {
      fail('orders_list')
      if (scenario.ordersEmpty) return { rows: [], next: null }
      const filter = args.p_filter ?? 'all'
      const query = args.p_query ?? null
      const limit = Math.min(Number(args.p_limit ?? 50), 100)
      let rows = data.ordersListRows
      rows = rows.filter((row) => {
        if (filter === 'paid') return row.status === 'paid'
        if (filter === 'to_ship') return row.toShip > 0
        if (filter === 'needs_resolution') return row.status === 'paid_needs_resolution'
        if (filter === 'pending') return row.status === 'pending_payment'
        if (filter === 'refunded') return row.refunded > 0 || row.status === 'refunded'
        if (filter === 'review') return row.review
        return true
      })
      if (query) rows = rows.filter((row) => row.orderNumber === query || row.email === query)
      if (args.p_before) rows = rows.filter((row) => Date.parse(row.createdAt) < Date.parse(args.p_before))
      rows = [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      const page = rows.slice(0, limit)
      return { rows: clone(page), next: rows.length > limit ? page.at(-1).createdAt : null }
    },
    orders_alerts: () => {
      fail('orders_alerts')
      if (scenario.ordersEmpty) return { needsResolution: 0, review: 0, toShip: 0, uncertainRefunds: 0, unverifiedAttempts: 0, exhaustedEvents: 0, externalRefunds: 0, lowStock: [] }
      return data.alerts
    },
    order_detail: (args) => {
      fail('order_detail')
      return detailFor(args.p_order)
    },
    reconciliation_list: () => {
      fail('reconciliation_list')
      return data.reconciliation
    },
    disputes_list: () => {
      fail('disputes_list')
      return data.disputes
    },
    outbox_attention: () => {
      fail('outbox_attention')
      return scenario.mailClean ? [] : data.outbox
    },
    outbox_due_since: () => null,
    payments_due_since: () => null,
    job_runs_latest: () => {
      fail('job_runs_latest')
      return data.jobRuns
    },
    cron_failures_recent: () => data.cronFailures,
    commerce_settings_get: () => {
      fail('commerce_settings_get')
      return commerceSettings
    },
    staff_directory: () => {
      fail('staff_directory')
      return staffDirectory
    },
    variant_admin_info: (args) => variantInfo.get(args.p_variant) ?? { ok: false, code: 'NOT_FOUND' },
    media_where_used: (args) => data.whereUsed.get(args.p_id)?.content ?? [],
    media_product_usage: (args) => data.whereUsed.get(args.p_id)?.products ?? [],
    media_rename_folder: (args) => {
      let moved = 0
      for (const row of db.media) {
        if (row.folder === args.p_from || row.folder.startsWith(`${args.p_from}/`)) {
          row.folder = args.p_to + row.folder.slice(args.p_from.length)
          moved += 1
        }
      }
      return moved
    },
    outbox_replay: () => null,
    outbox_close: () => ({ ok: true }),
    fulfillment_update: (args) => ({ ok: true, changed: (args.p_item_ids ?? []).length }),
    fulfillment_correct: (args) => ({ ok: true, changed: (args.p_item_ids ?? []).length, corrected: true }),
    return_decide: () => ({ ok: true }),
    return_receive: () => ({ ok: true, restocked: [] }),
    order_resolve: () => ({ ok: true }),
    review_close: () => ({ ok: true }),
    publish_version: (args) => {
      const row = contentRow(args.p_collection, args.p_doc_id)
      if (row) {
        row.live_seq = args.p_seq
        row.scheduled_at = null
        row.scheduled_seq = null
      }
      return null
    },
    schedule_version: (args) => {
      const row = contentRow(args.p_collection, args.p_doc_id)
      if (row) {
        row.scheduled_at = args.p_at
        row.scheduled_seq = args.p_seq
      }
      return null
    },
    cancel_schedule: (args) => {
      const row = contentRow(args.p_collection, args.p_doc_id)
      if (row) {
        row.scheduled_at = null
        row.scheduled_seq = null
      }
      return null
    },
    archive_document: (args) => {
      const row = contentRow(args.p_collection, args.p_doc_id)
      if (row) row.live_seq = null
      return null
    },
  }

  // --------------------------------------------------------- edge functions
  const functions = {
    admin: (body) => {
      switch (body.action) {
        case 'stats':
          if (scenario.failStats) return { status: 500, body: { ok: false, error: { code: 'FAILED', message: 'تعذّر تحميل الإحصاءات.' } } }
          return { ok: true, data: data.stats }
        case 'status':
          return { ok: true, data: data.settingsStatus }
        case 'commerce-settings-save':
        case 'commerce-policies-approve':
        case 'commerce-checkout-set':
          commerceSettings.version += 1
          return { ok: true, data: { version: commerceSettings.version } }
        case 'media-delete': {
          db.media = db.media.filter((row) => row.id !== body.id)
          return { ok: true, data: { id: body.id } }
        }
        case 'payment-recheck':
          return { ok: true, data: { status: 'paid' } }
        case 'refund-recheck':
          return { ok: true, data: { refundId: body.refundId, status: 'succeeded', amount: 4500 } }
        case 'order-link-reissue':
          return { ok: true, data: { version: 2, emailChanged: Boolean(body.email) } }
        case 'refund-create':
          return { ok: true, data: { refundId: uid(`refund:new:${body.idempotencyKey ?? ''}`), status: 'succeeded', amount: body.amount } }
        case 'refund-record-external':
          return { ok: true, data: { refundId: uid('refund:external'), status: 'succeeded', amount: 3000 } }
        case 'dispute-record':
          return {
            ok: true,
            data: {
              duplicate: false,
              dispute: {
                id: uid(`dispute:new:${body.providerRef}:${body.follows}`),
                kind: body.kind,
                providerRef: body.providerRef,
                seq: (body.follows ?? 0) + 1,
                attemptId: body.attemptId ?? null,
                reviewPaymentId: body.reviewPaymentId ?? null,
                environment: 'live',
                amount: body.amount,
                direction: body.direction,
                occurredOn: body.occurredOn,
                reason: body.reason,
                resolution: body.resolution ?? null,
                decision: body.decision,
                itemIds: body.itemIds ?? [],
                createdAt: T.pg(T.now),
              },
            },
          }
        case 'media-ticket': {
          const declaration = body.declaration ?? {}
          const ticketId = uid(`media-ticket:${tickets.size}:${declaration.name}`)
          tickets.set(ticketId, declaration)
          const parts = [
            { part: 'original', path: `t/${ticketId}/original`, token: 'mock-upload-token', mime: declaration.original?.mime ?? 'image/jpeg' },
            ...(declaration.derivatives ?? []).map((d) => ({ part: `w${d.width}`, path: `t/${ticketId}/w${d.width}`, token: 'mock-upload-token', mime: 'image/webp' })),
          ]
          return { ok: true, data: { ticketId, bucket: 'media-private', parts } }
        }
        case 'media-complete': {
          const declaration = tickets.get(body.ticketId)
          if (!declaration) return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: 'لم نجد تذكرة الرفع.' } } }
          const id = uid(`media-new:${body.ticketId}`)
          const first = db.media[0]
          db.media.unshift({
            id,
            name: declaration.name,
            folder: declaration.folder ?? '',
            alt_ar: declaration.altAr,
            caption: declaration.caption || null,
            rights: declaration.rights,
            original_bytes: declaration.original?.bytes ?? 0,
            original_width: declaration.original?.width ?? 0,
            original_height: declaration.original?.height ?? 0,
            original_mime: declaration.original?.mime ?? 'image/jpeg',
            derivatives: (declaration.derivatives ?? []).map((d) => ({ width: d.width, height: d.height, bytes: d.bytes, key: `m/${id}/${d.width}.webp` })),
            created_at: T.pg(T.now),
          })
          // The mock keeps no bytes: the new image is drawn with the newest existing photo.
          if (first && mediaFiles.get(first.id)) mediaFiles.set(id, mediaFiles.get(first.id))
          return { ok: true, data: { id } }
        }
        case 'paid-file-ticket':
          return { ok: true, data: { ticket: uid(`paid-ticket:${body.variantId}:${body.filename}`), bucket: 'paid-files', path: `v/${body.variantId}/${body.filename}`, token: 'mock-upload-token' } }
        case 'paid-file-complete': {
          const info = variantInfo.get(body.variantId)
          if (info) info.file = { filename: body.filename, mime: body.mime, bytes: 2_345_678, createdAt: T.pg(T.now) }
          return { ok: true, data: { assetId: uid(`asset:${body.ticket}`), filled: 0 } }
        }
        default:
          return undefined
      }
    },
    'staff-admin': (body) => {
      if (scenario.stepUp) return { status: 403, body: { ok: false, error: { code: 'STEP_UP_REQUIRED', message: 'يلزم رمز تطبيق المصادقة لإكمال هذا الإجراء.' } } }
      const member = staffDirectory.find((row) => row.user_id === body.userId)
      if (body.action === 'set_role' && member) member.role = body.role
      if (body.action === 'set_active' && member) member.active = body.active
      return { ok: true, data: {} }
    },
  }

  return { role, person, db, rpc, functions, session, authUser, factors, enrolment, mediaFiles }
}
