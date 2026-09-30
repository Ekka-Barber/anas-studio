// `boundedText`: the public Edge Functions read every body through it, so an
// oversized or chunked body is refused without ever being held in memory.
import { describe, expect, it } from 'vitest'

import { boundedText } from '../../supabase/functions/_shared/http.ts'

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
