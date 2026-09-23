import { describe, expect, it } from 'vitest'

import { secretsMatch } from '../../src/lib/env'
import { isAuthorizedRevalidateRequest, parseRevalidatePayload, runtimeProbeTag } from '../../src/lib/revalidate'

describe('secretsMatch', () => {
  it('matches identical strings', () => {
    expect(secretsMatch('correct-secret', 'correct-secret')).toBe(true)
  })

  it('rejects a wrong secret of the same length', () => {
    expect(secretsMatch('correct-secreX', 'correct-secret')).toBe(false)
  })

  it('rejects a wrong secret of a different length', () => {
    expect(secretsMatch('short', 'a-much-longer-secret')).toBe(false)
  })

  it('rejects an empty string against a real secret', () => {
    expect(secretsMatch('', 'a-real-secret')).toBe(false)
  })
})

describe('isAuthorizedRevalidateRequest', () => {
  const secret = 'the-real-secret'

  it('accepts an exact bearer match', () => {
    const headers = new Headers({ authorization: `Bearer ${secret}` })
    expect(isAuthorizedRevalidateRequest(headers, secret)).toBe(true)
  })

  it('rejects a wrong bearer value', () => {
    const headers = new Headers({ authorization: 'Bearer wrong' })
    expect(isAuthorizedRevalidateRequest(headers, secret)).toBe(false)
  })

  it('rejects a missing authorization header', () => {
    expect(isAuthorizedRevalidateRequest(new Headers(), secret)).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    const headers = new Headers({ authorization: `Basic ${secret}` })
    expect(isAuthorizedRevalidateRequest(headers, secret)).toBe(false)
  })
})

describe('parseRevalidatePayload', () => {
  it('accepts tags only', () => {
    expect(parseRevalidatePayload({ tags: ['runtime-probe:1'] })).toEqual({
      tags: ['runtime-probe:1'],
      paths: [],
    })
  })

  it('accepts paths only', () => {
    expect(parseRevalidatePayload({ paths: ['/probe/1'] })).toEqual({
      tags: [],
      paths: ['/probe/1'],
    })
  })

  it('accepts both', () => {
    expect(parseRevalidatePayload({ tags: ['a'], paths: ['/b'] })).toEqual({
      tags: ['a'],
      paths: ['/b'],
    })
  })

  it('rejects a body with neither tags nor paths', () => {
    expect(parseRevalidatePayload({})).toBeNull()
  })

  it('rejects null', () => {
    expect(parseRevalidatePayload(null)).toBeNull()
  })

  it('rejects a non-object body', () => {
    expect(parseRevalidatePayload('runtime-probe:1')).toBeNull()
  })

  it('rejects a non-array tags field', () => {
    expect(parseRevalidatePayload({ tags: 'runtime-probe:1' })).toBeNull()
  })

  it('rejects a tags array with a non-string element', () => {
    expect(parseRevalidatePayload({ tags: ['a', 1] })).toBeNull()
  })

  it('rejects a tags array with an empty string', () => {
    expect(parseRevalidatePayload({ tags: [''] })).toBeNull()
  })

  it('rejects empty arrays for both fields', () => {
    expect(parseRevalidatePayload({ tags: [], paths: [] })).toBeNull()
  })
})

describe('runtimeProbeTag', () => {
  it('namespaces the id', () => {
    expect(runtimeProbeTag('abc-123')).toBe('runtime-probe:abc-123')
  })
})
