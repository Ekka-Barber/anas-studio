import { describe, expect, it, vi } from 'vitest'

// `open-next-worker` only resolves under wrangler's build-time `alias`
// (`wrangler.jsonc`), never under vitest/Node module resolution — mocked so
// `worker-entry.ts`'s own static top-level `import` (I21 round 2: reverted
// to static, see the file's own comment) doesn't fail module load here.
const openNextFetch = vi.fn(() => new Response(null, { status: 200 }))
vi.mock('open-next-worker', () => ({ default: { fetch: openNextFetch } }))

const { default: handler } = await import('../../worker-entry')

/**
 * Covers only the paths `worker-entry.ts` answers itself before delegating
 * (D29, I21, P06): the `POST /api/revalidate` gate, the `POST /api/jobs/run`
 * gate, and the `scheduled` cron handler. Everything else — including a
 * bad-method gate request and every other path — falls straight through to
 * the generated OpenNext handler (mocked above), exercised for real by
 * `tests/e2e/runtime.spec.ts`.
 */

const baseEnv = {} as CloudflareEnv
const ctx = {} as ExecutionContext
// The exported handler type's `Request` (incoming, with `cf`) and the global
// `Request` constructor (outgoing) are deliberately different Workers types;
// this test only needs a real `fetch` `Request` at runtime, so it casts.
const call = handler.fetch as (
  req: Request,
  env: CloudflareEnv & { JOBS_SECRET?: string; REVALIDATE_SECRET?: string },
  ctx: ExecutionContext,
) => Response | Promise<Response>
const scheduled = handler.scheduled as (
  controller: ScheduledController,
  env: CloudflareEnv & { JOBS_SECRET?: string },
  ctx: ExecutionContext,
) => void

describe('worker-entry fetch', () => {
  it('POST /api/revalidate 404s when REVALIDATE_SECRET is unset', async () => {
    const res = await call(
      new Request('https://worker.example/api/revalidate', { method: 'POST' }),
      baseEnv,
      ctx,
    )
    expect(res.status).toBe(404)
  })

  it('POST /api/revalidate 401s on a wrong bearer, matching the route handler body', async () => {
    const res = await call(
      new Request('https://worker.example/api/revalidate', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      }),
      { ...baseEnv, REVALIDATE_SECRET: 'the-real-secret' } as CloudflareEnv,
      ctx,
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing revalidate secret.' },
    })
  })

  it('POST /api/revalidate with a correct bearer falls through to the OpenNext handler', async () => {
    openNextFetch.mockClear()
    const res = await call(
      new Request('https://worker.example/api/revalidate', {
        method: 'POST',
        headers: { authorization: 'Bearer the-real-secret' },
      }),
      { ...baseEnv, REVALIDATE_SECRET: 'the-real-secret' } as CloudflareEnv,
      ctx,
    )
    expect(openNextFetch).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('every other path falls straight through to the OpenNext handler', async () => {
    openNextFetch.mockClear()
    await call(new Request('https://worker.example/'), baseEnv, ctx)
    expect(openNextFetch).toHaveBeenCalledTimes(1)
  })
})

describe('worker-entry jobs gate', () => {
  it('POST /api/jobs/run 404s when JOBS_SECRET is unset', async () => {
    const res = await call(new Request('https://worker.example/api/jobs/run', { method: 'POST' }), baseEnv, ctx)
    expect(res.status).toBe(404)
  })

  it('POST /api/jobs/run 401s on a missing or wrong bearer, matching the route handler body', async () => {
    const env = { ...baseEnv, JOBS_SECRET: 'the-jobs-secret' } as CloudflareEnv
    const missing = await call(new Request('https://worker.example/api/jobs/run', { method: 'POST' }), env, ctx)
    expect(missing.status).toBe(401)
    const wrong = await call(
      new Request('https://worker.example/api/jobs/run', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      }),
      env,
      ctx,
    )
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing jobs secret.' },
    })
  })

  it('POST /api/jobs/run with a correct bearer falls through to the OpenNext handler', async () => {
    openNextFetch.mockClear()
    const res = await call(
      new Request('https://worker.example/api/jobs/run', {
        method: 'POST',
        headers: { authorization: 'Bearer the-jobs-secret' },
      }),
      { ...baseEnv, JOBS_SECRET: 'the-jobs-secret' } as CloudflareEnv,
      ctx,
    )
    expect(openNextFetch).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })
})

describe('worker-entry scheduled (the cron trigger)', () => {
  const controller = { cron: '* * * * *', scheduledTime: Date.now() } as ScheduledController

  function capturingCtx(): { ctx: ExecutionContext; promise: Promise<unknown> | undefined } {
    let promise: Promise<unknown> | undefined
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        promise = p
      },
    } as unknown as ExecutionContext
    return { ctx, get promise() { return promise } }
  }

  it('calls /api/jobs/run on SITE_URL with the bearer secret through waitUntil', async () => {
    openNextFetch.mockClear()
    const captured = capturingCtx()
    scheduled(
      controller,
      { ...baseEnv, JOBS_SECRET: 'the-jobs-secret', SITE_URL: 'https://anas.studio' } as unknown as CloudflareEnv,
      captured.ctx,
    )
    // The fetch promise must be handed to waitUntil (not returned/awaited by
    // the handler itself); awaiting it here stands in for the runtime.
    expect(captured.promise).toBeDefined()
    await captured.promise
    expect(openNextFetch).toHaveBeenCalledTimes(1)
    const [request, , passedCtx] = openNextFetch.mock.calls[0] as unknown as [Request, unknown, ExecutionContext]
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://anas.studio/api/jobs/run')
    expect(request.headers.get('authorization')).toBe('Bearer the-jobs-secret')
    expect(passedCtx).toBe(captured.ctx)
  })

  it('does nothing without JOBS_SECRET', async () => {
    openNextFetch.mockClear()
    const captured = capturingCtx()
    scheduled(controller, { ...baseEnv, SITE_URL: 'https://anas.studio' } as unknown as CloudflareEnv, captured.ctx)
    expect(captured.promise).toBeUndefined()
    expect(openNextFetch).not.toHaveBeenCalled()
  })

  it('does nothing without SITE_URL', async () => {
    openNextFetch.mockClear()
    const captured = capturingCtx()
    scheduled(controller, { ...baseEnv, JOBS_SECRET: 'the-jobs-secret' } as CloudflareEnv, captured.ctx)
    expect(captured.promise).toBeUndefined()
    expect(openNextFetch).not.toHaveBeenCalled()
  })
})
