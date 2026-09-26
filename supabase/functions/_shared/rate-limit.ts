/**
 * The contact form's caller key (P06). A raw IP is never stored or logged:
 * only a sha256 of `${pepper}:${utc-date}:${ip}` goes to the database, where
 * `finance.rate_limit_take` counts it in a fixed window. The daily date
 * component salts the hash, so the stored value cannot be correlated across
 * days and cannot be reversed without the pepper.
 */

/**
 * The visitor's IP: the LAST `x-forwarded-for` hop, which the Supabase
 * gateway appends after anything the client sent — earlier hops, and a
 * client-supplied `cf-connecting-ip`, are attacker-chosen here (only
 * Cloudflare itself sets that header, and this function runs behind
 * Supabase). With neither header, the literal `local` (a direct local
 * call). Only ever hashed, never stored.
 */
export function requestIp(request: Request): string {
  const hops = request.headers.get('x-forwarded-for')?.split(',').map((hop) => hop.trim()).filter(Boolean) ?? []
  return hops.at(-1) ?? 'local'
}

/** sha256 hex of the peppered, date-salted caller key. */
export async function clientKeyHash(request: Request, pepper: string): Promise<string> {
  const now = new Date()
  const utcDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`
  const material = `${pepper}:${utcDate}:${requestIp(request)}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
