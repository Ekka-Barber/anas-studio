/**
 * The three kinds of token the store hands out, in one module (P08, contract
 * section 5). All of them are keyed by `TOKEN_HASH_PEPPER`, so it is never
 * rotated casually: a new value kills every link already mailed.
 *
 * - The order access token is deterministic in the order's idempotency key (and
 *   in its recovery version), so a retried request mints the same one (D08:
 *   private order links use expiring hash-stored tokens). Only its peppered
 *   sha256 ever reaches the database.
 * - The download token is random, minted when a buyer asks for a file; only its
 *   hash is stored.
 * - The notification token is derived from the subscription and its token
 *   version, so nothing about it is stored at all.
 *
 * Comparing a token, a hash or a mac is always `secretsMatch` (env.ts).
 */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url(HMAC-SHA256) — 43 characters for a 32-byte signature. */
export async function hmacBase64Url(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))))
}

/**
 * The buyer's order-access token. Version 0 is the one `checkout` has always
 * minted; a recovery that has to replace an expired link derives version n.
 */
export function orderAccessToken(pepper: string, idempotencyKey: string, version = 0): Promise<string> {
  return hmacBase64Url(pepper, version === 0 ? `order-access:${idempotencyKey}` : `order-access:${idempotencyKey}:${version}`)
}

export function orderAccessTokenHash(pepper: string, token: string): Promise<string> {
  return sha256Hex(`${pepper}:order:${token}`)
}

/** 32 random bytes, base64url. */
export function downloadToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export function downloadTokenHash(pepper: string, token: string): Promise<string> {
  return sha256Hex(`${pepper}:download:${token}`)
}

/** `<subscription id>.<mac>`; a new `tokenVersion` kills every older link. */
export async function notificationToken(pepper: string, id: string, tokenVersion: number): Promise<string> {
  return `${id}.${await hmacBase64Url(pepper, `notify:${id}:${tokenVersion}`)}`
}

const NOTIFICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAC = /^[A-Za-z0-9_-]{43}$/

/** The id and the mac of a notification token, or null when it is not shaped like one; the caller recomputes the mac and compares. */
export function parseNotificationToken(token: string): { id: string; mac: string } | null {
  const parts = token.split('.')
  const [id, mac] = parts
  return parts.length === 2 && id !== undefined && mac !== undefined && NOTIFICATION_ID.test(id) && MAC.test(mac) ? { id, mac } : null
}
