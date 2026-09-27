// The contact form's caller key (P06/D32). The IP behind the key must be one
// the caller cannot choose: Cloudflare's `cf-connecting-ip` on the hosted
// project (Cloudflare replaces any client value), else the hop the last
// proxy appended to `x-forwarded-for`. Trusting a client-chosen value would
// let a caller rotate the throttle bucket freely, or fill a victim's.
import { describe, expect, it } from 'vitest'

import { requestIp } from '../../supabase/functions/_shared/rate-limit.ts'

const requestWith = (headers: Record<string, string>) => new Request('https://functions.example/contact', { headers })

describe('requestIp', () => {
  it('cf-connecting-ip wins: behind Cloudflare only Cloudflare can set it', () => {
    expect(requestIp(requestWith({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe(
      '198.51.100.7',
    )
  })

  it('a forged x-forwarded-for cannot override cf-connecting-ip', () => {
    expect(requestIp(requestWith({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4' }))).toBe(
      '198.51.100.7',
    )
  })

  it('without cf-connecting-ip, the LAST x-forwarded-for hop: earlier hops are client-chosen', () => {
    expect(requestIp(requestWith({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(requestIp(requestWith({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('empty or whitespace values are skipped; no headers at all is local', () => {
    expect(requestIp(requestWith({ 'cf-connecting-ip': ' ', 'x-forwarded-for': ' , , ' }))).toBe('local')
    expect(requestIp(requestWith({}))).toBe('local')
  })
})
