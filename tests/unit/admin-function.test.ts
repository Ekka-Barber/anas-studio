// D32: the `admin` and `outbox` Edge Functions' handlers, with every
// dependency faked — staff identity, the database (`Rpc`) and storage — so
// the role gates, the media upload checks and the jobs bearer gate run
// without a Supabase stack. The SQL side of the same functions is proven in
// tests/integration/media-security.test.ts and outbox.test.ts.
import { createHash, randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAdmin, type MediaStore, PRIVATE_BUCKET, PUBLIC_BUCKET } from '../../supabase/functions/_shared/admin.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { handleJobs } from '../../supabase/functions/_shared/jobs.ts'
import { runOutbox } from '../../supabase/functions/_shared/outbox.ts'
import type { PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import type { MoyasarClient, PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import type { StaffIdentity } from '../../supabase/functions/_shared/staff.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

function post(body: unknown): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
    body: JSON.stringify(body),
  })
}

/** An in-memory storage with a log of every call. */
function memoryStore(): MediaStore & { objects: Map<string, Uint8Array>; removed: string[] } {
  const objects = new Map<string, Uint8Array>()
  const removed: string[] = []
  return {
    objects,
    removed,
    async signedUpload(bucket, key) {
      return { path: key, token: `token-for-${bucket}/${key}` }
    },
    async read(bucket, key) {
      return objects.get(`${bucket}/${key}`) ?? null
    },
    async write(bucket, key, bytes) {
      objects.set(`${bucket}/${key}`, bytes)
    },
    async move(bucket, from, to) {
      const bytes = objects.get(`${bucket}/${from}`)
      if (!bytes) throw new Error('missing')
      objects.delete(`${bucket}/${from}`)
      objects.set(`${bucket}/${to}`, bytes)
    },
    async remove(bucket, keys) {
      for (const key of keys) {
        objects.delete(`${bucket}/${key}`)
        removed.push(`${bucket}/${key}`)
      }
    },
  }
}

function staffAs(role: StaffIdentity['role'] | 'none', recentTotp = false): () => Promise<StaffIdentity | null> {
  return async () => (role === 'none' ? null : { userId: '11111111-1111-4111-8111-111111111111', role, recentTotp })
}

async function webp(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 90, g: 70, b: 50 } } }).webp().toBuffer(),
  )
}

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer(),
  )
}

/** A valid declaration for a 400×300 original cropped whole (one 360px derivative). */
function declaration(originalBytes: number, derivativeBytes: number) {
  return {
    purpose: 'image',
    name: 'غلاف',
    folder: '',
    altAr: 'وصف عربي',
    caption: '',
    rights: 'تصوير أنس',
    original: { mime: 'image/jpeg', bytes: originalBytes, width: 400, height: 300 },
    crop: { x: 0, y: 0, width: 400, height: 300 },
    derivatives: [{ width: 360, height: 270, bytes: derivativeBytes }],
  }
}

describe('admin function: who may do what', () => {
  const rpc: Rpc = vi.fn(async () => null)

  it('no staff token is 401, an unknown action is 422', async () => {
    const store = memoryStore()
    expect((await handleAdmin(post({ action: 'stats' }), { rpc, staff: staffAs('none'), store })).status).toBe(401)
    expect((await handleAdmin(post({ action: 'nope' }), { rpc, staff: staffAs('owner'), store })).status).toBe(422)
  })

  it('a failed staff lookup is a 500 with the JSON contract, not a 401', async () => {
    const staff = async (): Promise<StaffIdentity | null> => {
      throw new Error('STAFF_LOOKUP_FAILED')
    }
    const response = await handleAdmin(post({ action: 'stats' }), { rpc, staff, store: memoryStore() })
    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FAILED' } })
  })

  it.each([
    ['operations', 'media-ticket'],
    ['operations', 'media-delete'],
    ['editor', 'stats'],
    ['editor', 'status'],
    ['operations', 'status'],
    ['operations', 'stats'],
    [null, 'media-complete'],
    ['editor', 'paid-file-ticket'],
    ['operations', 'paid-file-ticket'],
    ['editor', 'paid-file-complete'],
    ['operations', 'paid-file-complete'],
  ] as const)('%s is refused %s with 403', async (role, action) => {
    const response = await handleAdmin(post({ action }), { rpc, staff: staffAs(role), store: memoryStore() })
    expect(response.status).toBe(403)
  })

  it('the HTTP shell refuses what is not a small JSON POST', async () => {
    const store = memoryStore()
    const get = new Request('http://127.0.0.1:54321/functions/v1/admin', { method: 'GET' })
    expect((await handleAdmin(get, { rpc, staff: staffAs('owner'), store })).status).toBe(405)
    const malformed = new Request('http://127.0.0.1:54321/functions/v1/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
      body: 'not json',
    })
    expect((await handleAdmin(malformed, { rpc, staff: staffAs('owner'), store })).status).toBe(400)
    const oversized = new Request('http://127.0.0.1:54321/functions/v1/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
      body: JSON.stringify({ action: 'status', padding: 'x'.repeat(17_000) }),
    })
    expect((await handleAdmin(oversized, { rpc, staff: staffAs('owner'), store })).status).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('status is booleans and names only, never a secret value', async () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_c2VjcmV0')
    const response = await handleAdmin(post({ action: 'status' }), { rpc, staff: staffAs('owner'), store: memoryStore() })
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain('whsec_')
    expect(text).not.toContain('1x0000')
    expect(JSON.parse(text).data).toMatchObject({ turnstile: { configured: true, testSecret: true }, webhook: true, siteHost: 'localhost' })
  })

  it('analytics is configured only when fetchAnalytics would run: it needs a SITE_URL host too', async () => {
    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone-123')
    const analytics = async () => {
      const response = await handleAdmin(post({ action: 'status' }), { rpc, staff: staffAs('owner'), store: memoryStore() })
      return ((await response.json()) as { data: { analytics: boolean } }).data.analytics
    }
    vi.stubEnv('SITE_URL', 'anas.studio')
    expect(await analytics()).toBe(false)
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    expect(await analytics()).toBe(true)
  })
})

describe('admin function: media upload (P05 checks, D32 storage)', () => {
  it('a ticket answers one signed upload per part, all in private quarantine', async () => {
    const ticketId = randomUUID()
    const calls: Array<[string, Record<string, unknown>]> = []
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      return { id: ticketId, expiresAt: new Date().toISOString() }
    }
    const response = await handleAdmin(post({ action: 'media-ticket', declaration: declaration(1000, 500) }), {
      rpc,
      staff: staffAs('editor'),
      store: memoryStore(),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { data: { bucket: string; parts: Array<{ part: string; path: string }> } }
    expect(body.data.bucket).toBe(PRIVATE_BUCKET)
    expect(body.data.parts.map((p) => [p.part, p.path])).toEqual([
      ['original', `quarantine/${ticketId}/original`],
      ['w360', `quarantine/${ticketId}/360.webp`],
    ])
    expect(calls[0]![0]).toBe('media_create_ticket')
    expect(calls[0]![1].p_actor).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('an invalid declaration is refused before any ticket exists', async () => {
    const rpc = vi.fn(async () => null)
    const bad = { ...declaration(1000, 500), derivatives: [{ width: 720, height: 540, bytes: 500 }] }
    const response = await handleAdmin(post({ action: 'media-ticket', declaration: bad }), {
      rpc,
      staff: staffAs('owner'),
      store: memoryStore(),
    })
    expect(response.status).toBe(422)
    expect(rpc).not.toHaveBeenCalled()
  })

  async function uploaded(originalBytes: Uint8Array, derivativeBytes: Uint8Array) {
    const ticketId = randomUUID()
    const store = memoryStore()
    store.objects.set(`${PRIVATE_BUCKET}/quarantine/${ticketId}/original`, originalBytes)
    store.objects.set(`${PRIVATE_BUCKET}/quarantine/${ticketId}/360.webp`, derivativeBytes)
    const calls: string[] = []
    const args: Record<string, unknown>[] = []
    const rpc: Rpc = async (fn, fnArgs) => {
      calls.push(fn)
      args.push(fnArgs)
      if (fn === 'media_claim') return declaration(originalBytes.byteLength, derivativeBytes.byteLength)
      return ticketId
    }
    return { ticketId, store, calls, args, rpc }
  }

  it('completes: checked bytes go public, the original moves out of quarantine', async () => {
    const original = await jpeg(400, 300)
    const { ticketId, store, calls, args, rpc } = await uploaded(original, await webp(360, 270))
    const response = await handleAdmin(post({ action: 'media-complete', ticketId }), { rpc, staff: staffAs('editor'), store })
    expect(response.status).toBe(201)
    expect(calls).toEqual(['media_claim', 'media_complete'])
    // The recorded MD5 is the original's, as hex.
    expect(args[1]!.p_original_md5).toBe(createHash('md5').update(original).digest('hex'))
    expect(store.objects.has(`${PUBLIC_BUCKET}/m/${ticketId}/360.webp`)).toBe(true)
    expect(store.objects.has(`${PRIVATE_BUCKET}/originals/${ticketId}`)).toBe(true)
    expect([...store.objects.keys()].some((key) => key.includes('quarantine/'))).toBe(false)
  })

  it('a derivative that is not the declared image is refused and nothing becomes public', async () => {
    // Declared 360×270 WebP, uploaded a 360×200 one.
    const { ticketId, store, calls, rpc } = await uploaded(await jpeg(400, 300), await webp(360, 200))
    const response = await handleAdmin(post({ action: 'media-complete', ticketId }), { rpc, staff: staffAs('owner'), store })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('DIMENSION_MISMATCH')
    expect(calls).toEqual(['media_claim'])
    expect([...store.objects.keys()].some((key) => key.startsWith(`${PUBLIC_BUCKET}/`))).toBe(false)
    expect([...store.objects.keys()]).toEqual([])
  })

  it('an original whose real bytes are not the declared type is refused', async () => {
    // Declared JPEG, uploaded PNG bytes of the right size.
    const png = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } }).png().toBuffer())
    const { ticketId, store, rpc } = await uploaded(png, await webp(360, 270))
    const response = await handleAdmin(post({ action: 'media-complete', ticketId }), { rpc, staff: staffAs('owner'), store })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TYPE_MISMATCH')
  })

  it('an unfinished upload (a declared part never arrived) is MISSING_PART and the quarantine is cleaned', async () => {
    // Declaration covers original + w360; only the original was uploaded.
    const original = await jpeg(400, 300)
    const ticketId = randomUUID()
    const store = memoryStore()
    store.objects.set(`${PRIVATE_BUCKET}/quarantine/${ticketId}/original`, original)
    const calls: string[] = []
    const rpc: Rpc = async (fn) => {
      calls.push(fn)
      if (fn === 'media_claim') return declaration(original.byteLength, await webp(360, 270).then((b) => b.byteLength))
      return ticketId
    }
    const response = await handleAdmin(post({ action: 'media-complete', ticketId }), { rpc, staff: staffAs('owner'), store })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('MISSING_PART')
    // Claimed for clean-up, never completed, and nothing is left in quarantine or public.
    expect(calls).toEqual(['media_claim'])
    expect([...store.objects.keys()].some((key) => key.includes('quarantine/'))).toBe(false)
    expect([...store.objects.keys()].some((key) => key.startsWith(`${PUBLIC_BUCKET}/`))).toBe(false)
  })

  it('if the database refuses the media row, the promoted derivatives are removed again', async () => {
    const { ticketId, store, rpc: base } = await uploaded(await jpeg(400, 300), await webp(360, 270))
    const rpc: Rpc = async (fn, args) => {
      if (fn === 'media_complete') throw Object.assign(new Error('refused'), { code: '42501' })
      return base(fn, args)
    }
    const response = await handleAdmin(post({ action: 'media-complete', ticketId }), { rpc, staff: staffAs('owner'), store })
    expect(response.status).toBe(403)
    expect(store.objects.has(`${PUBLIC_BUCKET}/m/${ticketId}/360.webp`)).toBe(false)
  })
})

describe('admin function: commerce settings save (P06 round 3, D34)', () => {
  const settings = { sellerLegalName: 'أنس عبدالله', sellerAddress: 'الرياض، حي النرجس', sellerRegistration: '1012345678' }
  const body = { action: 'commerce-settings-save', expectedVersion: 0, settings }

  it('an editor or operations member is refused with 403 FORBIDDEN and nothing runs', async () => {
    const rpc = vi.fn(async () => null)
    for (const role of ['editor', 'operations'] as const) {
      const response = await handleAdmin(post(body), { rpc, staff: staffAs(role, true), store: memoryStore() })
      expect(response.status).toBe(403)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('an owner without a fresh TOTP is told to step up and the RPC is not called', async () => {
    const rpc = vi.fn(async () => null)
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner'), store: memoryStore() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'STEP_UP_REQUIRED', message: 'أدخل رمز تطبيق المصادقة للمتابعة.' },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('an invalid body, a tax or vat key included, is 422 with field errors', async () => {
    const rpc = vi.fn(async () => null)
    const owner = staffAs('owner', true)
    const store = memoryStore()
    const responses = await Promise.all([
      handleAdmin(post({ ...body, settings: { ...settings, tax: 0.15 } }), { rpc, staff: owner, store }),
      handleAdmin(post({ ...body, settings: { ...settings, vat: 'x' } }), { rpc, staff: owner, store }),
      // A C1 control character, which the table's [[:cntrl:]] check refuses too.
      handleAdmin(post({ ...body, settings: { ...settings, sellerAddress: 'الرياض\u0085' } }), { rpc, staff: owner, store }),
      // expectedVersion missing.
      handleAdmin(post({ action: 'commerce-settings-save', settings }), { rpc, staff: owner, store }),
    ])
    for (const response of responses) {
      expect(response.status).toBe(422)
      expect(((await response.json()) as { error: { code: string; fields: unknown } }).error.fields).toBeTruthy()
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a stale version (SQL unique_violation 23505) answers 409 CONFLICT with the reload message', async () => {
    const rpc: Rpc = async () => {
      throw Object.assign(new Error('stale version'), { code: '23505' })
    }
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner', true), store: memoryStore() })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'CONFLICT', message: 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.' },
    })
  })

  it('a valid save calls the SQL function as the actor and answers the new version', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      return 1
    }
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner', true), store: memoryStore() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { version: 1 } })
    expect(calls).toEqual([
      [
        'commerce_settings_save',
        {
          p_actor: '11111111-1111-4111-8111-111111111111',
          p_expected_version: 0,
          p_seller_legal_name: 'أنس عبدالله',
          p_seller_address: 'الرياض، حي النرجس',
          p_seller_registration: '1012345678',
        },
      ],
    ])
  })
})

describe('admin function: commerce policies approve (P07 round 2)', () => {
  const body = { action: 'commerce-policies-approve', expectedVersion: 3 }

  it('an editor or operations member is refused with 403 and nothing runs', async () => {
    const rpc = vi.fn(async () => null)
    for (const role of ['editor', 'operations'] as const) {
      const response = await handleAdmin(post(body), { rpc, staff: staffAs(role, true), store: memoryStore() })
      expect(response.status).toBe(403)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('an owner without a fresh TOTP is told to step up and the RPC is not called', async () => {
    const rpc = vi.fn(async () => null)
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner'), store: memoryStore() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a body without expectedVersion is 422 with field errors', async () => {
    const rpc = vi.fn(async () => null)
    const response = await handleAdmin(post({ action: 'commerce-policies-approve' }), {
      rpc,
      staff: staffAs('owner', true),
      store: memoryStore(),
    })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { code: string; fields: unknown } }).error.fields).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a stale version (SQL unique_violation 23505) answers 409 CONFLICT', async () => {
    const rpc: Rpc = async () => {
      throw Object.assign(new Error('stale version'), { code: '23505' })
    }
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner', true), store: memoryStore() })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it('a missing required policy (SQL P0001) answers 422 POLICIES_NOT_PUBLISHED', async () => {
    const rpc: Rpc = async () => {
      throw Object.assign(new Error('Publish the store, delivery and refund policies first.'), { code: 'P0001' })
    }
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner', true), store: memoryStore() })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'POLICIES_NOT_PUBLISHED', message: 'انشر سياسات المتجر والتوصيل والاسترجاع أولًا.' },
    })
  })

  it('a valid approval calls the SQL function as the actor and passes its reply through', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const reply = { version: 4, policyRevisions: { store: 2, delivery: 1, refund: 1 } }
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      return reply
    }
    const response = await handleAdmin(post(body), { rpc, staff: staffAs('owner', true), store: memoryStore() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: reply })
    expect(calls).toEqual([
      ['commerce_policies_approve', { p_actor: '11111111-1111-4111-8111-111111111111', p_expected_version: 3 }],
    ])
  })
})

describe('runOutbox: a run that claims nothing while mail is due is a held run (EF-comms-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function configureResend() {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', 'Anas <noreply@anas.studio>')
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    vi.stubEnv('EMAIL_DEV_MAILPIT_URL', '')
    // A configured deployment: the dispatcher claims nothing while it cannot build a link.
    vi.stubEnv('TOKEN_HASH_PEPPER', 'test-pepper-for-the-outbox-tests')
  }

  it('records partial with QUOTA_HELD, so the owner home cannot read it as a healthy run', async () => {
    configureResend()
    const runs: Array<Record<string, unknown>> = []
    const rpc: Rpc = async (fn, args) => {
      if (fn === 'job_run_record') runs.push(args)
      return fn === 'outbox_claim' ? [] : null
    }
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'partial', claimed: 0, reason: 'QUOTA_HELD' })
    expect(runs).toEqual([
      expect.objectContaining({
        p_job: 'email_outbox',
        p_status: 'partial',
        p_detail: { claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0, reason: 'QUOTA_HELD' },
      }),
    ])
  })

  it('a run that sent what it claimed is still ok, with no reason', async () => {
    configureResend()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'prov-1' }), { status: 200 })))
    const runs: Array<Record<string, unknown>> = []
    let claims = 0
    const rpc: Rpc = async (fn, args) => {
      if (fn === 'job_run_record') runs.push(args)
      if (fn === 'outbox_claim') {
        claims += 1
        return claims === 1
          ? [{ id: '1', lease_id: 'lease', kind: 'contact_notice', recipient: 'owner@example.com', payload: { contactId: 'c1' }, idempotency_key: 'k', attempts: 1 }]
          : []
      }
      if (fn === 'contact_for_notice') return [{ name: 'زائر', email: 'guest@example.com', message: 'مرحبا', created_at: new Date().toISOString() }]
      return null
    }
    const summary = await runOutbox(rpc)
    expect(summary).toMatchObject({ status: 'ok', claimed: 1, accepted: 1 })
    expect(summary.reason).toBeUndefined()
    expect(runs[0]).toMatchObject({ p_status: 'ok', p_detail: { claimed: 1, accepted: 1 } })
  })
})

describe('outbox function (jobs bearer gate)', () => {
  const request = (authorization?: string) =>
    new Request('http://127.0.0.1:54321/functions/v1/outbox', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    })

  it('without JOBS_SECRET the endpoint does not exist; a wrong bearer is 401', async () => {
    const rpc = vi.fn(async () => null)
    expect((await handleJobs(request('Bearer x'), rpc)).status).toBe(404)
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    expect((await handleJobs(request(), rpc)).status).toBe(401)
    expect((await handleJobs(request('Bearer wrong'), rpc)).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('the right bearer runs the outbox once and answers counts only', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const rpc = vi.fn(async () => null)
    const response = await handleJobs(request('Bearer local-jobs-secret'), rpc)
    expect(response.status).toBe(200)
    // No email provider is configured here, so the run is recorded as skipped.
    expect(await response.json()).toMatchObject({ ok: true, data: [{ job: 'email_outbox', status: 'skipped' }] })
    expect(rpc).toHaveBeenCalledWith('job_run_record', expect.objectContaining({ p_job: 'email_outbox', p_status: 'skipped' }))
  })

  const jobRequest = (body: string) =>
    new Request('http://127.0.0.1:54321/functions/v1/outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer local-jobs-secret', 'content-type': 'application/json' },
      body,
    })

  it('an unknown job or a body that is not JSON is 400 and runs nothing', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const rpc = vi.fn(async () => null)
    expect((await handleJobs(jobRequest('{"job":"drop_everything"}'), rpc)).status).toBe(400)
    expect((await handleJobs(jobRequest('not json'), rpc)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('media_sweep removes stale quarantine parts in batches, purges old tickets and records the run (I29)', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const store = memoryStore()
    const stale = Array.from({ length: 130 }, (_, i) => `quarantine/${randomUUID()}/${i}.webp`)
    for (const key of stale) store.objects.set(`${PRIVATE_BUCKET}/${key}`, new Uint8Array([1]))
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'media_sweep_candidates') {
        return stale.filter((key) => store.objects.has(`${PRIVATE_BUCKET}/${key}`)).slice(0, args.p_limit as number)
      }
      if (fn === 'media_tickets_purge') return 7
      return null
    })
    const response = await handleJobs(jobRequest('{"job":"media_sweep"}'), rpc, () => store)
    expect(await response.json()).toEqual({
      ok: true,
      data: [{ job: 'media_sweep', status: 'ok', objects: 130, tickets: 7, paidFiles: 0 }],
    })
    expect(store.objects.size).toBe(0)
    expect(store.removed.every((key) => key.startsWith(`${PRIVATE_BUCKET}/quarantine/`))).toBe(true)
    expect(rpc).toHaveBeenCalledWith('job_run_record', {
      p_job: 'media_sweep',
      p_status: 'ok',
      p_detail: { objects: 130, tickets: 7, paidFiles: 0 },
      p_started_at: expect.any(String),
    })
    expect(rpc).not.toHaveBeenCalledWith('outbox_claim', expect.anything())
  })

  it('media_sweep also removes the paid files\' abandoned uploads under incoming/, and never anything under assets/', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const store = memoryStore()
    const abandoned = Array.from({ length: 120 }, () => `incoming/${randomUUID()}`)
    const kept = [`assets/${randomUUID()}/${randomUUID()}`, `incoming/${randomUUID()}`]
    for (const key of [...abandoned, ...kept]) store.objects.set(`paid-files/${key}`, new Uint8Array([1]))
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      // What `public.paid_files_sweep_candidates` answers: the old parts under incoming/, oldest first.
      if (fn === 'paid_files_sweep_candidates') {
        return abandoned.filter((key) => store.objects.has(`paid-files/${key}`)).slice(0, args.p_limit as number)
      }
      return null
    })
    const response = await handleJobs(jobRequest('{"job":"media_sweep"}'), rpc, () => store)
    expect(await response.json()).toEqual({ ok: true, data: [{ job: 'media_sweep', status: 'ok', objects: 0, tickets: 0, paidFiles: 120 }] })
    expect(store.removed).toHaveLength(120)
    expect(store.removed.every((key) => key.startsWith('paid-files/incoming/'))).toBe(true)
    // What was not listed is still there: a fresh part and every asset.
    expect([...store.objects.keys()].sort()).toEqual(kept.map((key) => `paid-files/${key}`).sort())
    expect(rpc).toHaveBeenCalledWith('job_run_record', {
      p_job: 'media_sweep',
      p_status: 'ok',
      p_detail: { objects: 0, tickets: 0, paidFiles: 120 },
      p_started_at: expect.any(String),
    })
  })

  it('media_sweep fails the run, and removes nothing, when the list names a key that is not under incoming/', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const store = memoryStore()
    const asset = `assets/${randomUUID()}/${randomUUID()}`
    store.objects.set(`paid-files/${asset}`, new Uint8Array([1]))
    store.objects.set(`paid-files/incoming/${randomUUID()}`, new Uint8Array([1]))
    const rpc = vi.fn(async (fn: string) => (fn === 'paid_files_sweep_candidates' ? [`incoming/${randomUUID()}`, asset] : null))
    const response = await handleJobs(jobRequest('{"job":"media_sweep"}'), rpc, () => store)
    expect(await response.json()).toMatchObject({ ok: true, data: [{ job: 'media_sweep', status: 'failed', paidFiles: 0 }] })
    expect(store.removed).toEqual([])
    expect(store.objects.has(`paid-files/${asset}`)).toBe(true)
    expect(rpc).toHaveBeenCalledWith('job_run_record', expect.objectContaining({ p_job: 'media_sweep', p_status: 'failed' }))
    // The same guard holds for the media bucket: a key outside quarantine/ is never removed.
    const media = memoryStore()
    media.objects.set(`${PRIVATE_BUCKET}/originals/${randomUUID()}`, new Uint8Array([1]))
    const original = `originals/${randomUUID()}`
    const mediaRpc = vi.fn(async (fn: string) => (fn === 'media_sweep_candidates' ? [original] : null))
    const mediaResponse = await handleJobs(jobRequest('{"job":"media_sweep"}'), mediaRpc, () => media)
    expect(await mediaResponse.json()).toMatchObject({ data: [{ status: 'failed', objects: 0 }] })
    expect(media.removed).toEqual([])
  })

  it('media_sweep sweeps the paid files even when the media sweep failed, and the other way round', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const store = memoryStore()
    const part = `incoming/${randomUUID()}`
    store.objects.set(`paid-files/${part}`, new Uint8Array([1]))
    // The media bucket's removal is refused by Storage (the part stays listed); the paid files go on regardless.
    const failing = {
      ...store,
      async remove(bucket: string, keys: string[]) {
        if (bucket === PRIVATE_BUCKET) return
        return store.remove(bucket, keys)
      },
    }
    let listed = 0
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'media_sweep_candidates') return ['quarantine/a/original']
      if (fn === 'paid_files_sweep_candidates') return store.objects.has(`paid-files/${part}`) && listed++ < 1 ? [part] : []
      return null
    })
    const response = await handleJobs(jobRequest('{"job":"media_sweep"}'), rpc, () => failing)
    expect(await response.json()).toMatchObject({ data: [{ job: 'media_sweep', status: 'failed', objects: 0, paidFiles: 1 }] })
    expect(store.objects.has(`paid-files/${part}`)).toBe(false)
  })

  it('media_sweep records a failed run when Storage keeps a removed part', async () => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
    const store = { ...memoryStore(), async remove() {} }
    const rpc = vi.fn(async (fn: string) => (fn === 'media_sweep_candidates' ? ['quarantine/a/original'] : null))
    const response = await handleJobs(jobRequest('{"job":"media_sweep"}'), rpc, () => store)
    expect(await response.json()).toMatchObject({ ok: true, data: [{ job: 'media_sweep', status: 'failed' }] })
    expect(rpc).not.toHaveBeenCalledWith('media_tickets_purge', expect.anything())
    expect(rpc).toHaveBeenCalledWith('job_run_record', expect.objectContaining({ p_job: 'media_sweep', p_status: 'failed' }))
  })
})

// P08 round 9: the `commerce` part of `stats`. The ledger's SQL is proven in tests/integration/stats.test.ts and the
// real function in tests/integration/disputes-http.test.ts; here is every branch of the handler around it.
describe('admin function: stats, the commerce figures (P08 round 9)', () => {
  const FIGURES = {
    environment: 'test',
    paidOrders: 3,
    grossPaid: 21_500,
    refundsConfirmed: 4_000,
    netCollected: 17_500,
    customers: 2,
    review: { open: 1, captured: 3_000, refunded: 0 },
    disputes: { count: 1, againstSeller: 4_500, forSeller: 0 },
  }
  const NOW = new Date('2026-10-03T12:00:00.000Z')
  const DAY = 86_400_000
  const config: PaymentsConfigOk = {
    ok: true,
    baseUrl: 'http://127.0.0.1:54390/v1',
    secretKey: 'sk_test_local_emulator_key_not_for_production',
    webhookSecret: 'local-moyasar-webhook-secret-not-for-production',
    mode: 'test',
    callbackBase: 'http://127.0.0.1:54321/functions/v1',
    storageBase: 'http://127.0.0.1:54321/storage/v1',
  }
  const calls: Array<[string, Record<string, unknown>]> = []
  let figures: unknown = FIGURES
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args])
    if (figures instanceof Error) throw figures
    return figures
  }
  const payments = (over: Partial<PaymentsConfigOk> = {}): PaymentDeps => ({ rpc, client: {} as MoyasarClient, config: { ...config, ...over } })
  const stats = async (
    body: Record<string, unknown> = {},
    opts: { payments?: PaymentDeps | null } = {},
  ): Promise<{ status: number; body: any }> => {
    const response = await handleAdmin(post({ action: 'stats', ...body }), {
      rpc,
      staff: staffAs('owner'),
      store: memoryStore(),
      ...(opts.payments === null ? {} : { payments: opts.payments ?? payments() }),
    })
    return { status: response.status, body: await response.json() }
  }
  const unconfigure = (): void => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) vi.stubEnv(name, '')
  }

  beforeEach(() => {
    calls.length = 0
    figures = FIGURES
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("answers the ledger's figures as the SQL gave them, for the site's own mode, instead of the old not_configured placeholder", async () => {
    const answered = await stats()
    expect(answered.status).toBe(200)
    expect(answered.body.data.commerce).toEqual(FIGURES)
    expect(answered.body.data.commerce.status).toBeUndefined()
    expect(answered.body.data).toMatchObject({ generatedAt: expect.any(String), analytics: { status: 'unavailable' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('owner_commerce_stats')
    expect(calls[0]![1].p_environment).toBe('test')
    // The live site asks for its own figures.
    await stats({}, { payments: payments({ mode: 'live' }) })
    expect(calls[1]![1].p_environment).toBe('live')
  })

  it('reads the ledger on every call, and only the analytics part stays cached', async () => {
    const first = await stats()
    figures = { ...FIGURES, paidOrders: 4, grossPaid: 30_000 }
    const second = await stats()
    expect(calls).toHaveLength(2)
    expect(first.body.data.commerce.paidOrders).toBe(3)
    expect(second.body.data.commerce).toEqual(figures)
    // The analytics answer (and its generation time) is the one the first call cached.
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt)
    expect(second.body.data.analytics).toEqual(first.body.data.analytics)
  })

  it('defaults to the last 30 days, ending now', async () => {
    await stats()
    expect(calls[0]![1]).toEqual({
      p_from: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      p_to: NOW.toISOString(),
      p_environment: 'test',
    })
  })

  it('takes the range it is given as ISO instants (an offset is converted), and fills in what is missing', async () => {
    await stats({ from: '2026-09-01T00:00:00+03:00', to: '2026-09-30T23:59:59.999Z' })
    expect(calls[0]![1]).toMatchObject({ p_from: '2026-08-31T21:00:00.000Z', p_to: '2026-09-30T23:59:59.999Z' })
    // Only `from`: it ends now. Only `to`: it begins 30 days before.
    await stats({ from: '2026-09-20T00:00:00Z' })
    expect(calls[1]![1]).toMatchObject({ p_from: '2026-09-20T00:00:00.000Z', p_to: NOW.toISOString() })
    await stats({ to: '2026-06-30T00:00:00Z' })
    expect(calls[2]![1]).toMatchObject({ p_from: '2026-05-31T00:00:00.000Z', p_to: '2026-06-30T00:00:00.000Z' })
  })

  it('accepts a range of exactly 366 days and refuses one millisecond more', async () => {
    const to = '2026-10-03T00:00:00.000Z'
    const exactly = new Date(Date.parse(to) - 366 * DAY).toISOString()
    expect((await stats({ from: exactly, to })).status).toBe(200)
    const over = await stats({ from: new Date(Date.parse(exactly) - 1).toISOString(), to })
    expect(over.status).toBe(422)
    expect(over.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['from after to', { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }],
    ['from equal to to', { from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }],
    ['a from in the future, so after the default to', { from: '2026-10-04T00:00:00Z' }],
    ['a from more than 366 days back with the default to', { from: '2025-09-01T00:00:00Z' }],
    ['a to more than 366 days after its from', { from: '2024-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }],
    ['a date with no time', { from: '2026-09-01', to: '2026-10-01' }],
    ['an instant with no offset', { from: '2026-09-01T00:00:00', to: '2026-10-01T00:00:00' }],
    ['text that is not a date', { from: 'last month' }],
    ['a month that does not exist', { from: '2026-13-01T00:00:00Z' }],
    ['a number', { from: 1_759_000_000_000 }],
    ['null', { from: null }],
    ['an unknown field', { limit: 10 }],
  ])('refuses %s with 422 INVALID and reads nothing', async (_label, body) => {
    const refused = await stats(body)
    expect(refused.status).toBe(422)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    expect(calls).toHaveLength(0)
  })

  it('while payments are not configured commerce is null and the rest still answers, with the ledger untouched', async () => {
    unconfigure()
    const answered = await stats({}, { payments: null })
    expect(answered.status).toBe(200)
    expect(answered.body.data.commerce).toBeNull()
    expect(answered.body.data).toMatchObject({ generatedAt: expect.any(String), analytics: { status: 'unavailable' } })
    expect(calls).toHaveLength(0)
    // A range that is bad is still refused first.
    expect((await stats({ from: '2020-01-01T00:00:00Z' }, { payments: null })).status).toBe(422)
  })

  it('a failure reading the ledger is a detail-free 500, never a null or a zero', async () => {
    figures = Object.assign(new Error('sql: connection to server at 10.0.0.5 lost'), { code: 'XX000' })
    const failed = await stats()
    expect(failed.status).toBe(500)
    expect(failed.body).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(JSON.stringify(failed.body)).not.toMatch(/10\.0\.0\.5|sql:/)
  })

  it("stays the owner's alone, and refuses before the ledger is read", async () => {
    for (const role of ['editor', 'operations'] as const) {
      const response = await handleAdmin(post({ action: 'stats' }), { rpc, staff: staffAs(role), store: memoryStore(), payments: payments() })
      expect(response.status, role).toBe(403)
    }
    expect(calls).toHaveLength(0)
  })
})
