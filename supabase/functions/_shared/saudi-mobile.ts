/**
 * Saudi mobile normalization, shared by the site (`src/lib/format.ts`
 * re-exports it) and the `checkout` Edge Function, so the form, the preview
 * and the server's own check can never disagree on what a valid number is.
 */

/** Invisible direction marks a phone number picks up when copied out of RTL
 * text (LRM, RLM, ALM and the embedding/isolate controls). */
const BIDI_MARK = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/

/**
 * Digits only: Arabic-Indic (U+0660–U+0669) and extended (U+06F0–U+06F9)
 * digits become ASCII; whitespace of any kind (including no-break spaces),
 * direction marks, dashes, dots and parentheses are dropped along with one
 * leading `+`; a leading `00` becomes the international form. Any other
 * character (letters, a `+` after digits) is not a phone number.
 */
export function foldDigits(input: string): string | null {
  let digits = ''
  let seenDigit = false
  for (const char of input.trim()) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x30 && code <= 0x39) {
      digits += char
      seenDigit = true
      continue
    }
    if ((code >= 0x0660 && code <= 0x0669) || (code >= 0x06f0 && code <= 0x06f9)) {
      digits += String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
      seenDigit = true
      continue
    }
    if (!seenDigit && char === '+') continue
    if (/\s/.test(char) || BIDI_MARK.test(char) || char === '-' || char === '.' || char === '(' || char === ')') continue
    return null
  }
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits
}

/**
 * A Saudi mobile in any everyday spelling — `9665XXXXXXXX`, `+9665XXXXXXXX`,
 * `05XXXXXXXX`, bare `5XXXXXXXX`, or `+966 05…` with the local trunk 0 kept
 * after the country code; separators and Arabic-Indic digits included — as
 * the compact international form `9665XXXXXXXX`, or null when it is not one.
 * The publish check and the settings preview both go through this helper, so
 * their rules can never disagree.
 */
export function normalizeSaudiMobile(value: string): string | null {
  const digits = foldDigits(value)
  if (digits === null) return null
  if (/^9665\d{8}$/.test(digits)) return digits
  if (/^96605\d{8}$/.test(digits)) return `966${digits.slice(4)}`
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`
  if (/^5\d{8}$/.test(digits)) return `966${digits}`
  return null
}
