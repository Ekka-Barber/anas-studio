/**
 * Arabic-locale formatting that keeps Latin digits and the Gregorian
 * calendar. Plain `ar-SA` renders Arabic-Indic digits by default (`-u-nu-latn`
 * forces 0-9), and current Chromium defaults it to the Hijri Umm al-Qura
 * calendar (`-u-ca-gregory` pins Gregorian, which Node already uses).
 */
const LOCALE = 'ar-SA-u-ca-gregory-nu-latn'

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

/**
 * Riyadh wall-clock date and time for every admin screen. The space before
 * «م»/«ص» is made unbreakable, so a narrow table cell never leaves the period
 * on its own line.
 */
export function formatRiyadh(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(iso))
    .replace(/ (?=[مص]$)/u, ' ')
}

/** A bare year label ("2013"), always Latin digits regardless of caller locale. */
export function formatYear(year: number): string {
  return new Intl.NumberFormat(LOCALE, { useGrouping: false }).format(year)
}

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
function foldDigits(input: string): string | null {
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

/**
 * Normalizes a WhatsApp number to `https://wa.me/<digits>` (D23: an editable
 * wa.me link only), or null when it cannot be a valid number. Saudi mobiles
 * go through `normalizeSaudiMobile` (every spelling maps to
 * `9665XXXXXXXX`); any other international number is 8–15 digits that do
 * not start with 0, unchanged.
 */
export function whatsappLink(input: string): string | null {
  const saudi = normalizeSaudiMobile(input)
  if (saudi !== null) return `https://wa.me/${saudi}`
  const digits = foldDigits(input)
  if (digits === null || !/^\d{8,15}$/.test(digits) || digits.startsWith('0')) return null
  return `https://wa.me/${digits}`
}
