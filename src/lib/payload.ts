import config from '@payload-config'
import { getPayload, type Payload } from 'payload'

/**
 * Single entry point for Local API access.
 *
 * Callers that act on behalf of a person must pass `req`/`user` and
 * `overrideAccess: false` explicitly at the call site; this helper deliberately
 * does not decide access for them.
 */
export function getPayloadClient(): Promise<Payload> {
  return getPayload({ config })
}
