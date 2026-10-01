// The contact form's «اطلب جلسة» prefill: which message it replaces, and when the submission key resets.
import { describe, expect, it } from 'vitest'

import { servicePrefill } from '../../src/components/public/contact/prefill'

const first = 'أرغب في جلسة استشارية: الأولى.\n'
const second = 'أرغب في جلسة استشارية: الثانية.\n'

describe('servicePrefill', () => {
  it('replaces a message still equal to the previous prefill, and resets the key for the new text', () => {
    expect(servicePrefill(first, first, second)).toEqual({ replace: true, resetKey: true })
  })

  it('fills an empty or blank message, resetting the key', () => {
    expect(servicePrefill('', '', first)).toEqual({ replace: true, resetKey: true })
    expect(servicePrefill('  \n', first, second)).toEqual({ replace: true, resetKey: true })
  })

  it('keeps both the text and the key of a message the visitor wrote', () => {
    expect(servicePrefill(`${first}وأريد موعداً قريباً`, first, second)).toEqual({ replace: false, resetKey: false })
    expect(servicePrefill('مرحباً', '', first)).toEqual({ replace: false, resetKey: false })
  })

  it('keeps the key when the same service is chosen again', () => {
    expect(servicePrefill(first, first, first)).toEqual({ replace: true, resetKey: false })
  })
})
