/**
 * The contact form's caller key (P06). A raw IP is never stored or logged:
 * only a sha256 of `${pepper}:${utc-date}:${ip}` goes to the database, where
 * `finance.rate_limit_take` counts it in a fixed window. The daily date
 * component salts the hash, so the stored value cannot be correlated across
 * days and cannot be reversed without the pepper.
 */

/** The header Cloudflare sets to the visitor's IP; absent under `next dev`. */
const CF_IP_HEADER = 'cf-connecting-ip'

/** The IP the request came from, or the literal `local` outside Cloudflare. */
export function requestIp(request: Request): string {
  return request.headers.get(CF_IP_HEADER) ?? 'local'
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
