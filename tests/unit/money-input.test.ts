// P07 round 2: the `money` field's pure conversions (D06 integer halalas,
// string arithmetic, never `* 100` on a float) and the Riyadh datetime-local
// round trip the `datetime` field uses.
import { describe, expect, it } from 'vitest'

import { formatRiyalsInput, isoToRiyadhLocal, parseRiyals, riyadhLocalToIso } from '../../src/lib/money-input'

describe('parseRiyals', () => {
  it('parses everyday riyal spellings into integer halalas', () => {
    expect(parseRiyals('69.99')).toBe(6999)
    expect(parseRiyals('0.1')).toBe(10)
    expect(parseRiyals('10')).toBe(1000)
    expect(parseRiyals('69.5')).toBe(6950)
    expect(parseRiyals('69.50')).toBe(6950)
  })

  it('folds Arabic-Indic digits and the Arabic decimal separator', () => {
    expect(parseRiyals('٦٩٫٥')).toBe(6950)
    expect(parseRiyals('٦٩.٥٠')).toBe(6950)
    expect(parseRiyals('۱۰۰')).toBe(10000)
  })

  it('refuses what cannot be a riyal amount', () => {
    expect(parseRiyals('1e3')).toBe('invalid')
    expect(parseRiyals('-5')).toBe('invalid')
    expect(parseRiyals('69.999')).toBe('invalid')
    expect(parseRiyals('abc')).toBe('invalid')
    expect(parseRiyals('1.2.3')).toBe('invalid')
    expect(parseRiyals('.')).toBe('invalid')
    expect(parseRiyals('69.5 ر.س')).toBe('invalid')
  })

  it('empty means null, not zero (D06: unconfigured is not free)', () => {
    expect(parseRiyals('')).toBeNull()
    expect(parseRiyals('   ')).toBeNull()
  })
})

describe('formatRiyalsInput', () => {
  it('shows exactly two decimals', () => {
    expect(formatRiyalsInput(6999)).toBe('69.99')
    expect(formatRiyalsInput(1000)).toBe('10.00')
    expect(formatRiyalsInput(10)).toBe('0.10')
    expect(formatRiyalsInput(6950)).toBe('69.50')
  })

  it('round-trips every parse it accepts', () => {
    for (const text of ['69', '69.5', '69.50', '0.1', '10']) {
      const halalas = parseRiyals(text)
      expect(typeof halalas).toBe('number')
      expect(parseRiyals(formatRiyalsInput(halalas as number))).toBe(halalas)
    }
  })
})

describe('the Riyadh datetime-local round trip', () => {
  it('reads a local value as UTC+3', () => {
    expect(riyadhLocalToIso('2026-03-05T10:00')).toBe('2026-03-05T07:00:00.000Z')
  })

  it('crosses midnight in both directions and comes back unchanged', () => {
    // 00:30 in Riyadh is 21:30 the previous day in UTC.
    const local = '2026-03-05T00:30'
    const iso = riyadhLocalToIso(local)
    expect(iso).toBe('2026-03-04T21:30:00.000Z')
    expect(isoToRiyadhLocal(iso)).toBe(local)

    // A timestamptz as PostgreSQL returns it, with a +00:00 offset.
    expect(isoToRiyadhLocal('2026-01-01T20:59:59+00:00')).toBe('2026-01-01T23:59')
  })
})
