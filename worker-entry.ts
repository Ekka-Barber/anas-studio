import openNextWorker from 'open-next-worker'

import { isAuthorizedRevalidateRequest } from './src/lib/revalidate'

/**
 * The single deployed Worker (I20/D27).
 *
 * The Payload admin, authentication, REST/GraphQL writes and the job runner
 * all moved to a Node server on the Oracle VM — this file is Worker-only; the
 * node target never imports it. What is left here, before delegating to the
 * generated OpenNext handler:
 *
 * - `/admin` and `/admin/*` redirect (308) to the admin origin, same path and
 *   query.
 * - `/api/*` is refused (404) except `/api/health` and `POST /api/revalidate`.
 *   This is what keeps Payload's REST/GraphQL surface — and its broken
 *   PBKDF2 login path (I17) — unreachable through the Worker; the owner must
 *   never be lockable through it.
 * - `POST /api/revalidate` is checked here too (I21): unset secret -> 404,
 *   wrong bearer -> 401, both before the generated OpenNext handler runs.
 *   The route's own check in `src/app/api/revalidate/route.ts` stays as
 *   defence in depth — this is a second, earlier gate, not a replacement.
 * - Everything else is unchanged: public pages now read from the R2/D1
 *   incremental cache (`open-next.config.ts`) instead of booting Payload on
 *   every request.
 *
 * There is no `scheduled` handler any more: the Cron Trigger and its secret
 * handling are gone from this file and from `wrangler.jsonc`. Scheduled jobs
 * run on the node target's own `autoRun` timer (`src/payload/jobs.ts`),
 * which only works because that process is long-lived — a Worker isolate is
 * not.
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
 * `REVALIDATE_SECRET` is a Worker secret (`wrangler secret put`), not
 * declared in `wrangler.jsonc`'s `vars` — Cloudflare still exposes it on
 * `env` at runtime alongside vars and bindings
 * (https://developers.cloudflare.com/workers/configuration/secrets/, fetched
 * 2026-09-23: "Secrets can be accessed from Workers as you would any other
 * environment variables... through the `env` parameter"), so `WorkerEnv`
 * below widens the generated `CloudflareEnv` type (which only lists
 * `wrangler.jsonc`-declared bindings) rather than editing the generated file.
 */

type WorkerEnv = CloudflareEnv & { REVALIDATE_SECRET?: string }

const handler: ExportedHandler<WorkerEnv> = {
  fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return Response.redirect(new URL(`${url.pathname}${url.search}`, env.ADMIN_URL), 308)
    }

    if (url.pathname.startsWith('/api/')) {
      const isHealth = url.pathname === '/api/health'
      const isRevalidate = url.pathname === '/api/revalidate' && request.method === 'POST'
      if (isRevalidate) {
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
      } else if (!isHealth) {
        return new Response(null, { status: 404 })
      }
    }

    return openNextWorker.fetch(request, env, ctx)
  },
}

export default handler
