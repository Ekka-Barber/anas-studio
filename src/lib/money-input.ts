/**
 * The `money` field's pure conversions (P07 round 2, D06): riyals typed in a
 * form become integer halalas, and back, without ever multiplying a float by
 * 100 (`parseFloat('69.5') * 100` is 6949.999…). Plus the Riyadh
 * datetime-local round trip the `datetime` field needs (UTC+3 all year, no
 * DST), the same rule `PublishBar`'s schedule input follows.
 */

/**
 * `text` as riyals: `null` when empty, `'invalid'` when it cannot be a
 * amount, else the integer halalas. Accepts Arabic-Indic and extended digits
 * (the digit folding of `saudi-mobile.ts`'s `foldDigits`, but keeping the
 * decimal point, which `foldDigits` drops) and the Arabic decimal separator
 * «٫»; at most two fraction digits.
 */
export function parseRiyals(text: string): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  let folded = ''
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x30 && code <= 0x39) {
      folded += char
      continue
    }
    if ((code >= 0x0660 && code <= 0x0669) || (code >= 0x06f0 && code <= 0x06f9)) {
      folded += String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
      continue
    }
    // '.' and the Arabic decimal separator U+066B.
    if (char === '.' || char === '٫') {
      folded += '.'
      continue
    }
    return 'invalid'
  }
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(folded)
  if (!match) return 'invalid'
  // The two parts are parsed as the integers they are, so no fractional
  // float is ever multiplied.
  const whole = Number(match[1]!)
  const fraction = match[2] ? Number(match[2]!.padEnd(2, '0')) : 0
  return whole * 100 + fraction
}

/** Integer halalas as the riyals a form shows: exactly two decimals. */
export function formatRiyalsInput(halalas: number): string {
  const abs = Math.abs(Math.trunc(halalas))
  const sign = halalas < 0 ? '-' : ''
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** `<input type="datetime-local">`'s value, read as Riyadh wall-clock time. */
export function riyadhLocalToIso(localValue: string): string {
  return new Date(`${localValue}:00+03:00`).toISOString()
}

/**
 * The same, but `null` for a value that is not a date and time: browsers let
 * the year run past four digits (`20261-09-30T12:00`), which `riyadhLocalToIso`
 * throws on.
 */
export function riyadhLocalToIsoOrNull(localValue: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localValue)) return null
  const time = new Date(`${localValue}:00+03:00`).getTime()
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * An ISO timestamp as the Riyadh wall-clock `<input type="datetime-local">`
 * value. Riyadh is UTC+3 all year, so shifting the instant by three hours
 * and reading it as UTC is exact.
 */
export function isoToRiyadhLocal(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
