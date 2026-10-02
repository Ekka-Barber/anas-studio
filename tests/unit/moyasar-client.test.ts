// P08 round 1: the Moyasar client and `paymentsConfig()`
// (supabase/functions/_shared/payments/moyasar.ts, contract sections 1, 2 and 7).
// Two halves. `paymentsConfig()` is proven rule by rule by setting and restoring
// the environment (vi.stubEnv). The client is proven against a started local
// emulator (tests/support/moyasar-emulator.ts) for the real round trips and the
// fault modes, and against stubbed fetches for the replies an emulator does not
// make: unreadable bodies, redirects, status codes only a stub can send. No test
// ever reaches the network beyond loopback.
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isUuid,
  MOYASAR_TIMEOUT_MS,
  moyasarClient,
  paymentsConfig,
  type CreateInvoiceInput,
  type MoyasarClient,
} from '../../supabase/functions/_shared/payments/moyasar.ts'
import { LOCAL_SECRET_KEY, startEmulator, type Emulator, type PaymentObject } from '../support/moyasar-emulator.ts'

const EMULATOR_KEY = 'sk_test_local_emulator_key_not_for_production'
const EMULATOR_WEBHOOK_SECRET = 'local-moyasar-webhook-secret-not-for-production'

// What `pnpm db:env` writes for the local stack.
const LOCAL_ENV: Record<string, string | undefined> = {
  SITE_URL: 'http://localhost:3000',
  MOYASAR_API_BASE_URL: 'http://host.docker.internal:54390/v1',
  MOYASAR_SECRET_KEY: EMULATOR_KEY,
  MOYASAR_WEBHOOK_SECRET: EMULATOR_WEBHOOK_SECRET,
  PAYMENTS_MODE: 'test',
  FUNCTIONS_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1',
  PAYMENTS_TEST_ACCESS_CODE: undefined,
}
// A hosted site on the sandbox keys (the supervised sandbox runs).
const HOSTED_ENV: Record<string, string | undefined> = {
  SITE_URL: 'https://anas.studio',
  MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1',
  MOYASAR_SECRET_KEY: 'sk_test_unit_test_key_value',
  MOYASAR_WEBHOOK_SECRET: 'unit-test-webhook-secret-of-at-least-32-characters',
  PAYMENTS_MODE: 'test',
  FUNCTIONS_PUBLIC_URL: 'https://abcdefghijklmnop.supabase.co/functions/v1',
  PAYMENTS_TEST_ACCESS_CODE: 'sandbox-access-code-1234',
}

/** Sets the whole payment environment, then the overrides; `undefined` unsets a variable. */
function setEnv(base: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): void {
  for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('paymentsConfig(): the ok cases', () => {
  it('the local emulator values, on a local site', () => {
    setEnv(LOCAL_ENV)
    expect(paymentsConfig()).toStrictEqual({
      ok: true,
      baseUrl: 'http://host.docker.internal:54390/v1',
      secretKey: EMULATOR_KEY,
      webhookSecret: EMULATOR_WEBHOOK_SECRET,
      mode: 'test',
      callbackBase: 'http://127.0.0.1:54321/functions/v1',
      storageBase: 'http://127.0.0.1:54321/storage/v1',
    })
  })

  it('the emulator on any local host, and with SITE_URL unset (an unset site is local)', () => {
    for (const base of ['http://localhost:54390/v1', 'http://127.0.0.1:54390/v1', 'http://[::1]:54390/v1', 'http://host.docker.internal:54390/v1']) {
      setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: base, SITE_URL: undefined })
      expect(paymentsConfig(), base).toMatchObject({ ok: true, baseUrl: base })
    }
  })

  it('a hosted site with the real base URL in test mode carries the test access code', () => {
    setEnv(HOSTED_ENV)
    expect(paymentsConfig()).toStrictEqual({
      ok: true,
      baseUrl: 'https://api.moyasar.com/v1',
      secretKey: 'sk_test_unit_test_key_value',
      webhookSecret: 'unit-test-webhook-secret-of-at-least-32-characters',
      mode: 'test',
      callbackBase: 'https://abcdefghijklmnop.supabase.co/functions/v1',
      storageBase: 'https://abcdefghijklmnop.supabase.co/storage/v1',
      testAccessCode: 'sandbox-access-code-1234',
    })
  })

  it('a hosted site in live mode needs no test code, and a leftover one is not carried', () => {
    setEnv(HOSTED_ENV, { PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_unit_test_key_value', PAYMENTS_TEST_ACCESS_CODE: undefined })
    expect(paymentsConfig()).toMatchObject({ ok: true, mode: 'live' })
    setEnv(HOSTED_ENV, { PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_unit_test_key_value' })
    expect(paymentsConfig()).not.toHaveProperty('testAccessCode')
  })

  it('a local site may use the real base through a public https tunnel', () => {
    setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1', FUNCTIONS_PUBLIC_URL: 'https://tunnel.example.dev/functions/v1' })
    expect(paymentsConfig()).toMatchObject({ ok: true, storageBase: 'https://tunnel.example.dev/storage/v1' })
  })

  it('a local emulator site may also publish its functions through a tunnel', () => {
    setEnv(LOCAL_ENV, { FUNCTIONS_PUBLIC_URL: 'https://tunnel.example.dev/functions/v1' })
    expect(paymentsConfig()).toMatchObject({ ok: true })
  })

  it('a webhook secret of exactly 32 characters passes', () => {
    setEnv(LOCAL_ENV, { MOYASAR_WEBHOOK_SECRET: 'x'.repeat(32) })
    expect(paymentsConfig()).toMatchObject({ ok: true })
  })

  it('a key of printable ASCII characters passes, and a client can be built on it', () => {
    setEnv(LOCAL_ENV, { MOYASAR_SECRET_KEY: 'sk_test_!~09AZaz_-' })
    const config = paymentsConfig()
    expect(config).toMatchObject({ ok: true })
    if (config.ok) expect(() => moyasarClient(config)).not.toThrow()
  })

  it('a test access code of exactly 16 characters passes', () => {
    setEnv(HOSTED_ENV, { PAYMENTS_TEST_ACCESS_CODE: 'x'.repeat(16) })
    expect(paymentsConfig()).toMatchObject({ ok: true })
  })
})

describe('paymentsConfig(): each reason code', () => {
  const reason = (): unknown => (paymentsConfig() as { reason?: string }).reason

  it.each([
    'MOYASAR_API_BASE_URL',
    'MOYASAR_SECRET_KEY',
    'MOYASAR_WEBHOOK_SECRET',
    'PAYMENTS_MODE',
    'FUNCTIONS_PUBLIC_URL',
  ])('NOT_CONFIGURED when %s is unset or empty (rule 1)', (name) => {
    setEnv(LOCAL_ENV, { [name]: undefined })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'NOT_CONFIGURED' })
    setEnv(LOCAL_ENV, { [name]: '' })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'NOT_CONFIGURED' })
  })

  it('NOT_CONFIGURED comes before every other rule', () => {
    setEnv(LOCAL_ENV, { PAYMENTS_MODE: 'nonsense', MOYASAR_WEBHOOK_SECRET: undefined, MOYASAR_SECRET_KEY: 'nothing' })
    expect(reason()).toBe('NOT_CONFIGURED')
  })

  it.each(['prod', 'TEST', 'Live', ' test', 'test ', 'sandbox'])('BAD_MODE for PAYMENTS_MODE=%j (rule 2)', (mode) => {
    setEnv(LOCAL_ENV, { PAYMENTS_MODE: mode })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_MODE' })
  })

  it('BAD_MODE comes before KEY_MODE_MISMATCH', () => {
    setEnv(LOCAL_ENV, { PAYMENTS_MODE: 'prod', MOYASAR_SECRET_KEY: 'sk_live_x' })
    expect(reason()).toBe('BAD_MODE')
  })

  it.each([
    ['test mode with a live key', 'test', 'sk_live_unit_test_key_value'],
    ['live mode with a test key', 'live', 'sk_test_unit_test_key_value'],
    ['a publishable key', 'test', 'pk_test_unit_test_key_value'],
    ['a key with no prefix', 'test', 'unit_test_key_value'],
    ['an upper-case prefix', 'test', 'SK_TEST_unit_test_key_value'],
    ['a key with a character beyond Latin-1', 'test', 'sk_test_unit_test_key_☃'],
    ['a key with a Latin-1 accent', 'test', 'sk_test_unit_test_key_é'],
    ['a key with a space', 'test', 'sk_test_unit test key'],
  ])('KEY_MODE_MISMATCH for %s (rule 3)', (_label, mode, key) => {
    setEnv(HOSTED_ENV, { PAYMENTS_MODE: mode, MOYASAR_SECRET_KEY: key })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'KEY_MODE_MISMATCH' })
  })

  it('KEY_MODE_MISMATCH comes before WEAK_WEBHOOK_SECRET', () => {
    setEnv(LOCAL_ENV, { MOYASAR_SECRET_KEY: 'sk_live_x', MOYASAR_WEBHOOK_SECRET: 'short' })
    expect(reason()).toBe('KEY_MODE_MISMATCH')
  })

  it.each(['short', 'x'.repeat(31)])('WEAK_WEBHOOK_SECRET for a secret of %j (rule 4)', (secret) => {
    setEnv(LOCAL_ENV, { MOYASAR_WEBHOOK_SECRET: secret })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'WEAK_WEBHOOK_SECRET' })
  })

  it('WEAK_WEBHOOK_SECRET comes before the base rules', () => {
    setEnv(LOCAL_ENV, { MOYASAR_WEBHOOK_SECRET: 'short', MOYASAR_API_BASE_URL: 'nonsense' })
    expect(reason()).toBe('WEAK_WEBHOOK_SECRET')
  })

  it.each([
    ['not a URL', 'not a url'],
    ['a trailing slash on the real base', 'https://api.moyasar.com/v1/'],
    ['a trailing slash on the emulator base', 'http://host.docker.internal:54390/v1/'],
  ])('BAD_BASE_URL for MOYASAR_API_BASE_URL with %s (rule 5)', (_label, base) => {
    setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: base })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_BASE_URL' })
  })

  it.each([
    ['not a URL', 'functions'],
    ['a trailing slash', 'http://127.0.0.1:54321/functions/v1/'],
  ])('BAD_CALLBACK_BASE for FUNCTIONS_PUBLIC_URL with %s (rule 5)', (_label, base) => {
    setEnv(LOCAL_ENV, { FUNCTIONS_PUBLIC_URL: base })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_CALLBACK_BASE' })
  })

  it('both bases bad: the API base is reported first; and both are judged before rules 6 and 7', () => {
    setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: 'x/', FUNCTIONS_PUBLIC_URL: 'y/' })
    expect(reason()).toBe('BAD_BASE_URL')
    setEnv(HOSTED_ENV, { PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_x', FUNCTIONS_PUBLIC_URL: 'nonsense' })
    expect(reason()).toBe('BAD_CALLBACK_BASE')
  })

  it('LIVE_ON_LOCAL: live mode is refused for a local site, with or without SITE_URL (rule 6)', () => {
    setEnv(LOCAL_ENV, {
      PAYMENTS_MODE: 'live',
      MOYASAR_SECRET_KEY: 'sk_live_unit_test_key_value',
      MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1',
      FUNCTIONS_PUBLIC_URL: 'https://tunnel.example.dev/functions/v1',
    })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'LIVE_ON_LOCAL' })
    vi.stubEnv('SITE_URL', undefined)
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'LIVE_ON_LOCAL' })
  })

  it.each([
    ['another host over https', 'https://sandbox.example.com/v1'],
    ['a local host over https', 'https://localhost:54390/v1'],
    ['another host over http', 'http://example.com/v1'],
    ['the real host over http', 'http://api.moyasar.com/v1'],
    ['the real host with another path', 'https://api.moyasar.com/v2'],
  ])('BAD_BASE_URL on a local site for %s (rule 6)', (_label, base) => {
    setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: base })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_BASE_URL' })
  })

  it.each([
    ['a local callback base', 'http://127.0.0.1:54321/functions/v1'],
    ['an http public callback base', 'http://tunnel.example.dev/functions/v1'],
    ['an https callback base on localhost', 'https://localhost/functions/v1'],
    ['an https callback base on host.docker.internal', 'https://host.docker.internal/functions/v1'],
  ])('BAD_CALLBACK_BASE on a local site with the real base and %s (rule 6)', (_label, callback) => {
    setEnv(LOCAL_ENV, { MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1', FUNCTIONS_PUBLIC_URL: callback })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_CALLBACK_BASE' })
  })

  it.each([
    ['the emulator', 'http://host.docker.internal:54390/v1'],
    ['a local host', 'http://127.0.0.1:54390/v1'],
    ['another host', 'https://sandbox.example.com/v1'],
    ['the real host over http', 'http://api.moyasar.com/v1'],
  ])('BAD_BASE_URL on a hosted site for %s: only the real base is ever allowed (rule 7)', (_label, base) => {
    setEnv(HOSTED_ENV, { MOYASAR_API_BASE_URL: base })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_BASE_URL' })
  })

  it.each([
    ['a local callback base', 'http://127.0.0.1:54321/functions/v1'],
    ['an http public callback base', 'http://abcdefghijklmnop.supabase.co/functions/v1'],
    ['an https callback base on localhost', 'https://localhost/functions/v1'],
    ['an https callback base on [::1]', 'https://[::1]/functions/v1'],
  ])('BAD_CALLBACK_BASE on a hosted site for %s (rule 7)', (_label, callback) => {
    setEnv(HOSTED_ENV, { FUNCTIONS_PUBLIC_URL: callback })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'BAD_CALLBACK_BASE' })
  })

  it('EMULATOR_ON_HOSTED for the emulator key or the emulator webhook secret (rule 7)', () => {
    setEnv(HOSTED_ENV, { MOYASAR_SECRET_KEY: EMULATOR_KEY })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'EMULATOR_ON_HOSTED' })
    setEnv(HOSTED_ENV, { MOYASAR_WEBHOOK_SECRET: EMULATOR_WEBHOOK_SECRET })
    expect(paymentsConfig()).toEqual({ ok: false, reason: 'EMULATOR_ON_HOSTED' })
  })

  it('TEST_CODE_REQUIRED for a hosted site in test mode with no code, or one under 16 characters (rule 7)', () => {
    for (const code of [undefined, '', 'x'.repeat(15)]) {
      setEnv(HOSTED_ENV, { PAYMENTS_TEST_ACCESS_CODE: code })
      expect(paymentsConfig(), String(code)).toEqual({ ok: false, reason: 'TEST_CODE_REQUIRED' })
    }
  })

  it('rule 7 runs in its order: base, callback base, emulator strings, then the test code', () => {
    // The emulator base wins over the emulator key.
    setEnv(HOSTED_ENV, { MOYASAR_API_BASE_URL: 'http://host.docker.internal:54390/v1', MOYASAR_SECRET_KEY: EMULATOR_KEY })
    expect(reason()).toBe('BAD_BASE_URL')
    // A local callback base wins over the emulator key.
    setEnv(HOSTED_ENV, { FUNCTIONS_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1', MOYASAR_SECRET_KEY: EMULATOR_KEY })
    expect(reason()).toBe('BAD_CALLBACK_BASE')
    // The emulator key wins over a missing test code.
    setEnv(HOSTED_ENV, { MOYASAR_SECRET_KEY: EMULATOR_KEY, PAYMENTS_TEST_ACCESS_CODE: undefined })
    expect(reason()).toBe('EMULATOR_ON_HOSTED')
  })

  it('a hosted site never reaches the emulator, even in live mode (the key and the base are judged first)', () => {
    setEnv(HOSTED_ENV, { PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_unit_test_key_value', MOYASAR_API_BASE_URL: 'http://host.docker.internal:54390/v1' })
    expect(reason()).toBe('BAD_BASE_URL')
  })
})

describe('paymentsConfig(): never throws, never logs a value', () => {
  it.each(['%%%', 'http://', 'https://[','a'.repeat(5_000), '😀', '/', '//'])('answers a refusal for the garbage value %j', (garbage) => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL', 'SITE_URL']) {
      setEnv(LOCAL_ENV, { [name]: garbage })
      const result = paymentsConfig()
      expect(typeof result.ok).toBe('boolean')
    }
  })

  it('writes nothing to the console and a refusal carries only its code', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    setEnv(LOCAL_ENV, { MOYASAR_WEBHOOK_SECRET: 'weak-secret-value' })
    const refused = paymentsConfig()
    expect(refused).toEqual({ ok: false, reason: 'WEAK_WEBHOOK_SECRET' })
    expect(JSON.stringify(refused)).not.toContain('weak-secret-value')
    setEnv(HOSTED_ENV)
    paymentsConfig()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('isUuid()', () => {
  it.each([
    [randomUUID(), true],
    [randomUUID().toUpperCase(), true],
    ['0191f3a0-7b3c-7d4e-8a9b-0c1d2e3f4a5b', true],
    ['00000000-0000-0000-0000-000000000000', true],
    ['', false],
    ['abc', false],
    ['../payments/' + randomUUID(), false],
    [randomUUID() + '/cancel', false],
    [randomUUID() + ' ', false],
    [' ' + randomUUID(), false],
    [randomUUID() + '\n', false],
    ['123e4567-e89b-12d3-a456-42661417400', false],
    ['123e4567e89b12d3a45642661417400000', false],
    ['123e4567-e89b-12d3-a456-4266141740zz', false],
    [undefined, false],
    [null, false],
    [5, false],
  ])('isUuid(%j) is %s', (value, expected) => {
    expect(isUuid(value)).toBe(expected)
  })
})

describe('the client against the local emulator', () => {
  let emulator: Emulator
  let client: MoyasarClient
  const baseUrl = (): string => `${emulator.url}/v1`
  const KEY = LOCAL_SECRET_KEY
  /** A fetch with a short timeout of its own in place of the client's: the injected small timeout. */
  const quick: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(150) })

  function invoiceInput(overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
    return {
      amount: 6900,
      currency: 'SAR',
      description: 'طلب ABCD2345',
      callback_url: 'http://127.0.0.1:54321/functions/v1/payments/callback',
      success_url: 'http://localhost:3000/checkout/return?order=ABCD2345',
      back_url: 'http://localhost:3000/checkout/return?order=ABCD2345',
      expired_at: new Date(Date.now() + 3_600_000).toISOString(),
      metadata: { order_number: 'ABCD2345', attempt_id: randomUUID() },
      ...overrides,
    }
  }

  async function control(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${emulator.url}/__emulator${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    return (await response.json()) as Record<string, unknown>
  }

  async function createdInvoice(overrides: Partial<CreateInvoiceInput> = {}): Promise<{ id: string; url: string }> {
    const result = await client.createInvoice(invoiceInput(overrides))
    if (!result.ok) throw new Error(`createInvoice failed: ${result.kind}`)
    return result.data
  }

  async function paidPayment(amount = 6900): Promise<{ invoiceId: string; paymentId: string }> {
    const invoice = await createdInvoice({ amount })
    const reply = (await control('/pay', { invoiceId: invoice.id, status: 'paid' })) as { payment: PaymentObject }
    return { invoiceId: invoice.id, paymentId: reply.payment.id }
  }

  const callCount = (): number => emulator.state().calls.length

  beforeAll(async () => {
    // No automatic delivery: an invoice's callback_url names the local stack's port.
    emulator = await startEmulator({ autoWebhook: false, autoCallback: false })
    client = moyasarClient({ baseUrl: baseUrl(), secretKey: KEY })
  })
  afterAll(async () => {
    await emulator.close()
  })
  beforeEach(() => {
    emulator.reset()
  })

  describe('createInvoice', () => {
    it('creates the invoice, 201, normalized to exactly the fields the code uses', async () => {
      const input = invoiceInput()
      const result = await client.createInvoice(input)
      expect(result).toEqual({
        ok: true,
        status: 201,
        data: {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          status: 'initiated',
          amount: 6900,
          currency: 'SAR',
          url: expect.stringMatching(new RegExp(`^${emulator.url}/invoices/`)),
          expiredAt: input.expired_at,
          metadata: input.metadata,
          payments: [],
        },
      })
    })

    it('always sends JSON with the eight documented fields, and only those', async () => {
      const input = invoiceInput()
      await client.createInvoice({ ...input, extra: 'must not travel' } as unknown as CreateInvoiceInput)
      const [recorded] = emulator.state().calls
      expect(recorded).toMatchObject({ method: 'POST', route: 'POST /v1/invoices', status: 201 })
      expect(recorded?.body).toEqual({
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        callback_url: input.callback_url,
        success_url: input.success_url,
        back_url: input.back_url,
        expired_at: input.expired_at,
        metadata: input.metadata,
      })
      expect(new Date(input.expired_at).toISOString()).toBe(input.expired_at)
    })

    it('a 400 from the provider is refused with its status', async () => {
      expect(await client.createInvoice(invoiceInput({ amount: 99 }))).toEqual({ ok: false, kind: 'refused', status: 400 })
      expect(emulator.state().invoices).toHaveLength(0)
    })

    it('the wrong key is refused with 401', async () => {
      const wrong = moyasarClient({ baseUrl: baseUrl(), secretKey: 'sk_test_not_the_key' })
      expect(await wrong.createInvoice(invoiceInput())).toEqual({ ok: false, kind: 'refused', status: 401 })
      expect(await wrong.fetchInvoice(randomUUID())).toEqual({ ok: false, kind: 'refused', status: 401 })
    })
  })

  describe('fetchInvoice', () => {
    it('returns the invoice with its payments normalized', async () => {
      const { invoiceId, paymentId } = await paidPayment()
      const result = await client.fetchInvoice(invoiceId)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({ id: invoiceId, status: 'paid', amount: 6900, currency: 'SAR' })
      // Only what says which payments to fetch; the money facts come from fetchPayment.
      expect(result.data.payments).toEqual([{ id: paymentId, status: 'paid' }])
    })

    it('an unknown invoice is not_found with 404', async () => {
      expect(await client.fetchInvoice(randomUUID())).toEqual({ ok: false, kind: 'not_found', status: 404 })
    })

    it('an id that is not a UUID is refused without any call', async () => {
      for (const id of ['nope', '../payments', `${randomUUID()}/cancel`, '', ' ']) {
        expect(await client.fetchInvoice(id)).toEqual({ ok: false, kind: 'refused' })
      }
      expect(callCount()).toBe(0)
    })
  })

  describe('listInvoices', () => {
    it('lists the invoices matching metadata[attempt_id]', async () => {
      const attempt = randomUUID()
      const mine = await createdInvoice({ metadata: { attempt_id: attempt, order_number: 'AAAA2222' } })
      await createdInvoice()
      const result = await client.listInvoices({ metadata: { attempt_id: attempt } })
      expect(result).toMatchObject({ ok: true, status: 200, data: { nextPage: null } })
      if (!result.ok) return
      expect(result.data.invoices.map((invoice) => invoice.id)).toEqual([mine.id])
      expect(result.data.invoices[0]?.metadata).toEqual({ attempt_id: attempt, order_number: 'AAAA2222' })
      expect(emulator.state().calls.at(-1)).toMatchObject({ route: 'GET /v1/invoices', query: { 'metadata[attempt_id]': attempt } })
    })

    it('an empty list is a good answer', async () => {
      expect(await client.listInvoices({ metadata: { attempt_id: randomUUID() } })).toEqual({ ok: true, status: 200, data: { invoices: [], nextPage: null } })
    })

    it('asks for the page it is given and reports the next one', async () => {
      for (let index = 0; index < 41; index += 1) await createdInvoice()
      const first = await client.listInvoices({ metadata: {} })
      expect(first.ok && first.data.invoices.length).toBe(40)
      expect(first.ok && first.data.nextPage).toBe(2)
      const second = await client.listInvoices({ metadata: {}, page: 2 })
      expect(second.ok && second.data.invoices.length).toBe(1)
      expect(second.ok && second.data.nextPage).toBe(null)
      expect(emulator.state().calls.at(-1)?.query).toEqual({ page: '2' })
    })

    it('does not trust the filter: a list that ignores it comes back whole, each invoice carrying its own metadata', async () => {
      emulator.config({ ignoreMetadataFilter: true })
      const attempt = randomUUID()
      await createdInvoice({ metadata: { attempt_id: attempt } })
      await createdInvoice()
      await createdInvoice()
      const result = await client.listInvoices({ metadata: { attempt_id: attempt } })
      expect(result.ok && result.data.invoices.length).toBe(3)
      expect(result.ok && result.data.invoices.filter((invoice) => invoice.metadata.attempt_id === attempt).length).toBe(1)
    })

    it('an invoice created while the emulator drops metadata has none to match on', async () => {
      emulator.config({ dropInvoiceMetadata: true })
      const attempt = randomUUID()
      const created = await client.createInvoice(invoiceInput({ metadata: { attempt_id: attempt } }))
      expect(created.ok && created.data.metadata).toEqual({})
      const listed = await client.listInvoices({ metadata: { attempt_id: attempt } })
      expect(listed.ok && listed.data.invoices).toEqual([])
    })
  })

  describe('cancelInvoice', () => {
    it('cancels an initiated invoice, and again', async () => {
      const invoice = await createdInvoice()
      expect(await client.cancelInvoice(invoice.id)).toMatchObject({ ok: true, status: 200, data: { id: invoice.id, status: 'canceled' } })
      expect(await client.cancelInvoice(invoice.id)).toMatchObject({ ok: true, data: { status: 'canceled' } })
    })

    it('a paid invoice is refused with 400 by default, and comes back paid when the provider answers 200', async () => {
      const { invoiceId } = await paidPayment()
      expect(await client.cancelInvoice(invoiceId)).toEqual({ ok: false, kind: 'refused', status: 400 })
      emulator.config({ cancelPaidReturns200: true })
      expect(await client.cancelInvoice(invoiceId)).toMatchObject({ ok: true, data: { id: invoiceId, status: 'paid' } })
    })

    it('an expired invoice is refused', async () => {
      const invoice = await createdInvoice({ expired_at: new Date(Date.now() - 60_000).toISOString() })
      expect(await client.cancelInvoice(invoice.id)).toEqual({ ok: false, kind: 'refused', status: 400 })
    })

    it('an unknown invoice is not_found; an id that is not a UUID is refused without any call', async () => {
      expect(await client.cancelInvoice(randomUUID())).toEqual({ ok: false, kind: 'not_found', status: 404 })
      const before = callCount()
      expect(await client.cancelInvoice('nope')).toEqual({ ok: false, kind: 'refused' })
      expect(callCount()).toBe(before)
    })
  })

  describe('fetchPayment', () => {
    it('returns the payment normalized, with the running refunded total', async () => {
      const { invoiceId, paymentId } = await paidPayment(6900)
      await client.refundPayment(paymentId, 1000)
      const result = await client.fetchPayment(paymentId)
      expect(result).toEqual({
        ok: true,
        status: 200,
        data: {
          id: paymentId,
          status: 'refunded',
          amount: 6900,
          currency: 'SAR',
          fee: 0,
          refunded: 1000,
          invoiceId,
          createdAt: expect.any(String),
          sourceType: 'creditcard',
          sourceCompany: 'mada',
        },
      })
    })

    it('an unknown payment is not_found; an id that is not a UUID is refused without any call', async () => {
      expect(await client.fetchPayment(randomUUID())).toEqual({ ok: false, kind: 'not_found', status: 404 })
      const before = callCount()
      expect(await client.fetchPayment('nope')).toEqual({ ok: false, kind: 'refused' })
      expect(callCount()).toBe(before)
    })
  })

  describe('refundPayment', () => {
    it('refunds, sending {"amount": n} as JSON, and returns the payment with the new total', async () => {
      const { paymentId } = await paidPayment(6900)
      const result = await client.refundPayment(paymentId, 1000)
      expect(result).toMatchObject({ ok: true, status: 200, data: { id: paymentId, status: 'refunded', refunded: 1000, amount: 6900 } })
      expect(emulator.state().calls.at(-1)).toMatchObject({ method: 'POST', route: 'POST /v1/payments/:id/refund', body: { amount: 1000 }, status: 200 })
      expect(await client.refundPayment(paymentId, 500)).toMatchObject({ ok: true, data: { refunded: 1500 } })
    })

    it('more than what is left is refused with 400 and changes nothing', async () => {
      const { paymentId } = await paidPayment(6900)
      expect(await client.refundPayment(paymentId, 6901)).toEqual({ ok: false, kind: 'refused', status: 400 })
      const payment = await client.fetchPayment(paymentId)
      expect(payment.ok && payment.data.refunded).toBe(0)
    })

    it('a second refund the provider refuses (refuseSecondRefund) is refused', async () => {
      emulator.config({ refuseSecondRefund: true })
      const { paymentId } = await paidPayment(6900)
      expect((await client.refundPayment(paymentId, 1000)).ok).toBe(true)
      expect(await client.refundPayment(paymentId, 500)).toEqual({ ok: false, kind: 'refused', status: 400 })
    })

    it('an unknown payment is not_found', async () => {
      expect(await client.refundPayment(randomUUID(), 100)).toEqual({ ok: false, kind: 'not_found', status: 404 })
    })

    it('an id that is not a UUID, and an amount that is not a positive integer, never reach the provider', async () => {
      const { paymentId } = await paidPayment(6900)
      const before = callCount()
      expect(await client.refundPayment('nope', 100)).toEqual({ ok: false, kind: 'refused' })
      // A missing or null amount would be a full refund; none of these may leave the process.
      for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, undefined, null, '100']) {
        expect(await client.refundPayment(paymentId, amount as unknown as number), String(amount)).toEqual({ ok: false, kind: 'refused' })
      }
      expect(callCount()).toBe(before)
      const payment = await client.fetchPayment(paymentId)
      expect(payment.ok && payment.data.refunded).toBe(0)
    })
  })

  describe('classification by the HTTP status alone', () => {
    it.each([
      ['fetchInvoice', 'GET /v1/invoices/:id', (c: MoyasarClient) => c.fetchInvoice(randomUUID())],
      ['listInvoices', 'GET /v1/invoices', (c: MoyasarClient) => c.listInvoices({ metadata: { attempt_id: 'a' } })],
      ['fetchPayment', 'GET /v1/payments/:id', (c: MoyasarClient) => c.fetchPayment(randomUUID())],
    ])('a read (%s): 429 is rate_limited, 500 is unavailable', async (_name, route, run) => {
      await control('/fault', { route, mode: '429' })
      expect(await run(client)).toEqual({ ok: false, kind: 'rate_limited', status: 429 })
      await control('/fault', { route, mode: '500' })
      expect(await run(client)).toEqual({ ok: false, kind: 'unavailable', status: 500 })
    })

    it.each([
      ['createInvoice', 'POST /v1/invoices', (c: MoyasarClient) => c.createInvoice(invoiceInput())],
      ['cancelInvoice', 'PUT /v1/invoices/:id/cancel', (c: MoyasarClient) => c.cancelInvoice(randomUUID())],
      ['refundPayment', 'POST /v1/payments/:id/refund', (c: MoyasarClient) => c.refundPayment(randomUUID(), 100)],
    ])('a write (%s): 429 is rate_limited (nothing happened), 500 is uncertain (it may have)', async (_name, route, run) => {
      await control('/fault', { route, mode: '429' })
      expect(await run(client)).toEqual({ ok: false, kind: 'rate_limited', status: 429 })
      await control('/fault', { route, mode: '500' })
      expect(await run(client)).toEqual({ ok: false, kind: 'uncertain', status: 500 })
      expect(emulator.state().invoices).toHaveLength(0)
    })

    it('a timeout is unavailable for a read and uncertain for a write, and the write is not made', async () => {
      const slow = moyasarClient({ baseUrl: baseUrl(), secretKey: KEY }, quick)
      const invoice = await createdInvoice()
      await control('/fault', { route: 'GET /v1/invoices/:id', mode: 'timeout' })
      expect(await slow.fetchInvoice(invoice.id)).toEqual({ ok: false, kind: 'unavailable' })
      await control('/fault', { route: 'POST /v1/invoices', mode: 'timeout' })
      expect(await slow.createInvoice(invoiceInput())).toEqual({ ok: false, kind: 'uncertain' })
      expect(emulator.state().invoices).toHaveLength(1)
      await control('/fault', { route: 'POST /v1/payments/:id/refund', mode: 'timeout' })
      const { paymentId } = await paidPayment()
      expect(await slow.refundPayment(paymentId, 100)).toEqual({ ok: false, kind: 'uncertain' })
      const payment = await client.fetchPayment(paymentId)
      expect(payment.ok && payment.data.refunded).toBe(0)
    })

    it('a connection cut after the provider committed is uncertain, and the change is there', async () => {
      await control('/fault', { route: 'POST /v1/invoices', mode: 'drop_after_commit' })
      expect(await client.createInvoice(invoiceInput())).toEqual({ ok: false, kind: 'uncertain' })
      expect(emulator.state().invoices).toHaveLength(1)
      const { paymentId } = await paidPayment()
      await control('/fault', { route: 'POST /v1/payments/:id/refund', mode: 'drop_after_commit' })
      expect(await client.refundPayment(paymentId, 2000)).toEqual({ ok: false, kind: 'uncertain' })
      const payment = await client.fetchPayment(paymentId)
      expect(payment.ok && payment.data.refunded).toBe(2000)
    })

    it('a refund that lands after the client gave up is uncertain first and visible later', async () => {
      const { paymentId } = await paidPayment(6900)
      // A second is far above any scheduling delay, so "not applied yet" cannot fail on a loaded machine.
      await control('/fault', { route: 'POST /v1/payments/:id/refund', mode: 'commit_after_delay', delayMs: 1_000 })
      expect(await client.refundPayment(paymentId, 3000)).toEqual({ ok: false, kind: 'uncertain' })
      const early = await client.fetchPayment(paymentId)
      expect(early.ok && early.data.refunded).toBe(0)
      await vi.waitFor(async () => {
        const late = await client.fetchPayment(paymentId)
        expect(late.ok && late.data.refunded).toBe(3000)
      }, { timeout: 3_000 })
    })

    it('a provider that cannot be reached at all is unavailable for a read and uncertain for a write', async () => {
      const gone = await startEmulator()
      const url = `${gone.url}/v1`
      await gone.close()
      const lonely = moyasarClient({ baseUrl: url, secretKey: KEY })
      expect(await lonely.fetchInvoice(randomUUID())).toEqual({ ok: false, kind: 'unavailable' })
      expect(await lonely.fetchPayment(randomUUID())).toEqual({ ok: false, kind: 'unavailable' })
      expect(await lonely.createInvoice(invoiceInput())).toEqual({ ok: false, kind: 'uncertain' })
      expect(await lonely.refundPayment(randomUUID(), 100)).toEqual({ ok: false, kind: 'uncertain' })
      expect(await lonely.cancelInvoice(randomUUID())).toEqual({ ok: false, kind: 'uncertain' })
    })
  })
})

describe('the client against stubbed replies', () => {
  const KEY = 'sk_test_unit_stub_key'
  const BASE = 'http://stub.test/v1'
  const ID = randomUUID()

  const PAYMENT = {
    id: ID,
    status: 'paid',
    amount: 6900,
    currency: 'SAR',
    fee: 150,
    refunded: 0,
    invoice_id: randomUUID(),
    created_at: '2026-10-02T10:00:00.000Z',
    source: { type: 'creditcard', company: 'visa', number: '411111XXXXXX1111', message: 'APPROVED' },
    description: 'dropped',
    ip: '1.2.3.4',
  }
  const INVOICE = {
    id: ID,
    status: 'initiated',
    amount: 6900,
    currency: 'SAR',
    url: 'https://pay.example.test/invoices/x',
    expired_at: '2026-10-02T12:00:00.000Z',
    metadata: { attempt_id: 'a', order_number: 'ABCD2345' },
    payments: [PAYMENT],
    description: 'dropped',
    logo_url: null,
  }

  /** A client whose every call is answered by `reply`; `seen` lists what it was asked. */
  function stubbed(reply: () => Response | Promise<Response> | never): { client: MoyasarClient; seen: Array<{ url: string; init: RequestInit }> } {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} })
      return reply()
    }
    return { client: moyasarClient({ baseUrl: BASE, secretKey: KEY }, fetchImpl), seen }
  }
  const json = (body: unknown, status = 200): Response => Response.json(body, { status })
  const NEW_INVOICE: CreateInvoiceInput = {
    amount: 6900,
    currency: 'SAR',
    description: 'd',
    callback_url: 'http://localhost/cb',
    success_url: 'http://localhost/ok',
    back_url: 'http://localhost/ok',
    expired_at: '2026-10-02T12:00:00.000Z',
    metadata: {},
  }

  /** Every call of the client, as a read or a write. */
  type Call = [string, (c: MoyasarClient) => Promise<unknown>]
  const READS: Call[] = [
    ['fetchInvoice', (c) => c.fetchInvoice(ID)],
    ['listInvoices', (c) => c.listInvoices({ metadata: { attempt_id: 'a' } })],
    ['fetchPayment', (c) => c.fetchPayment(ID)],
  ]
  const WRITES: Call[] = [
    ['createInvoice', (c) => c.createInvoice(NEW_INVOICE)],
    ['cancelInvoice', (c) => c.cancelInvoice(ID)],
    ['refundPayment', (c) => c.refundPayment(ID, 100)],
  ]

  describe('what goes out', () => {
    it('sends Basic auth with the key as user name and an empty password, and no content type on a bodiless call', async () => {
      const { client, seen } = stubbed(() => json(INVOICE))
      await client.fetchInvoice(ID)
      await client.cancelInvoice(ID)
      const expected = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`
      for (const { init } of seen) {
        const headers = init.headers as Record<string, string>
        expect(headers.authorization).toBe(expected)
        expect(headers['content-type']).toBeUndefined()
        expect(init.body).toBeUndefined()
      }
      expect(seen.map(({ url, init }) => [init.method, url])).toEqual([
        ['GET', `${BASE}/invoices/${ID}`],
        ['PUT', `${BASE}/invoices/${ID}/cancel`],
      ])
    })

    it('createInvoice and refundPayment send JSON bodies', async () => {
      const { client, seen } = stubbed(() => json(PAYMENT))
      await client.refundPayment(ID, 1234)
      const refund = seen[0]!
      expect(refund.init.method).toBe('POST')
      expect(refund.url).toBe(`${BASE}/payments/${ID}/refund`)
      expect((refund.init.headers as Record<string, string>)['content-type']).toBe('application/json')
      expect(refund.init.body).toBe('{"amount":1234}')

      const input = { amount: 6900, currency: 'SAR', description: 'طلب', callback_url: 'http://localhost/cb', success_url: 'http://localhost/ok', back_url: 'http://localhost/ok', expired_at: '2026-10-02T12:00:00.000Z', metadata: { order_number: 'ABCD2345', attempt_id: ID } }
      const created = stubbed(() => json(INVOICE, 201))
      await created.client.createInvoice(input)
      expect(created.seen[0]?.url).toBe(`${BASE}/invoices`)
      expect(created.seen[0]?.init.method).toBe('POST')
      expect((created.seen[0]?.init.headers as Record<string, string>)['content-type']).toBe('application/json')
      expect(JSON.parse(created.seen[0]?.init.body as string)).toEqual(input)
    })

    it('listInvoices puts metadata[key] and page in the query', async () => {
      const { client, seen } = stubbed(() => json({ invoices: [], meta: { next_page: null } }))
      await client.listInvoices({ metadata: { attempt_id: ID }, page: 2 })
      await client.listInvoices({ metadata: {} })
      const first = new URL(seen[0]!.url)
      expect(first.pathname).toBe('/v1/invoices')
      expect(Object.fromEntries(first.searchParams)).toEqual({ page: '2', 'metadata[attempt_id]': ID })
      expect(seen[1]?.url).toBe(`${BASE}/invoices`)
    })

    it('every call carries the one timeout, never follows a redirect, and an id never reaches the path unchecked', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout')
      const { client, seen } = stubbed(() => json(INVOICE))
      for (const [, run] of [...READS, ...WRITES]) await run(client)
      expect(MOYASAR_TIMEOUT_MS).toBe(10_000)
      expect(timeout).toHaveBeenCalledTimes(READS.length + WRITES.length)
      for (const call of timeout.mock.calls) expect(call).toEqual([MOYASAR_TIMEOUT_MS])
      for (const { init } of seen) {
        expect(init.redirect).toBe('manual')
        expect(init.signal).toBeInstanceOf(AbortSignal)
      }
      const injected = stubbed(() => json(INVOICE))
      for (const id of ['../x', 'a/b', `${ID}?x=1`, `${ID}#`]) {
        await injected.client.fetchInvoice(id)
        await injected.client.cancelInvoice(id)
        await injected.client.fetchPayment(id)
        await injected.client.refundPayment(id, 100)
      }
      expect(injected.seen).toEqual([])
    })

    it('a PaymentsConfig that came out of paymentsConfig() is accepted as it is', async () => {
      setEnv(LOCAL_ENV)
      const config = paymentsConfig()
      if (!config.ok) throw new Error('the local config must be ok')
      const fetchImpl: typeof fetch = async () => json(INVOICE)
      expect(await moyasarClient(config, fetchImpl).fetchInvoice(ID)).toMatchObject({ ok: true })
    })
  })

  describe('classification', () => {
    it.each(READS)('%s: 404 is not_found, 429 is rate_limited, other 4xx are refused, 5xx is unavailable', async (_name, run) => {
      for (const [status, kind] of [
        [404, 'not_found'],
        [429, 'rate_limited'],
        [400, 'refused'],
        [401, 'refused'],
        [403, 'refused'],
        [405, 'refused'],
        [422, 'refused'],
        [500, 'unavailable'],
        [502, 'unavailable'],
        [503, 'unavailable'],
      ] as const) {
        const { client } = stubbed(() => json({ type: 'api_error', message: 'x', errors: null }, status))
        expect(await run(client), String(status)).toEqual({ ok: false, kind, status })
      }
    })

    it.each(WRITES)('%s: 404 is not_found, 429 is rate_limited, other 4xx are refused, 5xx is uncertain', async (_name, run) => {
      for (const [status, kind] of [
        [404, 'not_found'],
        [429, 'rate_limited'],
        [400, 'refused'],
        [401, 'refused'],
        [403, 'refused'],
        [405, 'refused'],
        [500, 'uncertain'],
        [503, 'uncertain'],
      ] as const) {
        const { client } = stubbed(() => json({ type: 'api_error', message: 'x', errors: null }, status))
        expect(await run(client), String(status)).toEqual({ ok: false, kind, status })
      }
    })

    it('the error type string never decides: only the status does', async () => {
      const cases: Array<[number, string, string]> = [
        [400, 'rate_limit_error', 'refused'],
        [429, 'invalid_request_error', 'rate_limited'],
        [404, 'authentication_error', 'not_found'],
        [500, 'invalid_request_error', 'unavailable'],
        [401, 'record_not_found', 'refused'],
      ]
      for (const [status, type, kind] of cases) {
        const { client } = stubbed(() => json({ type, message: 'x', errors: null }, status))
        expect(await client.fetchInvoice(ID), `${status} ${type}`).toMatchObject({ ok: false, kind, status })
      }
    })

    it('an error body that is not JSON, or empty, changes nothing', async () => {
      for (const [body, status, kind] of [
        ['<html>bad gateway</html>', 502, 'unavailable'],
        ['', 400, 'refused'],
        ['not json', 404, 'not_found'],
      ] as const) {
        const { client } = stubbed(() => new Response(body, { status }))
        expect(await client.fetchPayment(ID)).toEqual({ ok: false, kind, status })
      }
    })

    it.each([
      ['a body that is not JSON', () => new Response('<html>ok</html>', { status: 200 })],
      ['an empty 204', () => new Response(null, { status: 204 })],
      ['JSON of the wrong shape', () => json({ message: 'hello' })],
      ['a JSON list', () => json([INVOICE])],
      ['JSON null', () => json(null)],
    ])('%s on a 2xx is unreadable: unavailable for a read, uncertain for a write', async (_label, reply) => {
      for (const [, run] of READS) {
        const result = await run(stubbed(reply).client)
        expect(result).toMatchObject({ ok: false, kind: 'unavailable' })
      }
      for (const [, run] of WRITES) {
        const result = await run(stubbed(reply).client)
        expect(result).toMatchObject({ ok: false, kind: 'uncertain' })
      }
    })

    it('a redirect is an unusable reply, not something to follow', async () => {
      const redirect = (): Response => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
      expect(await stubbed(redirect).client.fetchInvoice(ID)).toEqual({ ok: false, kind: 'unavailable', status: 302 })
      expect(await stubbed(redirect).client.refundPayment(ID, 100)).toEqual({ ok: false, kind: 'uncertain', status: 302 })
    })

    it('a network error is unavailable for a read and uncertain for a write, with no status', async () => {
      const broken = (): never => {
        throw new TypeError('fetch failed')
      }
      for (const [, run] of READS) expect(await run(stubbed(broken).client)).toEqual({ ok: false, kind: 'unavailable' })
      for (const [, run] of WRITES) expect(await run(stubbed(broken).client)).toEqual({ ok: false, kind: 'uncertain' })
    })

    it('a body that stalls until the timeout fires is unreadable too', async () => {
      // A real body stream errors when the request's signal aborts; an already-aborted signal stands in for the elapsed timeout.
      const stalling: typeof fetch = async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              if (init?.signal?.aborted) controller.error(init.signal.reason)
            },
          }),
          { status: 200 },
        )
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort())
      const client = moyasarClient({ baseUrl: BASE, secretKey: KEY }, stalling)
      expect(await client.fetchInvoice(ID)).toEqual({ ok: false, kind: 'unavailable', status: 200 })
      expect(await client.refundPayment(ID, 100)).toEqual({ ok: false, kind: 'uncertain', status: 200 })
    })
  })

  describe('parsing', () => {
    it('keeps what the code uses, drops what it does not, and reads a full payment and invoice', async () => {
      const payment = await stubbed(() => json(PAYMENT)).client.fetchPayment(ID)
      expect(payment).toStrictEqual({
        ok: true,
        status: 200,
        data: {
          id: ID,
          status: 'paid',
          amount: 6900,
          currency: 'SAR',
          fee: 150,
          refunded: 0,
          invoiceId: PAYMENT.invoice_id,
          createdAt: '2026-10-02T10:00:00.000Z',
          sourceType: 'creditcard',
          sourceCompany: 'visa',
        },
      })
      const invoice = await stubbed(() => json(INVOICE)).client.fetchInvoice(ID)
      expect(invoice).toStrictEqual({
        ok: true,
        status: 200,
        data: {
          id: ID,
          status: 'initiated',
          amount: 6900,
          currency: 'SAR',
          url: 'https://pay.example.test/invoices/x',
          expiredAt: '2026-10-02T12:00:00.000Z',
          metadata: { attempt_id: 'a', order_number: 'ABCD2345' },
          payments: [{ id: PAYMENT.id, status: PAYMENT.status }],
        },
      })
    })

    it.each([
      ['absent', undefined],
      ['null', null],
    ])('tolerates an invoice with expired_at, metadata and payments %s', async (_label, missing) => {
      const { id, status, amount, currency, url } = INVOICE
      const bare = { id, status, amount, currency, url, expired_at: missing, metadata: missing, payments: missing }
      const result = await stubbed(() => json(bare)).client.fetchInvoice(ID)
      expect(result).toStrictEqual({
        ok: true,
        status: 200,
        data: { id, status, amount, currency, url, expiredAt: null, metadata: {}, payments: [] },
      })
    })

    it.each([
      ['absent', undefined],
      ['null', null],
    ])('tolerates a payment with source, invoice_id and created_at %s', async (_label, missing) => {
      const bare = { id: ID, status: 'initiated', amount: 100, currency: 'SAR', fee: 0, refunded: 0, source: missing, invoice_id: missing, created_at: missing }
      const result = await stubbed(() => json(bare)).client.fetchPayment(ID)
      expect(result).toStrictEqual({
        ok: true,
        status: 200,
        data: { id: ID, status: 'initiated', amount: 100, currency: 'SAR', fee: 0, refunded: 0, invoiceId: null, createdAt: null, sourceType: null, sourceCompany: null },
      })
    })

    it('a source with no type or company reads as null for each', async () => {
      const result = await stubbed(() => json({ ...PAYMENT, source: { number: 'x' } })).client.fetchPayment(ID)
      expect(result).toMatchObject({ ok: true, data: { sourceType: null, sourceCompany: null } })
    })

    it('rounds a fractional fee, which is only an estimate, instead of refusing the payment', async () => {
      const result = await stubbed(() => json({ ...PAYMENT, fee: 103.5 })).client.fetchPayment(ID)
      expect(result).toMatchObject({ ok: true, data: { fee: 104 } })
    })

    it.each([undefined, null])('reads a fee of %s as 0', async (fee) => {
      const result = await stubbed(() => json({ ...PAYMENT, fee })).client.fetchPayment(ID)
      expect(result).toMatchObject({ ok: true, data: { fee: 0 } })
    })

    it('a sibling payment with fields missing does not make its invoice unreadable', async () => {
      const sibling = { id: randomUUID(), status: 'failed' }
      const result = await stubbed(() => json({ ...INVOICE, payments: [PAYMENT, sibling] })).client.fetchInvoice(ID)
      expect(result).toMatchObject({ ok: true, data: { payments: [{ id: PAYMENT.id, status: PAYMENT.status }, sibling] } })
    })

    it('keeps only the string values of metadata', async () => {
      const mixed = { ...INVOICE, metadata: { attempt_id: 'a', count: 3, flag: true, nested: { a: 1 }, none: null } }
      const result = await stubbed(() => json(mixed)).client.fetchInvoice(ID)
      expect(result).toMatchObject({ ok: true, data: { metadata: { attempt_id: 'a' } } })
    })

    it.each([
      ['no id', { ...PAYMENT, id: undefined }],
      ['no status', { ...PAYMENT, status: undefined }],
      ['no amount', { ...PAYMENT, amount: undefined }],
      ['an amount that is a string', { ...PAYMENT, amount: '6900' }],
      ['a fractional amount', { ...PAYMENT, amount: 69.5 }],
      ['no currency', { ...PAYMENT, currency: undefined }],
      ['no refunded total', { ...PAYMENT, refunded: undefined }],
      ['a refunded total of null', { ...PAYMENT, refunded: null }],
      ['a fractional refunded total', { ...PAYMENT, refunded: 0.5 }],
    ])('a payment with %s is unreadable', async (_label, body) => {
      expect(await stubbed(() => json(body)).client.fetchPayment(ID)).toEqual({ ok: false, kind: 'unavailable', status: 200 })
      expect(await stubbed(() => json(body)).client.refundPayment(ID, 100)).toEqual({ ok: false, kind: 'uncertain', status: 200 })
    })

    it.each([
      ['no id', { ...INVOICE, id: undefined }],
      ['no url', { ...INVOICE, url: undefined }],
      ['a url that is not http(s)', { ...INVOICE, url: 'javascript:alert(1)' }],
      ['a relative url', { ...INVOICE, url: '/invoices/x' }],
      ['an empty url', { ...INVOICE, url: '' }],
      ['an amount that is a string', { ...INVOICE, amount: '6900' }],
      ['a fractional amount', { ...INVOICE, amount: 69.5 }],
      ['a metadata that is a list', { ...INVOICE, metadata: ['a'] }],
      ['a payments that is not a list', { ...INVOICE, payments: 'none' }],
      ['one nested payment with no id', { ...INVOICE, payments: [PAYMENT, { ...PAYMENT, id: undefined }] }],
    ])('an invoice with %s is unreadable', async (_label, body) => {
      expect(await stubbed(() => json(body)).client.fetchInvoice(ID)).toEqual({ ok: false, kind: 'unavailable', status: 200 })
      expect(await stubbed(() => json(body, 201)).client.createInvoice(NEW_INVOICE)).toEqual({
        ok: false,
        kind: 'uncertain',
        status: 201,
      })
    })

    it('reads a list reply, with and without meta, and refuses one with no invoices list', async () => {
      const withMeta = await stubbed(() => json({ invoices: [INVOICE], meta: { current_page: 1, next_page: 2, prev_page: null, total_pages: 3, total_count: 90 } })).client.listInvoices({ metadata: {} })
      expect(withMeta.ok && withMeta.data.nextPage).toBe(2)
      expect(withMeta.ok && withMeta.data.invoices).toHaveLength(1)
      const withoutMeta = await stubbed(() => json({ invoices: [INVOICE] })).client.listInvoices({ metadata: {} })
      expect(withoutMeta.ok && withoutMeta.data.nextPage).toBe(null)
      const nullMeta = await stubbed(() => json({ invoices: [], meta: { next_page: null } })).client.listInvoices({ metadata: {} })
      expect(nullMeta).toEqual({ ok: true, status: 200, data: { invoices: [], nextPage: null } })
      expect(await stubbed(() => json({ payments: [] })).client.listInvoices({ metadata: {} })).toEqual({ ok: false, kind: 'unavailable', status: 200 })
      expect(await stubbed(() => json({ invoices: [{ ...INVOICE, id: undefined }] })).client.listInvoices({ metadata: {} })).toEqual({ ok: false, kind: 'unavailable', status: 200 })
    })

    it('any 2xx status is a success, and is reported', async () => {
      expect(await stubbed(() => json(INVOICE, 201)).client.createInvoice(NEW_INVOICE)).toMatchObject({ ok: true, status: 201 })
      expect(await stubbed(() => json(INVOICE, 200)).client.fetchInvoice(ID)).toMatchObject({ ok: true, status: 200 })
    })
  })

  describe('it never logs or leaks the key', () => {
    it('writes nothing to the console on any outcome, and no result carries the key', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
      const results: unknown[] = []
      for (const reply of [() => json(INVOICE), () => json({}, 400), () => json({}, 404), () => json({}, 429), () => json({}, 500), () => new Response('x', { status: 200 })]) {
        for (const [, run] of [...READS, ...WRITES]) results.push(await run(stubbed(reply).client))
      }
      const broken = (): never => {
        throw new TypeError('connect ECONNREFUSED http://stub.test')
      }
      for (const [, run] of [...READS, ...WRITES]) results.push(await run(stubbed(broken).client))
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      const text = JSON.stringify(results)
      expect(text).not.toContain(KEY)
      expect(text).not.toContain(Buffer.from(`${KEY}:`).toString('base64'))
    })
  })
})
