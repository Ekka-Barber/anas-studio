/**
 * Arabic-locale formatting that keeps Latin digits (ar-SA-u-nu-latn).
 * Plain `ar-SA` renders Arabic-Indic digits by default; the `-u-nu-latn`
 * Unicode extension is what forces 0-9.
 */
const LOCALE = 'ar-SA-u-nu-latn'

/** Formats an integer/decimal with Arabic grouping and Latin digits. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

/** Formats a Gregorian date with Arabic month names and Latin digits. */
export function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  )
}

/** A bare year label ("2013"), always Latin digits regardless of caller locale. */
export function formatYear(year: number): string {
  return new Intl.NumberFormat(LOCALE, { useGrouping: false }).format(year)
}

/**
 * Normalizes a WhatsApp number to `https://wa.me/<digits>` (D23: an editable
 * wa.me link only), or null when it cannot be a valid number. Arabic-Indic
 * (U+0660–U+0669) and extended (U+06F0–U+06F9) digits become ASCII; spaces,
 * dashes, dots and parentheses are dropped along with one leading `+`; a
 * leading `00` becomes the international form; a Saudi local `05XXXXXXXX`
 * becomes `9665XXXXXXXX`. The result must be 8–15 digits and must not start
 * with 0.
 */
export function whatsappLink(input: string): string | null {
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
    if (char === ' ' || char === '-' || char === '.' || char === '(' || char === ')') continue
    return null
  }
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`
  if (!/^\d{8,15}$/.test(digits) || digits.startsWith('0')) return null
  return `https://wa.me/${digits}`
}
