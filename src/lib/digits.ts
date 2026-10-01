/** A one-time code is six digits (`otp_length` in supabase/config.toml; a TOTP is six too). */
const OTP_LENGTH = 6

/**
 * A one-time code as it leaves an input on any keyboard layout: Arabic-Indic
 * (U+0660–U+0669) and extended (U+06F0–U+06F9) digits become ASCII, and every
 * other character (spaces, direction marks, the dash of a pasted «123 456»)
 * is dropped. GoTrue compares bytes, so a code typed in Arabic-Indic digits
 * would otherwise be refused as a wrong code. Unlike `foldDigits` (phone numbers), a letter is dropped, not
 * refused: the field only ever holds digits.
 */
export function otpDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) & 15))
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH)
}
