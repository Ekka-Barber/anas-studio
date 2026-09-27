// P07: `formatMoney`: integer halalas (D06) rendered as SAR with Latin digits
// and exactly two decimals, in integer arithmetic. Intl's own SAR output for
// ar-SA-u-nu-latn wraps the amount in right-to-left marks and ends «ر.س» with
// a dot, so the helper formats the number itself.
import { describe, expect, it } from 'vitest'

import { formatMoney } from '../../src/lib/format'

describe('formatMoney (D06: SAR, integer halalas, Latin digits)', () => {
  it.each([
    [0, '0.00 ر.س'],
    [1, '0.01 ر.س'],
    [99, '0.99 ر.س'],
    [100, '1.00 ر.س'],
    [6900, '69.00 ر.س'],
    [123456789, '1,234,567.89 ر.س'],
  ])('renders %i halalas as %s', (halalas, expected) => {
    expect(formatMoney(halalas)).toBe(expected)
  })

  it('uses Latin digits only', () => {
    for (const halalas of [0, 1, 99, 100, 6900, 123456789]) {
      expect(formatMoney(halalas)).not.toMatch(/[٠-٩۰-۹]/)
    }
    expect(formatMoney(123456789)).toMatch(/^1,234,567\.89 /)
  })
})
