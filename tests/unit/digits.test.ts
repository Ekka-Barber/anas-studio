// CLIENT-SEC-06: the emailed sign-in code is eight digits (`otp_length`), a TOTP
// stays six, and both are read the same way from any keyboard.
import { describe, expect, it } from 'vitest'

import { otpDigits } from '../../src/lib/digits'

describe('otpDigits', () => {
  it('keeps six digits by default, for a TOTP', () => {
    expect(otpDigits('12345678')).toBe('123456')
    expect(otpDigits('٤٨٢ ٩١٣')).toBe('482913')
  })

  it('keeps eight when asked, for the sign-in code, whatever the digits and separators', () => {
    expect(otpDigits('123456789', 8)).toBe('12345678')
    expect(otpDigits('١٢٣٤-٥٦٧٨', 8)).toBe('12345678')
    expect(otpDigits('\u200f۱۲۳۴ ۵۶۷۸\u200e', 8)).toBe('12345678')
    expect(otpDigits('1234', 8)).toBe('1234')
  })
})
