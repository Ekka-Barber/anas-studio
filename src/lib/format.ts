/**
 * Arabic-locale formatting that keeps Latin digits and the Gregorian
 * calendar. Plain `ar-SA` renders Arabic-Indic digits by default (`-u-nu-latn`
 * forces 0-9), and current Chromium defaults it to the Hijri Umm al-Qura
 * calendar (`-u-ca-gregory` pins Gregorian, which Node already uses).
 */
import { foldDigits, normalizeSaudiMobile } from '../../supabase/functions/_shared/saudi-mobile.ts'

// P07: Saudi mobile normalization lives next to the Edge Functions, so the
// checkout server and the site share one implementation.
export { normalizeSaudiMobile } from '../../supabase/functions/_shared/saudi-mobile.ts'
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
    .replace(/ (?=[مص]$)/u, '\u00a0')
}

/** A bare year label ("2013"), always Latin digits regardless of caller locale. */
export function formatYear(year: number): string {
  return new Intl.NumberFormat(LOCALE, { useGrouping: false }).format(year)
}

/**
 * Money in integer halalas (D06): SAR, Latin digits, exactly two decimals,
 * never a float. Intl's own SAR rendering for this locale wraps the amount in
 * right-to-left marks and ends «ر.س» with a dot, so the number is formatted
 * here and « ر.س» appended.
 */
export function formatMoney(halalas: number): string {
  const sign = halalas < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(halalas))
  const riyals = Math.floor(abs / 100)
  const fraction = abs % 100
  return `${sign}${formatNumber(riyals)}.${String(fraction).padStart(2, '0')} \u0631.\u0633`
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
