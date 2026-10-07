// `boundedText`: the public Edge Functions read every body through it, so an
// oversized or chunked body is refused without ever being held in memory.
// `fail` and `logCause` (FABLE-AUDIT F3-1, QUALITY-04): a handled server fault leaves a line in the log that the
// reply's requestId matches, and the cause leaves the function and the SQLSTATE only.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boundedText, fail, logCause, ok, sqlstateOf } from '../../supabase/functions/_shared/http.ts'

/** A POST that streams `chunks` with no content-length, like a chunked upload; counts the pulls. */
function chunked(chunks: Uint8Array[]): { request: Request; pulls: () => number } {
  let index = 0
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      const chunk = chunks[index++]
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
  })
  const request = new Request('http://localhost/fn', { method: 'POST', body, duplex: 'half' } as RequestInit)
  return { request, pulls: () => pulls }
}

describe('boundedText', () => {
  it('stops reading a chunked body as soon as it passes the limit', async () => {
    const { request, pulls } = chunked(Array.from({ length: 200 }, () => new Uint8Array(1024)))
    expect(await boundedText(request, 4096)).toBeNull()
    expect(pulls()).toBeLessThan(20)
  })

  it('reads a body inside the limit, multibyte characters split across chunks included', async () => {
    const bytes = new TextEncoder().encode('رسالة أنساق')
    const { request } = chunked(Array.from(bytes, (byte) => new Uint8Array([byte])))
    expect(await boundedText(request, bytes.length)).toBe('رسالة أنساق')
  })

  it('refuses a declared length past the limit before reading', async () => {
    const request = new Request('http://localhost/fn', { method: 'POST', body: 'ok', headers: { 'content-length': '9999' } })
    expect(await boundedText(request, 100)).toBeNull()
  })

  it('an empty body is an empty string', async () => {
    expect(await boundedText(new Request('http://localhost/fn', { method: 'POST' }), 100)).toBe('')
  })
})

describe('fail: the log of a handled server fault', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a 5xx reply logs once, with the requestId it carries, its status and its code, and nothing else', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const status of [500, 502, 503]) {
      logged.mockClear()
      const response = fail(status, 'FAILED', 'تعذّر إكمال الإجراء.', { name: ['x'] })
      const body = (await response.json()) as { requestId: string; error: { code: string } }
      expect(response.status).toBe(status)
      expect(body.requestId).toMatch(UUID)
      expect(logged).toHaveBeenCalledTimes(1)
      // One JSON line; the reply's message and fields are not in it.
      expect(JSON.parse(logged.mock.calls[0]![0] as string)).toEqual({ requestId: body.requestId, status, code: 'FAILED' })
    }
  })

  it('each 5xx reply has its own requestId, and the log line is that reply\'s', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = (await fail(500, 'FAILED', 'م').json()) as { requestId: string }
    const second = (await fail(500, 'FAILED', 'م').json()) as { requestId: string }
    expect(first.requestId).not.toBe(second.requestId)
    expect(logged.mock.calls.map(([line]) => (JSON.parse(line as string) as { requestId: string }).requestId)).toEqual([first.requestId, second.requestId])
  })

  it('a reply under 500 logs nothing, and neither does a success', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 499]) {
      const response = fail(status, 'REFUSED', 'م')
      expect(response.status).toBe(status)
      expect(((await response.json()) as { requestId: string }).requestId).toMatch(UUID)
    }
    ok({ fine: true })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('logCause: where a handled failure came from', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const lineOf = (logged: ReturnType<typeof vi.spyOn>): unknown => JSON.parse(logged.mock.calls[0]![0] as string)

  it('sqlstateOf is the code of a database error and null for anything else: what the failed jobs record', () => {
    expect(sqlstateOf(Object.assign(new Error('x'), { code: '57014' }))).toBe('57014')
    expect(sqlstateOf({ code: 'PGRST301' })).toBe('PGRST301')
    for (const other of [new Error('57014'), null, undefined, 'boom', { code: 57014 }, { code: 'ECONNRESET' }, { code: '' }]) expect(sqlstateOf(other), String(other)).toBeNull()
  })

  it('logs the function and the SQLSTATE, never the message, which can carry a value', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logCause('refunds', Object.assign(new Error('duplicate key value (buyer@example.com, 10.0.0.5) violates "x"'), { code: '23505' }))
    expect(logged).toHaveBeenCalledTimes(1)
    expect(lineOf(logged)).toEqual({ fn: 'refunds', sqlstate: '23505' })
    expect(String(logged.mock.calls[0]![0])).not.toMatch(/buyer|10\.0\.0\.5|duplicate/)
  })

  it('keeps a SQLSTATE of letters and digits and PostgREST\'s own code, and nothing else as a code', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const code of ['42501', '22P02', 'XX000', 'PGRST202']) {
      logged.mockClear()
      logCause('orders', Object.assign(new Error('x'), { code }))
      expect(lineOf(logged), code).toEqual({ fn: 'orders', sqlstate: code })
    }
    // A network failure or a timeout has no database code; an Auth or a client code is not one either, and a code that carries text is not logged.
    for (const error of [new Error('fetch failed'), new DOMException('timeout', 'TimeoutError'), null, undefined, 'boom', { code: 5 }, { code: '' }, { code: 'email_exists' }, { code: '23505 buyer@example.com' }]) {
      logged.mockClear()
      logCause('checkout', error)
      expect(lineOf(logged), String(error)).toEqual({ fn: 'checkout', sqlstate: null })
    }
  })
})
