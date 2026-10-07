// P06 round 2 unit tests: the Cloudflare GraphQL Analytics request shape and
// the response parser against fixture responses, with `fetch` stubbed. A
// missing token or zone id must not touch the network at all.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  analyticsSlices,
  analyticsVariables,
  analyticsWindow,
  fetchAnalytics,
  parseTopPaths,
  parseVisits,
  SETTINGS_QUERY,
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

// FABLE-AUDIT F3-14 (VENDOR-PLAT-01): a plan can cap the time range of one query below the 7 days, so the window is read in
// slices of the cap and put together. The settings node is read once per zone and isolate (5 minutes, a failed read never kept);
// any failure to read it keeps today's single pair of queries. The node's name under `settings` is not confirmed by a fetched
// page, so every shape that is not two whole positive numbers is "no settings".
describe('a time range one query may not ask for', () => {
  const DAY = 86_400_000
  const START = Date.parse('2026-09-19T12:00:00Z')
  const END = Date.parse('2026-09-26T12:00:00Z')
  const WHOLE = { start: '2026-09-19T12:00:00Z', end: '2026-09-26T12:00:00Z' }
  const stamp = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')
  const SAMPLED_GROUP = { sum: { visits: 1 }, avg: { sampleInterval: 10 } }

  let zones = 0
  /** Every test has its own zone: the settings are cached per zone for the life of the module. */
  function configure() {
    zones += 1
    vi.stubEnv('ANALYTICS_TOKEN', 'token')
    vi.stubEnv('CLOUDFLARE_ZONE_ID', `zone-slices-${zones}`)
    vi.stubEnv('SITE_URL', 'https://anas.studio')
  }

  const settingsBody = (maxDuration: unknown, notOlderThan: unknown = 2_678_400) => ({
    data: { viewer: { zones: [{ settings: { httpRequestsAdaptiveGroups: { maxDuration, notOlderThan, maxPageSize: 10_000 } } }] } },
    errors: null,
  })

  type Name = 'settings' | 'visits' | 'paths'
  type Slice = { start: string; end: string }
  interface Answers {
    /** What the settings call answers, as a function of the call (so a test can change its mind). */
    settings?: () => unknown
    settingsStatus?: () => number
    settingsFails?: () => boolean
    visits?: (slice: Slice) => unknown
    visitsStatus?: (slice: Slice) => number
    paths?: (slice: Slice) => unknown
  }
  /** An endpoint that answers each query by its name, and a slice's visits and paths by the range the query carried. */
  function stubEndpoint(answers: Answers) {
    const asked: Array<{ name: Name; start?: string; end?: string; zoneTag?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const { query, variables } = JSON.parse(init?.body ?? '{}') as { query: string; variables: { start?: string; end?: string; zoneTag?: string } }
        const name: Name = query === SETTINGS_QUERY ? 'settings' : query === TOP_PATHS_QUERY ? 'paths' : 'visits'
        asked.push({ name, ...variables })
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
        if (name === 'settings') {
          if (answers.settingsFails?.()) throw new TypeError('fetch failed')
          return json((answers.settings ?? (() => settingsBody(DAY / 1000)))(), answers.settingsStatus?.() ?? 200)
        }
        const slice = { start: variables.start ?? '', end: variables.end ?? '' }
        if (name === 'visits') return json((answers.visits ?? (() => visitsBody([{ sum: { visits: 1 }, avg: { sampleInterval: 1 } }])))(slice), answers.visitsStatus?.(slice) ?? 200)
        return json((answers.paths ?? (() => topPathsBody([])))(slice))
      }),
    )
    const of = (name: Name) => asked.filter((entry) => entry.name === name)
    return { asked, of, count: (name: Name) => of(name).length, ranges: (name: Name) => of(name).map(({ start, end }) => ({ start, end })) }
  }
  const page = (path: string, count: number) => ({ count, avg: { sampleInterval: 1 }, dimensions: { clientRequestPath: path } })
  const slicesOf = (seconds: number): Slice[] =>
    Array.from({ length: Math.ceil((END - START) / (seconds * 1000)) }, (_, index) => ({
      start: stamp(START + index * seconds * 1000),
      end: stamp(Math.min(START + (index + 1) * seconds * 1000, END)),
    }))

  it('cuts the window into slices that together are exactly the window, none longer than the cap, the last one shorter when the cap does not divide it', () => {
    const days = analyticsSlices(NOW, 86_400)
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual({ start: '2026-09-19T12:00:00Z', end: '2026-09-20T12:00:00Z' })
    expect(days[6]).toEqual({ start: '2026-09-25T12:00:00Z', end: '2026-09-26T12:00:00Z' })
    expect(analyticsSlices(NOW, 259_200)).toEqual([
      { start: '2026-09-19T12:00:00Z', end: '2026-09-22T12:00:00Z' },
      { start: '2026-09-22T12:00:00Z', end: '2026-09-25T12:00:00Z' },
      { start: '2026-09-25T12:00:00Z', end: '2026-09-26T12:00:00Z' },
    ])
    for (const seconds of [86_400, 100_000, 259_200, 604_799]) {
      const slices = analyticsSlices(NOW, seconds)
      expect(slices[0]!.start).toBe(WHOLE.start)
      expect(slices.at(-1)!.end).toBe(WHOLE.end)
      slices.forEach((slice, index) => {
        expect(Date.parse(slice.end) - Date.parse(slice.start), String(seconds)).toBeLessThanOrEqual(seconds * 1000)
        if (index > 0) expect(slice.start, String(seconds)).toBe(slices[index - 1]!.end)
      })
    }
  })

  it('asks the settings node of the zone for its limits, in the docs\' discovery shape', () => {
    expect(SETTINGS_QUERY).toContain('zones(filter: { zoneTag: $zoneTag })')
    expect(SETTINGS_QUERY).toContain('settings')
    expect(SETTINGS_QUERY).toContain('httpRequestsAdaptiveGroups { maxDuration notOlderThan maxPageSize }')
  })

  it('a cap of one day asks 7 slices of visits and 7 of paths, sums the visits and merges the paths by path before the pages are picked and the top 10 taken', async () => {
    configure()
    const slices = slicesOf(86_400)
    const slot = (slice: Slice) => slices.findIndex((candidate) => candidate.start === slice.start)
    const endpoint = stubEndpoint({
      settings: () => settingsBody(86_400),
      visits: (slice) => visitsBody([{ sum: { visits: 100 * (slot(slice) + 1) }, avg: { sampleInterval: 1 } }]),
      // Each day: a page of its own and one every day shares, with assets and the admin outranking them all; the home page
      // is in two of the days, and three rare pages are in the first.
      paths: (slice) =>
        topPathsBody([
          page('/_next/static/app.js', 1000),
          page('/admin/orders', 900),
          page('/common', 3),
          page(`/day-${slot(slice)}`, 5),
          ...(slot(slice) === 0 || slot(slice) === 3 ? [page('/', 4)] : []),
          ...(slot(slice) === 0 ? [page('/rare-a', 1), page('/rare-b', 1), page('/rare-c', 1)] : []),
        ]),
    })
    expect(await fetchAnalytics(NOW)).toEqual({
      status: 'ok',
      range: WHOLE,
      visits: 100 * (1 + 2 + 3 + 4 + 5 + 6 + 7),
      topPaths: [
        { path: '/common', count: 21 },
        { path: '/', count: 8 },
        ...Array.from({ length: 7 }, (_, day) => ({ path: `/day-${day}`, count: 5 })),
        { path: '/rare-a', count: 1 },
      ],
      fetchedAt: NOW.toISOString(),
    })
    // One read of the settings for the zone, and one pair of queries per slice, the slices exactly the window, oldest first.
    expect(endpoint.count('settings')).toBe(1)
    expect(endpoint.of('settings')[0]).toMatchObject({ zoneTag: `zone-slices-${zones}` })
    expect(endpoint.count('visits')).toBe(7)
    expect(endpoint.count('paths')).toBe(7)
    expect(endpoint.ranges('visits')).toEqual(slices)
    expect(endpoint.ranges('paths')).toEqual(slices)
    expect(slices).toHaveLength(7)
  })

  it('a cap of three days asks 3 slices, the last one day long, and puts them together the same way', async () => {
    configure()
    const slices = slicesOf(259_200)
    expect(slices.map((slice) => (Date.parse(slice.end) - Date.parse(slice.start)) / DAY)).toEqual([3, 3, 1])
    const endpoint = stubEndpoint({
      settings: () => settingsBody(259_200),
      visits: () => visitsBody([{ sum: { visits: 40 }, avg: { sampleInterval: 1 } }]),
      paths: () => topPathsBody([page('/', 10), page('/started', 2)]),
    })
    const result = await fetchAnalytics(NOW)
    expect(result).toMatchObject({ status: 'ok', range: WHOLE, visits: 120, topPaths: [{ path: '/', count: 30 }, { path: '/started', count: 6 }] })
    expect(endpoint.ranges('visits')).toEqual(slices)
    expect(endpoint.ranges('paths')).toEqual(slices)
  })

  it.each([
    ['a GraphQL error', { data: null, errors: [{ message: 'unknown field "settings"' }] }],
    ['an answer without the node', { data: { viewer: { zones: [{ settings: {} }] } }, errors: null }],
    ['a null node', { data: { viewer: { zones: [{ settings: { httpRequestsAdaptiveGroups: null } }] } }, errors: null }],
    ['no zone', { data: { viewer: { zones: [] } }, errors: null }],
    ['two zones', { data: { viewer: { zones: [{ settings: {} }, { settings: {} }] } }, errors: null }],
    ['a cap that is a text', settingsBody('86400')],
    ['a cap with a fraction', settingsBody(86_400.5)],
    ['a cap of zero', settingsBody(0)],
    ['a cap below zero', settingsBody(-86_400)],
    ['a missing cap', settingsBody(undefined)],
    ['a null cap', settingsBody(null)],
    ['a reach that is a text', settingsBody(86_400, '2678400')],
    ['a missing reach', { data: { viewer: { zones: [{ settings: { httpRequestsAdaptiveGroups: { maxDuration: 86_400 } } }] } }, errors: null }],
    ['a null reach', settingsBody(86_400, null)],
    ['a reach of zero', settingsBody(86_400, 0)],
  ])('%s in the settings is no settings: the 7 days go in one pair of queries, as before', async (_label, settings) => {
    configure()
    const endpoint = stubEndpoint({ settings: () => settings, visits: () => visitsBody([{ sum: { visits: 9 }, avg: { sampleInterval: 1 } }]), paths: () => topPathsBody([page('/', 3)]) })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'ok', range: WHOLE, visits: 9, topPaths: [{ path: '/', count: 3 }], fetchedAt: NOW.toISOString() })
    expect(endpoint.ranges('visits')).toEqual([WHOLE])
    expect(endpoint.ranges('paths')).toEqual([WHOLE])
  })

  it.each([
    ['an HTTP error', { settingsStatus: () => 500 }],
    ['a refused token', { settingsStatus: () => 401 }],
    ['a lost connection', { settingsFails: () => true }],
  ])('a settings call that ends in %s is no settings either, and costs the stats nothing', async (_label, over) => {
    configure()
    const endpoint = stubEndpoint({ ...over, visits: () => visitsBody([{ sum: { visits: 9 }, avg: { sampleInterval: 1 } }]) })
    expect(await fetchAnalytics(NOW)).toMatchObject({ status: 'ok', range: WHOLE, visits: 9 })
    expect(endpoint.ranges('visits')).toEqual([WHOLE])
    expect(endpoint.ranges('paths')).toEqual([WHOLE])
  })

  it.each([
    ['a cap of the whole window', 604_800, 2_678_400],
    ['a cap above the window', 2_592_000, 2_678_400],
    ['a cap of under a day (it would be 8 or more slices of nothing the plan allows)', 86_399, 2_678_400],
    ['a cap of an hour', 3_600, 2_678_400],
    ['a cap of a second', 1, 2_678_400],
    ['data that does not go back the whole window', 86_400, 604_799],
    ['data that goes back a day', 86_400, 86_400],
  ])('%s keeps the single pair of queries: no storm, and no numbers for a window other than the 7 days the screen names', async (_label, maxDuration, notOlderThan) => {
    configure()
    const endpoint = stubEndpoint({ settings: () => settingsBody(maxDuration, notOlderThan) })
    expect(await fetchAnalytics(NOW)).toMatchObject({ status: 'ok', range: WHOLE })
    expect(endpoint.count('settings')).toBe(1)
    expect(endpoint.ranges('visits')).toEqual([WHOLE])
    expect(endpoint.ranges('paths')).toEqual([WHOLE])
  })

  it('reads the settings once in five minutes per zone, and never keeps a read that failed', async () => {
    configure()
    let failing = true
    const endpoint = stubEndpoint({ settings: () => (failing ? { data: null, errors: [{ message: 'no' }] } : settingsBody(86_400)) })
    // The first read fails: one pair of queries, and the next look asks again.
    await fetchAnalytics(NOW)
    expect(endpoint.count('settings')).toBe(1)
    expect(endpoint.count('visits')).toBe(1)
    failing = false
    await fetchAnalytics(NOW)
    expect(endpoint.count('settings')).toBe(2)
    expect(endpoint.count('visits')).toBe(1 + 7)
    // Read and kept: four minutes later it is not asked again, six minutes later it is.
    await fetchAnalytics(new Date(NOW.getTime() + 4 * 60_000))
    expect(endpoint.count('settings')).toBe(2)
    expect(endpoint.count('visits')).toBe(1 + 7 + 7)
    await fetchAnalytics(new Date(NOW.getTime() + 6 * 60_000))
    expect(endpoint.count('settings')).toBe(3)
    // Another zone has limits of its own.
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone-slices-other')
    await fetchAnalytics(new Date(NOW.getTime() + 6 * 60_000))
    expect(endpoint.count('settings')).toBe(4)
    expect(endpoint.of('settings').at(-1)).toMatchObject({ zoneTag: 'zone-slices-other' })
  })

  it('one slice that cannot be read makes the whole answer unavailable, never a total of what was read', async () => {
    configure()
    const slices = slicesOf(86_400)
    const third = slices[2]!
    const good = () => visitsBody([{ sum: { visits: 5 }, avg: { sampleInterval: 1 } }])
    stubEndpoint({ settings: () => settingsBody(86_400), visits: (slice) => (slice.start === third.start ? { data: null, errors: null } : good()) })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'UNEXPECTED_SHAPE' })

    stubEndpoint({ settings: () => settingsBody(86_400), visits: (slice) => (slice.start === third.start ? visitsBody([], [{ message: 'range too wide' }]) : good()) })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'GRAPHQL_ERROR' })

    stubEndpoint({ settings: () => settingsBody(86_400), visits: good, visitsStatus: (slice) => (slice.start === third.start ? 502 : 200) })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'HTTP_ERROR' })

    // Sampling in any slice, of the visits or of the paths, makes every figure an estimate.
    stubEndpoint({ settings: () => settingsBody(86_400), visits: (slice) => (slice.start === third.start ? visitsBody([SAMPLED_GROUP]) : good()) })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'SAMPLED' })
    stubEndpoint({
      settings: () => settingsBody(86_400),
      visits: good,
      paths: (slice) => topPathsBody([{ ...page('/', 3), avg: { sampleInterval: slice.start === third.start ? 4 : 1 } }]),
    })
    expect(await fetchAnalytics(NOW)).toEqual({ status: 'unavailable', reason: 'SAMPLED' })
  })
})
