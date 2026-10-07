import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertLocalTestDatabase,
  isLocalDatabaseUrl,
  MissingEnvError,
  requireEnv,
  secretsMatch,
} from '../../src/lib/env'
import { apiKey } from '../../supabase/functions/_shared/db.ts'

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

  it('rejects a ?host= override, which pg prefers to the URL host', () => {
    expect(isLocalDatabaseUrl('postgres://u:p@127.0.0.1:5432/db?host=db.example.com')).toBe(false)
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

// FABLE-AUDIT F1-1: the Edge Functions' service client takes the key the platform now provides, the `default` entry of
// SUPABASE_SECRET_KEYS (a JSON dictionary), and falls back to the legacy SUPABASE_SERVICE_ROLE_KEY.
describe('apiKey: the service client\'s key', () => {
  const serviceKey = (): string => apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('takes the default entry of SUPABASE_SECRET_KEYS first, over the legacy key', () => {
    vi.stubEnv('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_new_key', other: 'sb_secret_other' }))
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service-role-key')
    expect(serviceKey()).toBe('sb_secret_new_key')
  })

  it('falls back to SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEYS is unset', () => {
    vi.stubEnv('SUPABASE_SECRET_KEYS', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service-role-key')
    expect(serviceKey()).toBe('legacy-service-role-key')
  })

  it.each([
    ['malformed JSON', '{default: sb_secret_x'],
    ['an empty default', JSON.stringify({ default: '' })],
    ['a default that is not a string', JSON.stringify({ default: 42 })],
    ['no default entry', JSON.stringify({ other: 'sb_secret_other' })],
    ['JSON null', 'null'],
    ['a JSON string', JSON.stringify('sb_secret_bare')],
  ])('falls back to the legacy key for %s', (_label, value) => {
    vi.stubEnv('SUPABASE_SECRET_KEYS', value)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service-role-key')
    expect(serviceKey()).toBe('legacy-service-role-key')
  })

  it('throws MissingEnvError naming the legacy key when neither gives one', () => {
    vi.stubEnv('SUPABASE_SECRET_KEYS', '{nope')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(() => serviceKey()).toThrow(MissingEnvError)
    expect(() => serviceKey()).toThrow('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('reads the publishable dictionary the same way for the caller\'s client', () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'sb_publishable_key' }))
    vi.stubEnv('SUPABASE_ANON_KEY', 'legacy-anon-key')
    expect(apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')).toBe('sb_publishable_key')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', '')
    expect(apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')).toBe('legacy-anon-key')
  })
})
