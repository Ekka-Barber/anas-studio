import { describe, expect, it, vi } from 'vitest'

// `open-next-worker` only resolves under wrangler's build-time `alias`
// (`wrangler.jsonc`), never under vitest/Node module resolution — mocked so
// `worker-entry.ts`'s own static top-level `import` (I21 round 2: reverted
// to static, see the file's own comment) doesn't fail module load here.
const openNextFetch = vi.fn(() => new Response(null, { status: 200 }))
vi.mock('open-next-worker', () => ({ default: { fetch: openNextFetch } }))

const { default: handler } = await import('../../worker-entry')

/**
 * Covers only the path `worker-entry.ts`'s own `fetch` answers directly
 * before delegating (D29, I21): the `POST /api/revalidate` gate. Everything
 * else — including a bad-method `/api/revalidate` request and every other
 * path — now falls straight through to the generated OpenNext handler
 * (mocked above), exercised for real by `tests/e2e/runtime.spec.ts`.
 */

const baseEnv = {} as CloudflareEnv
const ctx = {} as ExecutionContext
// The exported handler type's `Request` (incoming, with `cf`) and the global
// `Request` constructor (outgoing) are deliberately different Workers types;
// this test only needs a real `fetch` `Request` at runtime, so it casts.
const call = handler.fetch as (req: Request, env: CloudflareEnv, ctx: ExecutionContext) => Response | Promise<Response>

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
