import { describe, expect, it } from 'vitest'

import { formatDate, formatNumber, formatYear } from '../../src/lib/format'

describe('format', () => {
  it('formats numbers with Latin digits, never Arabic-Indic', () => {
    expect(formatNumber(2013)).toBe('2,013')
    expect(formatNumber(7)).not.toMatch(/[٠-٩۰-۹]/)
  })

  it('formats a bare year with Latin digits and no grouping', () => {
    expect(formatYear(2013)).toBe('2013')
    expect(formatYear(2020)).toBe('2020')
  })

  it('formats dates with Latin digits', () => {
    const formatted = formatDate('2026-09-23')
    expect(formatted).not.toMatch(/[٠-٩۰-۹]/)
    expect(formatted).toMatch(/2026/)
  })
})
