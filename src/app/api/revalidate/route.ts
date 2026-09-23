import { revalidatePath, revalidateTag } from 'next/cache'

import { optionalEnv } from '@/lib/env'
import { isAuthorizedRevalidateRequest, parseRevalidatePayload } from '@/lib/revalidate'

/**
 * On-demand cache invalidation for the Worker's R2/D1 incremental cache
 * (I20/D27). The node admin target calls this after a RuntimeProbe save or
 * delete; nothing else is expected to call it.
 *
 * Unconfigured means unavailable: with no `REVALIDATE_SECRET` the route does
 * not exist (404), matching the rest of the Worker's `/api/*` surface — there
 * is no open fallback.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const secret = optionalEnv('REVALIDATE_SECRET')
  if (!secret) {
    return new Response(null, { status: 404 })
  }

  if (!isAuthorizedRevalidateRequest(request.headers, secret)) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing revalidate secret.' } },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Body must be JSON.' } },
      { status: 400 },
    )
  }

  const payload = parseRevalidatePayload(body)
  if (!payload) {
    return Response.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Provide at least one non-empty tag or path.' },
      },
      { status: 400 },
    )
  }

  // Next 16's `revalidateTag` requires a cache-life profile as its second
  // argument (`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts`).
  // `{ expire: 0 }` means immediate hard invalidation — Next's own comment
  // calls this "Immediate expiration, default behavior before next 16, now
  // only with {expire: 0}" (`@opennextjs/aws` `adapters/cache.js`
  // `revalidateTag`). This was verified against a live `wrangler dev` run with
  // the R2/D1 local simulation, not assumed: passing `'max'` (the profile the
  // deprecation warning suggests) instead writes a far-future `expire` into
  // the D1 tag cache, which the tag cache reads as "stale, not revalidated"
  // (`d1-next-tag-cache.js` `hasBeenRevalidated`/`isStale`) — Next's
  // stale-while-revalidate path, which then tries to queue a background
  // refresh through `globalThis.queue`, unconfigured here since this app has
  // no queue (on-demand only, per `open-next.config.ts`). The edited page
  // kept serving the old cached title on the very next request. `{ expire: 0
  // }` instead makes the tag cache report the entry as revalidated
  // immediately, so the next request always re-renders from Payload — which
  // is what "an invalidation reaches a visitor within 60 seconds" (P02)
  // needs without a queue.
  for (const tag of payload.tags) revalidateTag(tag, { expire: 0 })
  for (const path of payload.paths) revalidatePath(path)

  return Response.json({ ok: true, data: payload }, { status: 200 })
}
