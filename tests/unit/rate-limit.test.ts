// The contact form's caller key (P06/D32). The IP behind the key must be one
// the caller cannot choose: Cloudflare's `cf-connecting-ip` on the hosted
// project (Cloudflare replaces any client value), else the hop the last
// proxy appended to `x-forwarded-for`. Trusting a client-chosen value would
// let a caller rotate the throttle bucket freely, or fill a victim's.
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

// FABLE-AUDIT T-13: what reaches finance.rate_limits is sha256(pepper:utc-date:address). Without the pepper the hash of
// an address could be looked up; without the date one key would follow a visitor across days.
describe('clientKeyHash', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const ip = '198.51.100.7'
  const visitor = () => requestWith({ 'cf-connecting-ip': ip })

  it('changes with the pepper and with the UTC date, and is never the address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
    const key = await clientKeyHash(visitor(), 'pepper-a')
    expect(await clientKeyHash(visitor(), 'pepper-a')).toBe(key)
    expect(await clientKeyHash(visitor(), 'pepper-b')).not.toBe(key)
    // The last second of the same UTC day (already the next day in Riyadh) keeps the key; the next UTC day changes it.
    vi.setSystemTime(new Date('2026-10-07T23:59:59Z'))
    expect(await clientKeyHash(visitor(), 'pepper-a')).toBe(key)
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    expect(await clientKeyHash(visitor(), 'pepper-a')).not.toBe(key)
    // A digest, not the address: hex only, without the address in it, and not the address's bare hash either.
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain(ip)
    expect(key).not.toBe(createHash('sha256').update(ip).digest('hex'))
  })
})
