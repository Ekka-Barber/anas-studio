// D32: the `admin` and `outbox` Edge Functions' handlers, with every
// dependency faked — staff identity, the database (`Rpc`) and storage — so
// the role gates, the media upload checks and the jobs bearer gate run
// without a Supabase stack. The SQL side of the same functions is proven in
// tests/integration/media-security.test.ts and outbox.test.ts.
import { createHash, randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleAdmin, type MediaStore, PRIVATE_BUCKET, PUBLIC_BUCKET } from '../../supabase/functions/_shared/admin.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { handleJobs } from '../../supabase/functions/_shared/jobs.ts'
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

function staffAs(role: StaffIdentity['role'] | 'none'): () => Promise<StaffIdentity | null> {
  return async () => (role === 'none' ? null : { userId: '11111111-1111-4111-8111-111111111111', role })
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

  it.each([
    ['operations', 'media-ticket'],
    ['operations', 'media-delete'],
    ['editor', 'stats'],
    ['editor', 'status'],
    ['operations', 'status'],
    ['operations', 'stats'],
    [null, 'media-complete'],
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
      data: [{ job: 'media_sweep', status: 'ok', objects: 130, tickets: 7 }],
    })
    expect(store.objects.size).toBe(0)
    expect(store.removed.every((key) => key.startsWith(`${PRIVATE_BUCKET}/quarantine/`))).toBe(true)
    expect(rpc).toHaveBeenCalledWith('job_run_record', {
      p_job: 'media_sweep',
      p_status: 'ok',
      p_detail: { objects: 130, tickets: 7 },
      p_started_at: expect.any(String),
    })
    expect(rpc).not.toHaveBeenCalledWith('outbox_claim', expect.anything())
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
