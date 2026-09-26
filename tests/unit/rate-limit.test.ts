// The contact form's caller key (P06/D32). The IP behind the key must be
// the one the Supabase gateway appended — every client-suppliable hop is
// attacker-chosen, and trusting one would let a caller rotate the throttle
// bucket freely (or lock a victim's bucket out).
import { describe, expect, it } from 'vitest'

import { requestIp } from '../../supabase/functions/_shared/rate-limit.ts'

const requestWith = (headers: Record<string, string>) => new Request('https://functions.example/contact', { headers })

describe('requestIp trusts only the gateway-appended hop', () => {
  it('a client-supplied cf-connecting-ip is ignored', () => {
    expect(requestIp(requestWith({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('local')
  })

  it('a single x-forwarded-for hop is the caller', () => {
    expect(requestIp(requestWith({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('of several hops the LAST one wins — the gateway appends the real caller', () => {
    // A forged first hop plus what the gateway appended behind it.
    expect(requestIp(requestWith({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('a forged cf-connecting-ip cannot override the forwarded hop', () => {
    expect(requestIp(requestWith({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe(
      '198.51.100.7',
    )
  })

  it('empty or whitespace hops are skipped; no headers at all is local', () => {
    expect(requestIp(requestWith({ 'x-forwarded-for': ' , , ' }))).toBe('local')
    expect(requestIp(requestWith({}))).toBe('local')
  })
})
