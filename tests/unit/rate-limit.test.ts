// The contact form's caller key (P06/D32). The IP behind the key must be one
// the caller cannot choose: Cloudflare's `cf-connecting-ip` on the hosted
// project (Cloudflare replaces any client value), else the hop the last
// proxy appended to `x-forwarded-for`. Trusting a client-chosen value would
// let a caller rotate the throttle bucket freely, or fill a victim's.
import { describe, expect, it } from 'vitest'

import { clientKeyHash, requestIp, throttleAddress } from '../../supabase/functions/_shared/rate-limit.ts'

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

describe('throttleAddress', () => {
  it('an IPv6 client is keyed by its /64: a rotating host half never buys a fresh bucket', () => {
    const key = '2001:db8:1:2::/64'
    expect(throttleAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(key)
    expect(throttleAddress('2001:DB8:0001:0002::1')).toBe(key)
    expect(throttleAddress('2001:db8:1:2:3:4:5:6')).toBe(key)
    expect(throttleAddress('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64')
    expect(throttleAddress('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(throttleAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('IPv4, local, loopback, IPv4-mapped and malformed text stay whole', () => {
    for (const ip of ['198.51.100.7', 'local', '::1', '::', '::ffff:198.51.100.7', '::ffff:c633:6407', 'not:an:ip', '1::2::3']) {
      expect(throttleAddress(ip)).toBe(ip)
    }
  })

  it('two requests from one /64 share a caller key; another /64 does not', async () => {
    const from = (ip: string) => new Request('https://functions.example/contact', { headers: { 'cf-connecting-ip': ip } })
    const a = await clientKeyHash(from('2001:db8:1:2::1'), 'pepper')
    expect(await clientKeyHash(from('2001:db8:1:2:ffff:ffff:ffff:ffff'), 'pepper')).toBe(a)
    expect(await clientKeyHash(from('2001:db8:1:9::1'), 'pepper')).not.toBe(a)
    expect(requestIp(from('2001:db8:1:2::1'))).toBe('2001:db8:1:2::1')
  })
})
