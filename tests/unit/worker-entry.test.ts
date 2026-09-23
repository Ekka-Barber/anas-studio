import { describe, expect, it, vi } from 'vitest'

// `open-next-worker` only resolves under wrangler's build-time `alias`
// (`wrangler.jsonc`), never under vitest/Node module resolution — mocked so
// `worker-entry.ts`'s own static top-level `import` (I21 round 2: reverted
// to static, see the file's own comment) doesn't fail module load here. The
// mock is never actually invoked by any case below.
vi.mock('open-next-worker', () => ({ default: { fetch: vi.fn() } }))

const { default: handler } = await import('../../worker-entry')

/**
 * Covers only the paths `worker-entry.ts`'s own `fetch` answers directly
 * (I21): the `/admin` redirect and every `/api/*` refusal, including the two
 * `/api/revalidate` cases. Falling through to the real `openNextWorker.fetch`
 * is out of reach here (mocked away above) — exercised instead by
 * `tests/e2e/runtime.spec.ts` against a real build.
 */

const baseEnv = { ADMIN_URL: 'https://admin.anas.studio' } as CloudflareEnv
const ctx = {} as ExecutionContext
// The exported handler type's `Request` (incoming, with `cf`) and the global
// `Request` constructor (outgoing) are deliberately different Workers types;
// this test only needs a real `fetch` `Request` at runtime, so it casts.
const call = handler.fetch as (req: Request, env: CloudflareEnv, ctx: ExecutionContext) => Response | Promise<Response>

describe('worker-entry fetch', () => {
  it('redirects /admin to ADMIN_URL, same path and query', async () => {
    const res = await call(
      new Request('https://worker.example/admin/collections/x?limit=1'),
      baseEnv,
      ctx,
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://admin.anas.studio/admin/collections/x?limit=1')
  })

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

  it('GET /api/revalidate (wrong method) 404s', async () => {
    const res = await call(
      new Request('https://worker.example/api/revalidate'),
      { ...baseEnv, REVALIDATE_SECRET: 'the-real-secret' } as CloudflareEnv,
      ctx,
    )
    expect(res.status).toBe(404)
  })

  it('refuses other /api/* paths', async () => {
    const res = await call(
      new Request('https://worker.example/api/users/login', { method: 'POST' }),
      baseEnv,
      ctx,
    )
    expect(res.status).toBe(404)
  })
})
