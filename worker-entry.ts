import openNextWorker from 'open-next-worker'

import { secretsMatch } from './src/lib/env'
import { isAuthorizedRevalidateRequest } from './src/lib/revalidate'

/**
 * The single deployed Worker (D29).
 *
 * D29 replaced the Payload admin/REST/GraphQL surface and the Oracle VM node
 * admin target with a custom Supabase admin (browser to the Data API,
 * outside this Worker — see `PLANS/ARCHITECTURE.md` "Three data paths").
 * There is no `/admin` route and no `/api/*` catch-all to guard against any
 * more, so this file's own work before delegating to the generated OpenNext
 * handler is:
 *
 * - `POST /api/revalidate` is checked here (I21): unset secret -> 404, wrong
 *   bearer -> 401, both before the generated OpenNext handler runs. The
 *   route's own check in `src/app/api/revalidate/route.ts` stays as defence
 *   in depth — this is a second, earlier gate, not a replacement.
 * - `POST /api/jobs/run` gets the same early gate (P06) with `JOBS_SECRET`,
 *   defence in depth for `src/app/api/jobs/run/route.ts`.
 * - `scheduled` (the one Cron Trigger in `wrangler.jsonc`, every minute)
 *   calls that route back with the bearer secret so the email outbox
 *   dispatches without an in-memory timer (ARCHITECTURE "Jobs"). With no
 *   `JOBS_SECRET` or `SITE_URL` the trigger does nothing.
 * - Everything else is unchanged: public pages read from the R2/D1
 *   incremental cache (`open-next.config.ts`).
 *
 * `open-next-worker` is the build artifact `.open-next/worker.js`, mapped by
 * the `alias` entry in `wrangler.jsonc`. Types come from the adapter's own
 * template declaration through `tsconfig.json` `paths`, so `pnpm typecheck`
 * does not require a prior build. This import is static, deliberately (I21
 * round 2): a dynamic `import()` was tried and rejected — measured evidence
 * in `artifacts/acceptance/P00/i21-first-request-cpu.txt` shows it does not
 * reduce CPU on the path that matters (an ordinary visitor's first page
 * request on a fresh isolate still needs the full handler; deferring it only
 * moves module-evaluation cost that Cloudflare already meters against the
 * request into a more visible place) while risking that common path for a
 * saving that only helps the rare refused-route case.
 *
 * `REVALIDATE_SECRET` and `JOBS_SECRET` are Worker secrets
 * (`wrangler secret put`), not declared in `wrangler.jsonc`'s `vars` —
 * Cloudflare still exposes them on `env` at runtime alongside vars and
 * bindings (https://developers.cloudflare.com/workers/configuration/secrets/,
 * fetched 2026-09-23: "Secrets can be accessed from Workers as you would any
 * other environment variables... through the `env` parameter"), so `WorkerEnv`
 * below widens the generated `CloudflareEnv` type (which only lists
 * `wrangler.jsonc`-declared bindings) rather than editing the generated file.
 */

type WorkerEnv = CloudflareEnv & { REVALIDATE_SECRET?: string; JOBS_SECRET?: string }

const BEARER_PREFIX = 'Bearer '

/** The same gate `/api/jobs/run` applies itself: unset -> 404, wrong bearer -> 401. */
function unauthorizedJobs(request: Request, secret: string | undefined, url: URL): Response | null {
  if (url.pathname !== '/api/jobs/run' || request.method !== 'POST') return null
  if (!secret) return new Response(null, { status: 404 })
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith(BEARER_PREFIX) || !secretsMatch(authorization.slice(BEARER_PREFIX.length), secret)) {
    return Response.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing jobs secret.' },
      },
      { status: 401 },
    )
  }
  return null
}

const handler: ExportedHandler<WorkerEnv> = {
  fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/api/revalidate' && request.method === 'POST') {
      const secret = env.REVALIDATE_SECRET
      if (!secret) {
        return new Response(null, { status: 404 })
      }
      if (!isAuthorizedRevalidateRequest(request.headers, secret)) {
        return Response.json(
          {
            ok: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid or missing revalidate secret.' },
          },
          { status: 401 },
        )
      }
    }

    const jobs = unauthorizedJobs(request, env.JOBS_SECRET, url)
    if (jobs) return jobs

    return openNextWorker.fetch(request, env, ctx)
  },

  scheduled(controller, env, ctx) {
    // The cron's whole job is one authenticated self-request; the route does
    // the real work through the app_server functions.
    if (!env.JOBS_SECRET || !env.SITE_URL) return
    // The generated handler's fetch takes the incoming Workers `Request`
    // type (`IncomingRequestCfProperties`); a plain outgoing Request is fine
    // at runtime, so this bridges the two types.
    const jobRequest = new Request(new URL('/api/jobs/run', env.SITE_URL), {
      method: 'POST',
      headers: { authorization: `Bearer ${env.JOBS_SECRET}` },
    }) as unknown as Parameters<typeof openNextWorker.fetch>[0]
    ctx.waitUntil(openNextWorker.fetch(jobRequest, env, ctx))
  },
}

export default handler
