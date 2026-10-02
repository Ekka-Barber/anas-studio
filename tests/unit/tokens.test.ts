// P08 round 3: the tokens module (supabase/functions/_shared/tokens.ts,
// contract section 5). The order access token must stay byte for byte what
// `checkout` has always minted (version 0): every link already mailed or held in
// a browser depends on it. The expected values are computed here with node:crypto,
// never with the module under test.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { secretsMatch } from '../../supabase/functions/_shared/env.ts'
import {
  downloadToken,
  downloadTokenHash,
  hmacBase64Url,
  notificationToken,
  orderAccessToken,
  orderAccessTokenHash,
  parseNotificationToken,
  sha256Hex,
} from '../../supabase/functions/_shared/tokens.ts'

const PEPPER = 'unit-test-pepper'
const mac = (message: string, key = PEPPER): string => createHmac('sha256', key).update(message).digest('base64url')
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('the primitives', () => {
  it('sha256Hex is the lower-case hex sha256 of the UTF-8 text', async () => {
    for (const text of ['', 'abc', 'طلب ABCD2345']) expect(await sha256Hex(text)).toBe(sha(text))
  })

  it('hmacBase64Url is the unpadded base64url HMAC-SHA256, 43 characters', async () => {
    const value = await hmacBase64Url(PEPPER, 'some message')
    expect(value).toBe(mac('some message'))
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('the order access token', () => {
  const key = randomUUID()

  it('version 0 is exactly what checkout always minted', async () => {
    const token = await orderAccessToken(PEPPER, key)
    expect(token).toBe(mac(`order-access:${key}`))
    expect(await orderAccessToken(PEPPER, key, 0)).toBe(token)
  })

  it('version n derives from the key and n, and every version differs', async () => {
    const tokens = [await orderAccessToken(PEPPER, key), await orderAccessToken(PEPPER, key, 1), await orderAccessToken(PEPPER, key, 2)]
    expect(tokens[1]).toBe(mac(`order-access:${key}:1`))
    expect(tokens[2]).toBe(mac(`order-access:${key}:2`))
    expect(new Set(tokens).size).toBe(3)
  })

  it('depends on the pepper and on the idempotency key', async () => {
    const token = await orderAccessToken(PEPPER, key)
    expect(await orderAccessToken('another-pepper', key)).not.toBe(token)
    expect(await orderAccessToken(PEPPER, randomUUID())).not.toBe(token)
  })

  it('its stored hash is sha256 of the peppered token, and the token itself is never the hash', async () => {
    const token = await orderAccessToken(PEPPER, key)
    const hash = await orderAccessTokenHash(PEPPER, token)
    expect(hash).toBe(sha(`${PEPPER}:order:${token}`))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await orderAccessTokenHash('another-pepper', token)).not.toBe(hash)
    expect(await orderAccessTokenHash(PEPPER, `${token}x`)).not.toBe(hash)
  })
})

describe('the download token', () => {
  it('is 32 random bytes in base64url (43 characters) and never repeats', () => {
    const tokens = Array.from({ length: 20 }, () => downloadToken())
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Set(tokens).size).toBe(20)
  })

  it('its hash uses the download domain, not the order one', async () => {
    const token = downloadToken()
    const hash = await downloadTokenHash(PEPPER, token)
    expect(hash).toBe(sha(`${PEPPER}:download:${token}`))
    expect(hash).not.toBe(await orderAccessTokenHash(PEPPER, token))
    expect(await downloadTokenHash('another-pepper', token)).not.toBe(hash)
  })
})

describe('the notification token', () => {
  const id = randomUUID()

  it('is <id>.<mac> of notify:<id>:<version>, and a new version changes only the mac', async () => {
    const first = await notificationToken(PEPPER, id, 1)
    expect(first).toBe(`${id}.${mac(`notify:${id}:1`)}`)
    const second = await notificationToken(PEPPER, id, 2)
    expect(second).toBe(`${id}.${mac(`notify:${id}:2`)}`)
    expect(second).not.toBe(first)
    expect(second.split('.')[0]).toBe(id)
  })

  it('round-trips through parseNotificationToken, and the recomputed mac matches in constant time', async () => {
    const token = await notificationToken(PEPPER, id, 3)
    const parsed = parseNotificationToken(token)
    expect(parsed).toEqual({ id, mac: mac(`notify:${id}:3`) })
    expect(secretsMatch(parsed!.mac, await hmacBase64Url(PEPPER, `notify:${parsed!.id}:3`))).toBe(true)
  })

  it('a stale version, another pepper or another subscription never matches', async () => {
    const parsed = parseNotificationToken(await notificationToken(PEPPER, id, 1))!
    expect(secretsMatch(parsed.mac, await hmacBase64Url(PEPPER, `notify:${id}:2`))).toBe(false)
    expect(secretsMatch(parsed.mac, await hmacBase64Url('another-pepper', `notify:${id}:1`))).toBe(false)
    expect(secretsMatch(parsed.mac, await hmacBase64Url(PEPPER, `notify:${randomUUID()}:1`))).toBe(false)
  })

  it('a tampered mac still parses (it is only shaped), and fails the comparison', async () => {
    const token = await notificationToken(PEPPER, id, 1)
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    const parsed = parseNotificationToken(flipped)
    expect(parsed).not.toBeNull()
    expect(secretsMatch(parsed!.mac, await hmacBase64Url(PEPPER, `notify:${id}:1`))).toBe(false)
  })

  it.each([
    ['an empty string', ''],
    ['no dot', 'abc'],
    ['no mac', `${randomUUID()}.`],
    ['no id', `.${'A'.repeat(43)}`],
    ['an id that is not a uuid', `not-a-uuid.${'A'.repeat(43)}`],
    ['an upper-case id', `${randomUUID().toUpperCase()}.${'A'.repeat(43)}`],
    ['a mac that is too short', `${randomUUID()}.${'A'.repeat(42)}`],
    ['a mac that is too long', `${randomUUID()}.${'A'.repeat(44)}`],
    ['a mac with characters outside base64url', `${randomUUID()}.${'A'.repeat(42)}+`],
    ['a third part', `${randomUUID()}.${'A'.repeat(43)}.extra`],
  ])('refuses %s', (_label, token) => {
    expect(parseNotificationToken(token)).toBeNull()
  })
})
