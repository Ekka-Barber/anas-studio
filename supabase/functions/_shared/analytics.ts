/**
 * Cloudflare GraphQL Analytics (P06 round 2, D21): visits and top request
 * paths for the owner stats screen. Visits are `sum.visits` from
 * `httpRequestsAdaptiveGroups` over the last 7 days (UTC range), filtered to
 * `requestSource: "eyeball"` (visitor traffic, not Cloudflare-internal or
 * monitoring requests) and the production host from `SITE_URL`.
 *
 * Docs fetched 2026-09-26:
 * - https://developers.cloudflare.com/analytics/graphql-api/
 * - https://developers.cloudflare.com/analytics/graphql-api/migration-guides/graphql-api-analytics/
 *   (the `httpRequestsAdaptiveGroups` example: `requestSource: "eyeball"`,
 *   `sum { visits }`, `avg { sampleInterval }`, `orderBy: [count_DESC]`)
 * - https://developers.cloudflare.com/analytics/graphql-api/features/filtering/
 * - https://developers.cloudflare.com/analytics/graphql-api/sampling/
 *   (adaptive sampling; `avg.sampleInterval` is the sample interval in
 *   seconds — 1 means unsampled, anything above 1 means the numbers are
 *   estimates)
 * - https://developers.cloudflare.com/llms-full.txt, fetched 2026-09-30 (the
 *   "Get top crawled paths" example: `httpRequestsAdaptiveGroups` filtered by
 *   `edgeResponseStatus_geq` / `edgeResponseStatus_lt`)
 * - https://developers.cloudflare.com/analytics/graphql-api/features/filtering/
 *   and .../features/discovery/settings/, fetched 2026-09-30 (the scalar
 *   operator `in`; each node's `maxPageSize`, the most records one query may
 *   return, which depends on the plan: the docs' example shows 10000)
 * - https://developers.cloudflare.com/pages/configuration/serving-pages/,
 *   fetched 2026-09-30 (Pages sends `Etag` and answers a returning visitor's
 *   `If-None-Match` with `304 Not Modified`; HTML is `max-age=0, must-revalidate`)
 * The node's field/dimension names live in the GraphQL schema itself (the
 * docs point at schema introspection, not a static reference page); the live
 * schema check happens with the real account at gate E11 (P11). Until then
 * every failure mode below reports `unavailable`, never an invented number.
 */
import { optionalEnv } from './env.ts'

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const TIMEOUT_MS = 10_000
const WINDOW_DAYS = 7
/**
 * The top-paths query asks for as many groups as the node allows, because the
 * asset filter runs in `parseTopPaths`: on a static export the fonts, chunks
 * and images far outnumber the pages, so a window of 100 leading groups would
 * be all assets. Gate E11 confirms the node's `maxPageSize` on the real zone
 * (a lower one answers a GraphQL error, reported as GRAPHQL_ERROR).
 */
const TOP_PATHS_QUERY_LIMIT = 10_000
const TOP_PATHS_SHOWN = 10

export interface TopPath {
  path: string
  count: number
}

export type AnalyticsUnavailableReason =
  | 'NOT_CONFIGURED'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'GRAPHQL_ERROR'
  | 'SAMPLED'
  | 'UNEXPECTED_SHAPE'

export type AnalyticsResult =
  | {
      status: 'ok'
      range: { start: string; end: string }
      visits: number
      topPaths: TopPath[]
      fetchedAt: string
    }
  | { status: 'unavailable'; reason: AnalyticsUnavailableReason }

/**
 * One query per dataset, exactly as the docs' migration example composes
 * them: lowercase `string` for the zone tag, `Time` for the range bounds.
 */
export const VISITS_QUERY = /* GraphQL */ `query OwnerVisits($zoneTag: string, $start: Time, $end: Time, $host: string) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 1
        filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", clientRequestHTTPHost: $host }
      ) {
        sum { visits }
        avg { sampleInterval }
      }
    }
  }
}`

// Only 200 and 304 answers: scanner probes (404), redirects and blocked requests are not pages
// people read, but a returning visitor's revalidation is a 304 and is a page view.
export const TOP_PATHS_QUERY = /* GraphQL */ `query OwnerTopPaths($zoneTag: string, $start: Time, $end: Time, $host: string) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: ${TOP_PATHS_QUERY_LIMIT}
        orderBy: [count_DESC]
        filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", clientRequestHTTPHost: $host, edgeResponseStatus_in: [200, 304] }
      ) {
        count
        avg { sampleInterval }
        dimensions { clientRequestPath }
      }
    }
  }
}`

/** The 7-day UTC window ending at `now` (seconds truncated for cacheability). */
export function analyticsWindow(now: Date): { start: string; end: string } {
  const end = new Date(Math.floor(now.getTime() / 1000) * 1000)
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const iso = (date: Date) => date.toISOString().replace(/\.000Z$/, 'Z')
  return { start: iso(start), end: iso(end) }
}

export function analyticsVariables(now: Date, zoneTag: string, host: string) {
  const { start, end } = analyticsWindow(now)
  return { zoneTag, host, start, end }
}

/**
 * Path prefixes and file extensions that are not pages people read: the
 * admin, the APIs, Next's assets, Cloudflare's own `/cdn-cgi` endpoints, and static files.
 */
const EXCLUDED_PREFIXES = ['/admin', '/api', '/_next', '/cdn-cgi']
const EXCLUDED_EXTENSIONS = new Set([
  'css', 'js', 'mjs', 'map', 'json', 'xml', 'txt', 'ico', 'png', 'jpg', 'jpeg', 'webp', 'avif',
  'svg', 'gif', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mov', 'pdf', 'zip', 'wasm',
])

function isRealPage(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash) {
    const extension = path.slice(dot + 1).toLowerCase()
    if (EXCLUDED_EXTENSIONS.has(extension)) return false
  }
  return true
}

/** One group as the API returns it; every field is validated, never trusted. */
interface GroupShape {
  count?: unknown
  sum?: { visits?: unknown } | null
  avg?: { sampleInterval?: unknown } | null
  dimensions?: { clientRequestPath?: unknown } | null
}

/**
 * The one zone's groups, shape-validated: an answer is usable only when the
 * response carries exactly one zone (`data.viewer.zones` of length 1) that is
 * an object whose `httpRequestsAdaptiveGroups` is an Array — an empty array
 * is a real zero. Anything else (no zone — a wrong zone id or a bad token —
 * `data: null`, a zone entry that is null or not an object, or an unexpected
 * shape like `{}`) is not an answer, so it returns null instead of an
 * invented empty result.
 */
function groupsOf(body: unknown): GroupShape[] | null {
  const zones = (body as { data?: { viewer?: { zones?: unknown } } } | null)?.data?.viewer?.zones
  if (!Array.isArray(zones) || zones.length !== 1) return null
  const zone = zones[0]
  if (typeof zone !== 'object' || zone === null) return null
  const groups = (zone as { httpRequestsAdaptiveGroups?: unknown }).httpRequestsAdaptiveGroups
  return Array.isArray(groups) ? (groups as GroupShape[]) : null
}

/** `avg.sampleInterval > 1` anywhere means the numbers are sampled estimates. */
function isSampled(groups: GroupShape[]): boolean {
  return groups.some((group) => {
    const interval = group.avg?.sampleInterval
    return typeof interval === 'number' && interval > 1
  })
}

export function parseVisits(body: unknown): { visits: number; sampled: boolean } | null {
  const groups = groupsOf(body)
  if (groups === null) return null
  let visits = 0
  for (const group of groups) {
    const value = group.sum?.visits
    if (typeof value === 'number' && Number.isFinite(value)) visits += value
  }
  return { visits, sampled: isSampled(groups) }
}

export function parseTopPaths(body: unknown): { topPaths: TopPath[]; sampled: boolean } | null {
  const groups = groupsOf(body)
  if (groups === null) return null
  const topPaths = groups
    .filter((group) => {
      const path = group.dimensions?.clientRequestPath
      return typeof path === 'string' && path.length > 0 && isRealPage(path)
    })
    .map((group) => {
      const count = typeof group.count === 'number' && Number.isFinite(group.count) ? group.count : 0
      return { path: group.dimensions?.clientRequestPath as string, count }
    })
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, TOP_PATHS_SHOWN)
  return { topPaths, sampled: isSampled(groups) }
}

function hasGraphqlErrors(body: unknown): boolean {
  const errors = (body as { errors?: unknown } | null)?.errors
  return Array.isArray(errors) && errors.length > 0
}

async function post(query: string, variables: Record<string, string>, token: string): Promise<unknown> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new HttpError(response.status)
  return response.json()
}

class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`GraphQL HTTP ${status}`)
  }
}

/**
 * Fetches both datasets. Anything missing or wrong returns `unavailable`
 * with a reason — `ok` means a complete, unsampled answer, where 0 visits is
 * a real zero from a successful query.
 */
export async function fetchAnalytics(now: Date = new Date()): Promise<AnalyticsResult> {
  const token = optionalEnv('ANALYTICS_TOKEN')
  const zoneTag = optionalEnv('CLOUDFLARE_ZONE_ID')
  if (!token || !zoneTag) return { status: 'unavailable', reason: 'NOT_CONFIGURED' }
  const siteUrl = optionalEnv('SITE_URL')
  let host: string
  try {
    host = new URL(siteUrl ?? '').hostname
  } catch {
    return { status: 'unavailable', reason: 'NOT_CONFIGURED' }
  }
  if (host.length === 0) return { status: 'unavailable', reason: 'NOT_CONFIGURED' }

  const variables = analyticsVariables(now, zoneTag, host)
  let visitsBody: unknown
  let pathsBody: unknown
  try {
    ;[visitsBody, pathsBody] = await Promise.all([post(VISITS_QUERY, variables, token), post(TOP_PATHS_QUERY, variables, token)])
  } catch (error) {
    if (error instanceof HttpError) return { status: 'unavailable', reason: 'HTTP_ERROR' }
    // AbortSignal.timeout aborts with a DOMException named "TimeoutError";
    // DOMException's Error inheritance varies by runtime, so match the name.
    if ((error as { name?: string } | null)?.name === 'TimeoutError') {
      return { status: 'unavailable', reason: 'TIMEOUT' }
    }
    // An aborted or dropped request: its outcome is unknowable, not zero.
    return { status: 'unavailable', reason: 'HTTP_ERROR' }
  }
  if (hasGraphqlErrors(visitsBody) || hasGraphqlErrors(pathsBody)) {
    return { status: 'unavailable', reason: 'GRAPHQL_ERROR' }
  }
  const visits = parseVisits(visitsBody)
  const paths = parseTopPaths(pathsBody)
  // An answer that is not exactly one zone with a groups array (wrong zone
  // id, bad token, `data: null`, a shape change) is not a zero.
  if (!visits || !paths) return { status: 'unavailable', reason: 'UNEXPECTED_SHAPE' }
  if (visits.sampled || paths.sampled) return { status: 'unavailable', reason: 'SAMPLED' }
  return {
    status: 'ok',
    range: { start: variables.start, end: variables.end },
    visits: visits.visits,
    topPaths: paths.topPaths,
    fetchedAt: now.toISOString(),
  }
}
