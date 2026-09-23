import config from '@payload-config'
import { getPayload, type Payload } from 'payload'

import { isNodeRuntimeTarget } from './env'

/**
 * Single entry point for Local API access.
 *
 * Callers that act on behalf of a person must pass `req`/`user` and
 * `overrideAccess: false` explicitly at the call site; this helper deliberately
 * does not decide access for them.
 *
 * `cron: isNodeRuntimeTarget()` (I19/D27): Payload only starts its `autoRun`
 * timer the first time something calls `getPayload({ cron: true })`
 * (`payload/dist/index.js` `_initializeCrons()`), and only once per cached
 * instance per process. `@payloadcms/next`'s own `initReq.js` always passes
 * `cron: true`, but `/api/health` calls this helper directly with none of
 * that machinery — so without this, a freshly (re)started node-target
 * container would never run a scheduled job until someone happened to open
 * an admin or REST route. The Dockerfile's `HEALTHCHECK` now polls
 * `/api/health` on its own, which makes this the trigger instead. The Worker
 * target is unaffected: `isNodeRuntimeTarget()` is false there, so this stays
 * `cron: false`, identical to the previous unconditional call.
 */
export function getPayloadClient(): Promise<Payload> {
  return getPayload({ config, cron: isNodeRuntimeTarget() })
}
