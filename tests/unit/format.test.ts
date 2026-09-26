import { describe, expect, it } from 'vitest'

import { formatDate, formatNumber, formatYear, normalizeSaudiMobile, whatsappLink } from '../../src/lib/format'

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

describe('whatsappLink', () => {
  it('normalizes separators: spaces, dashes, dots, parentheses and a leading +', () => {
    expect(whatsappLink('+966 50 123 4567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('(966) 50-123.4567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink(' 966501234567 ')).toBe('https://wa.me/966501234567')
  })

  it('converts Arabic-Indic digits to ASCII', () => {
    expect(whatsappLink('٩٦٦٥٠١٢٣٤٥٦٧')).toBe('https://wa.me/966501234567')
  })

  it('converts extended Arabic-Indic digits to ASCII', () => {
    expect(whatsappLink('۹۶۶۵۰۱۲۳۴۵۶۷')).toBe('https://wa.me/966501234567')
  })

  it('a leading 00 becomes the international form', () => {
    expect(whatsappLink('00966501234567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('+00 966 50 123 4567')).toBe('https://wa.me/966501234567')
  })

  it('a Saudi local 05XXXXXXXX becomes 9665XXXXXXXX', () => {
    expect(whatsappLink('0501234567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('٠٥٠١٢٣٤٥٦٧')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('05-1234-5678')).toBe('https://wa.me/966512345678')
    expect(whatsappLink('(050) 123 4567')).toBe('https://wa.me/966501234567')
  })

  it('a bare Saudi 5XXXXXXXX becomes 9665XXXXXXXX, not a broken wa.me number', () => {
    expect(whatsappLink('501234567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('٥٠١٢٣٤٥٦٧')).toBe('https://wa.me/966501234567')
  })

  it('accepts a plain international number of 8-15 digits', () => {
    expect(whatsappLink('966501234567')).toBe('https://wa.me/966501234567')
    expect(whatsappLink('15551234567')).toBe('https://wa.me/15551234567')
  })

  it('rejects a number that still starts with 0 after normalization', () => {
    expect(whatsappLink('05123456789')).toBeNull() // 11 digits: not the local form, starts with 0
    expect(whatsappLink('0001234567890')).toBeNull() // 00 stripped, the rest still starts with 0
  })

  it('rejects too few or too many digits', () => {
    expect(whatsappLink('96650123')).toBe('https://wa.me/96650123') // 8 digits is the minimum
    expect(whatsappLink('9665012')).toBeNull() // 7 digits
    expect(whatsappLink('96650123456789012')).toBeNull() // 17 digits
  })

  it('rejects letters and any other character', () => {
    expect(whatsappLink('')).toBeNull()
    expect(whatsappLink('whatsapp')).toBeNull()
    expect(whatsappLink('966501234567x')).toBeNull()
    expect(whatsappLink('966+501234567')).toBeNull() // + only allowed at the start
    expect(whatsappLink('966٥٠١٢٣٤٥٦٧-')).toBe('https://wa.me/966501234567') // mixed digits still normalize
  })
})

describe('normalizeSaudiMobile', () => {
  it('every everyday spelling maps to the compact 9665 form', () => {
    expect(normalizeSaudiMobile('0501234567')).toBe('966501234567')
    expect(normalizeSaudiMobile('501234567')).toBe('966501234567')
    expect(normalizeSaudiMobile('966501234567')).toBe('966501234567')
    expect(normalizeSaudiMobile('+966 50 123 4567')).toBe('966501234567')
    expect(normalizeSaudiMobile('050-123-4567')).toBe('966501234567')
    expect(normalizeSaudiMobile('(050) 123 4567')).toBe('966501234567')
    expect(normalizeSaudiMobile('٠٥٠١٢٣٤٥٦٧')).toBe('966501234567')
    expect(normalizeSaudiMobile('٩٦٦٥٠١٢٣٤٥٦٧')).toBe('966501234567')
    expect(normalizeSaudiMobile('00966 50 123 4567')).toBe('966501234567')
  })

  it('anything that is not a Saudi mobile is null', () => {
    expect(normalizeSaudiMobile('')).toBeNull()
    expect(normalizeSaudiMobile('whatsapp')).toBeNull()
    expect(normalizeSaudiMobile('15551234567')).toBeNull() // a non-Saudi international number
    expect(normalizeSaudiMobile('96650123')).toBeNull() // 8 digits, not the 12-digit Saudi form
    expect(normalizeSaudiMobile('05123456789')).toBeNull() // 11 digits after the 0
    expect(normalizeSaudiMobile('9665')).toBeNull()
    expect(normalizeSaudiMobile('   ')).toBeNull()
    expect(normalizeSaudiMobile('+966 050 123 45678')).toBeNull() // trunk 0 kept, but one digit too many
  })

  it('the local trunk 0 kept after the country code is still the same mobile', () => {
    expect(normalizeSaudiMobile('+966 050 123 4567')).toBe('966501234567')
    expect(normalizeSaudiMobile('009660501234567')).toBe('966501234567')
    // Before: the gate refused it and whatsappLink built the broken wa.me/9660501234567.
    expect(whatsappLink('+9660501234567')).toBe('https://wa.me/966501234567')
  })

  it('invisible direction marks and no-break spaces from a copied number are separators', () => {
    expect(normalizeSaudiMobile('‏0501234567')).toBe('966501234567') // RLM
    expect(normalizeSaudiMobile('‎+966 50 123 4567‏')).toBe('966501234567') // LRM … RLM
    expect(normalizeSaudiMobile('050 123 4567')).toBe('966501234567') // no-break spaces
    expect(normalizeSaudiMobile('؜05٠١234567')).toBe('966501234567') // ALM, mixed digits
  })
})
