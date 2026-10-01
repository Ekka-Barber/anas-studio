// P06 round 2 unit tests: the Cloudflare GraphQL Analytics request shape and
// the response parser against fixture responses, with `fetch` stubbed. A
// missing token or zone id must not touch the network at all.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  analyticsVariables,
  analyticsWindow,
  fetchAnalytics,
  parseTopPaths,
  parseVisits,
  TOP_PATHS_QUERY,
  VISITS_QUERY,
} from '../../supabase/functions/_shared/analytics.ts'

const NOW = new Date('2026-09-26T12:00:00Z')

function visitsBody(groups: unknown[], errors?: unknown[]) {
  return { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: groups }] } }, errors: errors ?? null }
}

function topPathsBody(groups: unknown[], errors?: unknown[]) {
  return { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: groups }] } }, errors: errors ?? null }
}

/** A fetch stub answering the two queries by name, like the real endpoint. */
function stubFetch(visits: unknown, paths: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = init?.body ?? ''
    const query = typeof body === 'string' && body.includes('OwnerTopPaths') ? paths : visits
    return new Response(JSON.stringify(query), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('analytics configuration', () => {
  it('no token or no zone id returns NOT_CONFIGURED without any network call', async () => {
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone-123')
    const fetchMock = stubFetch(visitsBody([]), topPathsBody([]))
    const missingToken = await fetchAnalytics(NOW)
    expect(missingToken).toEqual({ status: 'unavailable', reason: 'NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    vi.unstubAllEnvs()
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    const missingZone = await fetchAnalytics(NOW)
    expect(missingZone).toEqual({ status: 'unavailable', reason: 'NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an unparseable SITE_URL is not configured either', async () => {
    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone-123')
    vi.stubEnv('SITE_URL', 'not a url')
    const fetchMock = stubFetch(visitsBody([]), topPathsBody([]))
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('analytics request shape', () => {
  it('the window is exactly the last 7 days ending at now (UTC)', () => {
    const { start, end } = analyticsWindow(NOW)
    expect(end).toBe('2026-09-26T12:00:00Z')
    expect(start).toBe('2026-09-19T12:00:00Z')
  })

  it('the variables carry the zone tag, the production host and the range', () => {
    expect(analyticsVariables(NOW, 'zone-123', 'anas.studio')).toEqual({
      zoneTag: 'zone-123',
      host: 'anas.studio',
      start: '2026-09-19T12:00:00Z',
      end: '2026-09-26T12:00:00Z',
    })
  })

  it('both queries filter to eyeball requests on the host inside the range', () => {
    for (const query of [VISITS_QUERY, TOP_PATHS_QUERY]) {
      expect(query).toContain('httpRequestsAdaptiveGroups')
      expect(query).toContain('datetime_geq: $start')
      expect(query).toContain('datetime_lt: $end')
      expect(query).toContain('requestSource: "eyeball"')
      expect(query).toContain('clientRequestHTTPHost: $host')
    }
    expect(VISITS_QUERY).toContain('sum { visits }')
    expect(VISITS_QUERY).toContain('avg { sampleInterval }')
    expect(TOP_PATHS_QUERY).toContain('dimensions { clientRequestPath }')
    expect(TOP_PATHS_QUERY).toContain('orderBy: [count_DESC]')
  })

  it('the top-paths query counts 200 and 304 only: probes and redirects never rank, repeat visits do', () => {
    expect(TOP_PATHS_QUERY).toContain('edgeResponseStatus_in: [200, 304]')
    expect(TOP_PATHS_QUERY).not.toContain('edgeResponseStatus_lt')
  })

  it('the top-paths window is the node maximum, not 100: on a static export assets outnumber pages', () => {
    expect(TOP_PATHS_QUERY).toContain('limit: 10000')
  })
})

describe('analytics fixtures', () => {
  function configure() {
    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone-123')
    vi.stubEnv('SITE_URL', 'https://anas.studio')
  }

  it('ok: visits and the top 10 real pages', async () => {
    configure()
    stubFetch(
      visitsBody([{ sum: { visits: 4120 }, avg: { sampleInterval: 1 } }]),
      topPathsBody([
        { count: 40, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/' } },
        { count: 30, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/started' } },
        { count: 25, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/admin/content' } },
        { count: 24, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/api/contact' } },
        { count: 23, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/_next/static/app.js' } },
        { count: 22, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/images/art.webp' } },
        { count: 21, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/built' } },
        { count: 20, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/passed' } },
        { count: 19, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/shelf' } },
        { count: 18, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/journal' } },
        { count: 17, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/contact' } },
        { count: 16, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/policies/privacy.PDF' } },
      ]),
    )
    const result = await fetchAnalytics(NOW)
    expect(result).toEqual({
      status: 'ok',
      range: { start: '2026-09-19T12:00:00Z', end: '2026-09-26T12:00:00Z' },
      visits: 4120,
      topPaths: [
        { path: '/', count: 40 },
        { path: '/started', count: 30 },
        { path: '/built', count: 21 },
        { path: '/passed', count: 20 },
        { path: '/shelf', count: 19 },
        { path: '/journal', count: 18 },
        { path: '/contact', count: 17 },
      ],
      fetchedAt: NOW.toISOString(),
    })
  })

  it('an ok answer with no groups is a real zero, not unavailable', async () => {
    configure()
    stubFetch(visitsBody([]), topPathsBody([]))
    const result = await fetchAnalytics(NOW)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.visits).toBe(0)
      expect(result.topPaths).toEqual([])
    }
  })

  it('an empty zones array is unavailable, not an invented zero (wrong zone id or bad token)', async () => {
    configure()
    const emptyZones = { data: { viewer: { zones: [] } }, errors: null }
    stubFetch(emptyZones, emptyZones)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('data null with no errors is unavailable, not an invented zero', async () => {
    configure()
    const nullData = { data: null, errors: null }
    stubFetch(nullData, nullData)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('an unexpected {} shape is unavailable, not an invented zero', async () => {
    configure()
    stubFetch({}, {})
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('a response with more than one zone is unavailable', async () => {
    configure()
    const twoZones = {
      data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [] }, { httpRequestsAdaptiveGroups: [] }] } },
      errors: null,
    }
    stubFetch(twoZones, twoZones)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('one zone whose groups are not an array is unavailable', async () => {
    configure()
    const noGroups = { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: null }] } }, errors: null }
    stubFetch(noGroups, noGroups)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('a null zone entry is unavailable, never a crash', async () => {
    configure()
    const nullZone = { data: { viewer: { zones: [null] } }, errors: null }
    stubFetch(nullZone, nullZone)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('a non-object zone entry is unavailable, never a crash', async () => {
    configure()
    const stringZone = { data: { viewer: { zones: ['x'] } }, errors: null }
    stubFetch(stringZone, stringZone)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })
  })

  it('sampled data (avg.sampleInterval above 1) is refused', async () => {
    configure()
    stubFetch(
      visitsBody([{ sum: { visits: 4120 }, avg: { sampleInterval: 10 } }]),
      topPathsBody([{ count: 5, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/' } }]),
    )
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'SAMPLED' })
  })

  it('sampling in the top-paths answer alone is also refused', async () => {
    configure()
    stubFetch(
      visitsBody([{ sum: { visits: 3 }, avg: { sampleInterval: 1 } }]),
      topPathsBody([{ count: 5, avg: { sampleInterval: 2 }, dimensions: { clientRequestPath: '/' } }]),
    )
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'SAMPLED' })
  })

  it('a GraphQL error is GRAPHQL_ERROR', async () => {
    configure()
    stubFetch(visitsBody([], [{ message: 'bad query' }]), topPathsBody([]))
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'GRAPHQL_ERROR' })
  })

  it('an unauthorized HTTP answer is HTTP_ERROR', async () => {
    configure()
    stubFetch({ errors: [{ message: 'unauthorized' }] }, topPathsBody([]), 401)
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'HTTP_ERROR' })
  })

  it('a fetch timeout is TIMEOUT', async () => {
    configure()
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'TIMEOUT' })
  })
})

describe('parsers against raw shapes', () => {
  it('parseVisits sums only numeric visits and flags sampling', () => {
    const parsed = parseVisits(
      visitsBody([{ sum: { visits: 10 }, avg: { sampleInterval: 1 } }, { sum: { visits: 'x' }, avg: {} }]),
    )
    expect(parsed).toEqual({ visits: 10, sampled: false })
  })

  it('an unusable shape parses to null, never to an invented zero', () => {
    expect(parseVisits({ data: { viewer: { zones: [] } }, errors: null })).toBeNull()
    expect(parseVisits({ data: null, errors: null })).toBeNull()
    expect(parseVisits({ data: { viewer: { zones: [null] } }, errors: null })).toBeNull()
    expect(parseVisits({ data: { viewer: { zones: ['x'] } }, errors: null })).toBeNull()
    expect(parseVisits({})).toBeNull()
    expect(parseTopPaths({ data: { viewer: { zones: [] } }, errors: null })).toBeNull()
    expect(parseTopPaths({ data: null, errors: null })).toBeNull()
    expect(parseTopPaths({ data: { viewer: { zones: [null] } }, errors: null })).toBeNull()
    expect(parseTopPaths({ data: { viewer: { zones: ['x'] } }, errors: null })).toBeNull()
    expect(parseTopPaths({})).toBeNull()
  })

  it('parseTopPaths keeps the pages when 150 asset groups outrank them all', () => {
    const assets = Array.from({ length: 150 }, (_, index) => ({
      count: 1000 - index,
      avg: { sampleInterval: 1 },
      dimensions: { clientRequestPath: `/_next/static/chunk-${index}.js` },
    }))
    const pages = Array.from({ length: 12 }, (_, index) => ({
      count: 50 - index,
      avg: { sampleInterval: 1 },
      dimensions: { clientRequestPath: `/page-${index}` },
    }))
    const parsed = parseTopPaths(topPathsBody([...assets, ...pages]))
    expect(parsed!.topPaths.map((entry) => entry.path)).toEqual(Array.from({ length: 10 }, (_, index) => `/page-${index}`))
  })

  it('parseTopPaths drops assets and admin/api/_next paths, then takes the top 10', () => {
    const groups = [
      ...Array.from({ length: 12 }, (_, index) => ({
        count: 100 - index,
        avg: { sampleInterval: 1 },
        dimensions: { clientRequestPath: `/page-${index}` },
      })),
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/style.css' } },
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/admin' } },
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/api/contact' } },
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/_next/x.js' } },
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/cdn-cgi/rum' } },
      { count: 999, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: '/media/photo.avif' } },
    ]
    const parsed = parseTopPaths(topPathsBody(groups))
    expect(parsed).not.toBeNull()
    expect(parsed!.topPaths).toHaveLength(10)
    expect(parsed!.topPaths[0]).toEqual({ path: '/page-0', count: 100 })
    expect(parsed!.topPaths.some((entry) => entry.path.startsWith('/page-1'))).toBe(true)
    expect(parsed!.topPaths.some((entry) => entry.count === 999)).toBe(false)
  })
})
