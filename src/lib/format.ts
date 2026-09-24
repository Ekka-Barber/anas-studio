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
