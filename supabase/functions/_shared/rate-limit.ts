/**
 * The contact form's caller key (P06). A raw IP is never stored or logged:
 * only a sha256 of `${pepper}:${utc-date}:${ip}` goes to the database, where
 * `finance.rate_limit_take` counts it in a fixed window. The daily date
 * component salts the hash, so the stored value cannot be correlated across
 * days and cannot be reversed without the pepper.
 */

/**
 * The visitor's IP, only ever hashed, never stored:
 *
 * 1. `cf-connecting-ip`. Hosted Supabase sits behind Cloudflare, which sets
 *    this header on every request and replaces any value the client sent,
 *    so it is the one source a caller cannot choose.
 * 2. Else the LAST `x-forwarded-for` hop: a proxy appends the address that
 *    connected to it after whatever the client sent, so earlier hops are
 *    attacker-chosen. It is the fallback, not the source, because it is only
 *    right while no further proxy appends behind the one that saw the
 *    visitor, and a missing header would pool every such visitor under
 *    `local`.
 * 3. Else the literal `local` (a direct local call).
 *
 * Locally there is no Cloudflare, so both headers are whatever the caller
 * sends; the tests use that to give each run its own bucket. Which headers
 * the hosted project actually delivers is checked at P11 (I32).
 */
export function requestIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const hops = request.headers.get('x-forwarded-for')?.split(',').map((hop) => hop.trim()).filter(Boolean) ?? []
  return hops.at(-1) ?? 'local'
}

/**
 * The address part of the key. An IPv6 client is reduced to its /64: one
 * subscriber or VPS controls a whole /64, so keying on the full address would
 * give a caller a fresh bucket on every request. IPv4, `local`, IPv4-mapped
 * addresses and anything that is not a plain IPv6 address stay as they are.
 * (`requestIp` keeps the real address; Turnstile's `remoteip` still gets it.)
 */
export function throttleAddress(ip: string): string {
  const halves = ip.toLowerCase().split('%')[0]!.split('::')
  if (!ip.includes(':') || halves.length > 2) return ip
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves[1] ? halves[1].split(':') : []
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : head
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return ip
  // `::`, `::1` and the IPv4-mapped forms have a zero prefix: keep them whole.
  if (groups.slice(0, 5).every((group) => parseInt(group, 16) === 0)) return ip
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`
}

/** sha256 hex of the peppered, date-salted caller key. */
export async function clientKeyHash(request: Request, pepper: string): Promise<string> {
  const now = new Date()
  const utcDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`
  const material = `${pepper}:${utcDate}:${throttleAddress(requestIp(request))}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
