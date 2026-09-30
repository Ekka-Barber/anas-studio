// AUDIT-1 S11.2 re-fix: a money field that remounts while its form value is NaN
// (a coupon's hidden `percent` after the kind is toggled) must show empty text
// and the inline alert, not `NaN.NaN` with no message.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { FieldInput } from '../../src/components/admin/FieldInput'

// These siblings import through the `@/` alias, which the unit config does not resolve.
vi.mock('../../src/components/admin/MediaLibrary', () => ({}))
vi.mock('../../src/components/admin/MediaPicker', () => ({}))
vi.mock('../../src/components/admin/RichTextEditor', () => ({}))

const percent = { name: 'percent', label: 'النسبة', type: 'money', unit: 'percent' } as const

function render(value: unknown) {
  return renderToStaticMarkup(createElement(FieldInput, { field: percent, value, onChange: () => {}, id: 'f-percent' }))
}

describe('a money field mounting with an invalid (NaN) value', () => {
  it('shows empty text, aria-invalid and the role=alert message', () => {
    const html = render(Number.NaN)
    expect(html).not.toContain('NaN')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('role="alert"')
  })

  it('shows no alert for a real value', () => {
    const html = render(1250)
    expect(html).toContain('value="12.50"')
    expect(html).not.toContain('role="alert"')
  })
})
