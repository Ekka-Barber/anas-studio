import { describe, expect, it } from 'vitest'

import { hasRecentTotp } from '../../supabase/functions/staff-admin/recent-totp'

const now = 1_800_000_000

describe('hasRecentTotp', () => {
  it('accepts aal2 with a TOTP entry inside the window', () => {
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now - 299 }] }, now)).toBe(true)
  })

  it('rejects a stale TOTP entry', () => {
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now - 301 }] }, now)).toBe(false)
  })

  it('rejects aal1 even with a fresh TOTP entry', () => {
    expect(hasRecentTotp({ aal: 'aal1', amr: [{ method: 'totp', timestamp: now }] }, now)).toBe(false)
  })

  it('rejects aal2 reached without TOTP', () => {
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'otp', timestamp: now }] }, now)).toBe(false)
  })

  it('rejects missing or malformed claims', () => {
    expect(hasRecentTotp({}, now)).toBe(false)
    expect(hasRecentTotp({ aal: 'aal2', amr: 'totp' }, now)).toBe(false)
    expect(hasRecentTotp({ aal: 'aal2', amr: [null, { method: 'totp', timestamp: String(now) }] }, now)).toBe(false)
  })
})
