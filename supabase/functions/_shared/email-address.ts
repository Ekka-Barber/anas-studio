import { z } from 'zod'

/**
 * The address of a person, in one place (RESIDUALS-1 round R3b, QUALITY-18): the grammar, the conversion of an
 * internationalised domain, and the one field the four public functions (`contact`, `checkout`, `orders`, `notify`) read
 * an address with. The staff order search (`src/lib/admin-orders.ts`) checks the typed address with the same two pieces, so
 * a buyer whose address has a domain like `.السعودية` is found by the address he wrote, not only by its `xn--` form.
 * Pure: no runtime APIs beyond the URL parser and no imports but zod.
 */

/**
 * The email grammar, shared verbatim with the database's own check: a local
 * part of header-safe characters, a bounded domain, and a TLD that is either
 * purely alphabetic or a punycode label (`xn--…`) — the only form in which an
 * internationalised domain like `.السعودية` reaches storage (`toAsciiAddress`
 * below converts it first). The stored address becomes the notice's
 * Reply-To, so a loose grammar would let an address like
 * `x@evil.test?bcc=…&body=…` reach the owner's reply; only this shape
 * reaches storage.
 */
export const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$/

/**
 * Punycodes an address whose domain carries non-ASCII (e.g. the Saudi
 * `.السعودية`) via the URL parser's IDNA hostname, so the ASCII form is what
 * gets validated — and stored. A domain the parser refuses is returned
 * untouched and fails the grammar below.
 */
export function toAsciiAddress(email: string): string {
  const at = email.lastIndexOf('@')
  if (at === -1) return email
  const domain = email.slice(at + 1)
  if (/^[\x00-\x7F]*$/.test(domain)) return email
  // The URL parser would silently drop a path, query, fragment or port after
  // the host (`x@ü.test/…` → `x@xn--tda.test`) and decode `%xx`; such a
  // "domain" is left untouched so the grammar refuses it rather than storing
  // an address the visitor never typed.
  if (/[\s/\\?#:@%]/.test(domain)) return email
  try {
    return `${email.slice(0, at)}@${new URL(`http://${domain}`).hostname}`
  } catch {
    return email
  }
}

/**
 * The email field of the public functions: trimmed and lower-cased, then its domain converted to ASCII, then checked
 * against the grammar, so the address is stored (and hashed, and looked up) the way every function writes it.
 */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((email) => toAsciiAddress(email))
  // Punycode can expand the domain, so the stored length is re-bounded here.
  .refine((email) => email.length <= 254 && EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' })
