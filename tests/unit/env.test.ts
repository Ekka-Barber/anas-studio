import { afterEach, describe, expect, it } from 'vitest'

import {
  assertLocalTestDatabase,
  isLocalDatabaseUrl,
  MissingEnvError,
  requireEnv,
  secretsMatch,
} from '../../src/lib/env'

describe('isLocalDatabaseUrl', () => {
  it.each([
    'postgres://user:pass@localhost:5432/db',
    'postgres://user:pass@127.0.0.1:5432/db',
    'postgres://user:pass@[::1]:5432/db',
    'postgres://user:pass@host.docker.internal:5432/db',
  ])('accepts %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true)
  })

  it('accepts the postgresql: scheme too', () => {
    expect(isLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/db')).toBe(true)
  })

  it('rejects a hosted host', () => {
    expect(isLocalDatabaseUrl('postgres://user:pass@db.example.com:5432/db')).toBe(false)
  })

  it('rejects a non-postgres scheme', () => {
    expect(isLocalDatabaseUrl('https://127.0.0.1:5432/db')).toBe(false)
  })

  it('rejects an unparseable URL', () => {
    expect(isLocalDatabaseUrl('not a url')).toBe(false)
  })
})

describe('assertLocalTestDatabase', () => {
  const saved = { TEST_ENV: process.env.TEST_ENV, DATABASE_URL: process.env.DATABASE_URL }

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('throws when TEST_ENV is not exactly "local"', () => {
    delete process.env.TEST_ENV
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/db'
    expect(() => assertLocalTestDatabase()).toThrow('TEST_ENV must be exactly "local"')
  })

  it('throws when DATABASE_URL is unset', () => {
    process.env.TEST_ENV = 'local'
    delete process.env.DATABASE_URL
    expect(() => assertLocalTestDatabase()).toThrow('DATABASE_URL is not set')
  })

  it('throws when DATABASE_URL points at a hosted host', () => {
    process.env.TEST_ENV = 'local'
    process.env.DATABASE_URL = 'postgres://u:p@db.example.com:5432/db'
    expect(() => assertLocalTestDatabase()).toThrow('does not point at a local PostgreSQL host')
  })

  it('passes for a local TEST_ENV and DATABASE_URL', () => {
    process.env.TEST_ENV = 'local'
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/db'
    expect(() => assertLocalTestDatabase()).not.toThrow()
  })
})

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
})

describe('requireEnv', () => {
  const key = '__ANASAQ_TEST_ENV_VAR__'

  afterEach(() => {
    delete process.env[key]
  })

  it('returns the value when set', () => {
    process.env[key] = 'value'
    expect(requireEnv(key)).toBe('value')
  })

  it('throws MissingEnvError when unset', () => {
    delete process.env[key]
    expect(() => requireEnv(key)).toThrow(MissingEnvError)
  })

  it('throws MissingEnvError when empty', () => {
    process.env[key] = ''
    expect(() => requireEnv(key)).toThrow(MissingEnvError)
  })
})
