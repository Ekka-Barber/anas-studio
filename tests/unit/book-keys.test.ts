// AUDIT-2 BOOK-1 and BOOK-5: the book takes no Alt, Ctrl or Meta chord (Alt+← is
// the browser's Back), and a held Home or End is one jump.
import { describe, expect, it } from 'vitest'

import { bookKey } from '../../src/components/book/keys'

const press = (key: string, extra: Partial<Parameters<typeof bookKey>[0]> = {}) =>
  bookKey({ key, repeat: false, altKey: false, ctrlKey: false, metaKey: false, ...extra })

describe('bookKey', () => {
  it('maps the four keys the book owns, ← being the next page', () => {
    expect(press('ArrowLeft')).toEqual({ action: 'next', held: false })
    expect(press('ArrowRight')).toEqual({ action: 'previous', held: false })
    expect(press('Home')).toEqual({ action: 'first', held: false })
    expect(press('End')).toEqual({ action: 'last', held: false })
    expect(press('Enter')).toBeNull()
  })

  it.each(['altKey', 'ctrlKey', 'metaKey'] as const)('leaves a %s chord to the browser', (modifier) => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(press(key, { [modifier]: true })).toBeNull()
  })

  it('marks a repeated Home or End as held, but a repeated arrow still turns', () => {
    expect(press('End', { repeat: true })).toEqual({ action: 'last', held: true })
    expect(press('Home', { repeat: true })).toEqual({ action: 'first', held: true })
    expect(press('ArrowLeft', { repeat: true })).toEqual({ action: 'next', held: false })
  })
})
