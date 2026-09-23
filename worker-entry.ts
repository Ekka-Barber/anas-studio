import openNextWorker from 'open-next-worker'

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
 * does not require a prior build.
 */

const handler: ExportedHandler<CloudflareEnv> = {
  fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return Response.redirect(new URL(`${url.pathname}${url.search}`, env.ADMIN_URL), 308)
    }

    if (url.pathname.startsWith('/api/')) {
      const isHealth = url.pathname === '/api/health'
      const isRevalidate = url.pathname === '/api/revalidate' && request.method === 'POST'
      if (!isHealth && !isRevalidate) {
        return new Response(null, { status: 404 })
      }
    }

    return openNextWorker.fetch(request, env, ctx)
  },
}

export default handler
