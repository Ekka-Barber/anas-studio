// P06: the contact form's SQL surface (`supabase/migrations/
// 20260926120000_contacts_and_email.sql`) against the real local database.
// `contact_submit` is called as `service_role` (the `contact` Edge Function's
// role, D32); the Data API refusal of `public.contacts` goes through
// real JWTs, like `tests/integration/media-security.test.ts` (D31: there is
// no admin inbox, the table is server-only). The route handler's email
// grammar is exercised directly at the bottom (M1: an address must not be
// able to smuggle mailto headers into the notice's Reply-To).
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleContact } from '../../supabase/functions/_shared/contact.ts'
import { anonClient, createStaff, serviceRoleDb, signIn } from './support'

// The grammar and size cases below never reach the database.
const contactPost = (request: Request) =>
  handleContact(request, async () => {
    throw new Error('unexpected database call')
  })

let app: Client
let postgres: Client

beforeAll(async () => {
  app = await serviceRoleDb()
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  // The whole-store daily bucket (40 a day) is shared by every run on this
  // machine; this file uses about ten per run, so reruns would trip it.
  await postgres.query("delete from finance.rate_limits where bucket = 'contact:all'")
})

afterAll(async () => {
  await postgres.query("delete from finance.rate_limits where bucket = 'contact:all'")
  await app.end()
  await postgres.end()
})

let counter = 0
function unique(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}

function ipHash(): string {
  return createHash('sha256').update(unique('ip')).digest('hex')
}

async function submit(
  overrides: Partial<{ ipHash: string; name: string; email: string; message: string; submissionKey: string }> = {},
): Promise<{ id: string | null; duplicate: boolean; sqlstate?: string }> {
  try {
    const result = await app.query<{ t: { id: string; duplicate: boolean } }>(
      'select public.contact_submit($1, $2, $3, $4, $5, $6) as t',
      [
        overrides.ipHash ?? ipHash(),
        overrides.name ?? 'زائر',
        overrides.email ?? `${unique('guest')}@example.com`,
        overrides.message ?? 'رسالة اختبار',
        overrides.submissionKey ?? randomUUID(),
        null,
      ],
    )
    return result.rows[0]!.t
  } catch (error) {
    return { id: null, duplicate: false, sqlstate: (error as { code?: string }).code }
  }
}

describe('contact_submit', () => {
  it('stores the message and queues one notice per active owner or operations member', async () => {
    const ownerA = await createStaff('owner')
    const ownerB = await createStaff('owner')
    const operations = await createStaff('operations')
    const editor = await createStaff('editor')
    const inactive = await createStaff('operations', { active: false })
    const submissionKey = randomUUID()

    const stored = await submit({ submissionKey })
    expect(stored.duplicate).toBe(false)
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/)

    const contact = (
      await postgres.query<{ email: string; submission_key: string }>(
        'select email, submission_key from public.contacts where id = $1',
        [stored.id],
      )
    ).rows[0]!
    expect(contact.submission_key).toBe(submissionKey)

    // The local database is shared, so the expected recipient set is every
    // active owner and operations member present right now — exactly what
    // contact_submit must notify, no more (editors, inactive staff).
    const expected = (
      await postgres.query<{ email: string }>(
        `select lower(u.email) as email from public.staff s join auth.users u on u.id = s.user_id
         where s.active and s.role in ('owner', 'operations') and u.email is not null`,
      )
    ).rows.map((row) => row.email)

    const notices = (
      await postgres.query<{ recipient: string; kind: string; priority: number; status: string }>(
        "select recipient, kind, priority, status from finance.email_outbox where payload->>'contactId' = $1",
        [stored.id],
      )
    ).rows
    expect(notices.map((row) => row.recipient).sort()).toEqual([...expected].sort())
    for (const notice of notices) {
      expect(notice.kind).toBe('contact_notice')
      expect(notice.priority).toBe(1)
      expect(notice.status).toBe('pending')
    }
    expect(expected).toContain(ownerA.email.toLowerCase())
    expect(expected).toContain(ownerB.email.toLowerCase())
    expect(expected).toContain(operations.email.toLowerCase())
    expect(expected).not.toContain(editor.email.toLowerCase())
    expect(expected).not.toContain(inactive.email.toLowerCase())
  })

  it('a repeated submission key stores and queues nothing new', async () => {
    const submissionKey = randomUUID()
    const first = await submit({ submissionKey })
    expect(first.duplicate).toBe(false)

    const before = (
      await postgres.query('select count(*)::int as n from finance.email_outbox where payload->>\'contactId\' = $1', [first.id])
    ).rows[0]!.n
    const second = await submit({ submissionKey, message: 'رسالة مختلفة' })
    expect(second.duplicate).toBe(true)
    expect(second.id).toBe(first.id)

    const after = (
      await postgres.query('select count(*)::int as n from finance.email_outbox where payload->>\'contactId\' = $1', [first.id])
    ).rows[0]!.n
    expect(after).toBe(before)

    const message = (await postgres.query<{ message: string }>('select message from public.contacts where id = $1', [first.id]))
      .rows[0]!.message
    expect(message).toBe('رسالة اختبار')
  })

  it('throttles: 5 per hour per salted IP hash', async () => {
    const hash = ipHash()
    for (let i = 0; i < 5; i += 1) {
      const result = await submit({ ipHash: hash })
      expect(result.sqlstate).toBeUndefined()
    }
    const sixth = await submit({ ipHash: hash })
    expect(sixth.sqlstate).toBe('54000')
  })

  // Every message queues a notice per recipient, and the outbox sends priority
  // 1 only under quota - reserve = 80 a day, so the day's intake stays under it (AUDIT-2).
  it('throttles: 40 messages a day in total; the 41st raises 54000', async () => {
    await postgres.query('begin')
    try {
      await postgres.query("delete from finance.rate_limits where bucket = 'contact:all'")
      const send = () =>
        postgres.query('select public.contact_submit($1, $2, $3, $4, $5, $6)', [
          ipHash(),
          'زائر',
          `${unique('cap')}@example.com`,
          'رسالة اختبار',
          randomUUID(),
          null,
        ])
      for (let i = 0; i < 40; i += 1) await send()
      await expect(send()).rejects.toMatchObject({ code: '54000' })
    } finally {
      await postgres.query('rollback')
    }
  }, 60_000)

  it('throttles: 3 per hour per email', async () => {
    const email = `${unique('throttled')}@example.com`
    for (let i = 0; i < 3; i += 1) {
      const result = await submit({ email })
      expect(result.sqlstate).toBeUndefined()
    }
    const fourth = await submit({ email })
    expect(fourth.sqlstate).toBe('54000')
  })
})

describe('contacts are server-only (D31: no admin inbox)', () => {
  let contactId: string

  beforeAll(async () => {
    const result = await submit({})
    contactId = result.id!
  })

  it('no API role holds any privilege on the table', async () => {
    const grants = (
      await postgres.query<{ role: string; privilege: string; held: boolean }>(
        `select r.role, p.privilege, has_table_privilege(r.role, 'public.contacts', p.privilege) as held
         from (values ('anon'), ('authenticated')) as r(role),
              (values ('select'), ('insert'), ('update'), ('delete')) as p(privilege)`,
      )
    ).rows
    expect(grants.filter((row) => row.held)).toEqual([])
  })

  it('owner, operations, editor, revoked and anonymous callers read nothing through the Data API', async () => {
    const callers = [
      await signIn((await createStaff('owner')).email),
      await signIn((await createStaff('operations')).email),
      await signIn((await createStaff('editor')).email),
      await signIn((await createStaff('operations', { active: false })).email),
      anonClient(),
    ]
    for (const client of callers) {
      const read = await client.from('contacts').select('id').eq('id', contactId)
      // No grant: PostgREST answers permission denied (42501) before RLS runs.
      if (read.error) expect(read.error.code).toBe('42501')
      else expect(read.data).toEqual([])
    }
  })

  it('not even the owner updates, inserts or deletes a contact', async () => {
    const client = await signIn((await createStaff('owner')).email)
    const { error: updateError } = await client.from('contacts').update({ message: 'معدّل' }).eq('id', contactId)
    expect(updateError).not.toBeNull()
    const { error: insertError } = await client
      .from('contacts')
      .insert({ name: 'x', email: 'x@example.com', message: 'y', submission_key: randomUUID() })
    expect(insertError).not.toBeNull()
    const { error: deleteError } = await client.from('contacts').delete().eq('id', contactId)
    expect(deleteError).not.toBeNull()
    const kept = (await postgres.query<{ message: string }>('select message from public.contacts where id = $1', [contactId]))
      .rows[0]!
    expect(kept.message).toBe('رسالة اختبار')
  })

  it('no API role executes the server-only functions or reads finance', async () => {
    const editor = await createStaff('editor')
    const client = await signIn(editor.email)
    const { error: submitError } = await client.rpc('contact_submit', {
      p_ip_hash: '0'.repeat(64),
      p_name: 'x',
      p_email: 'x@example.com',
      p_message: 'y',
      p_submission_key: randomUUID(),
      p_policy_revision: null,
    })
    expect(submitError).not.toBeNull()
    const { error: claimError } = await client.rpc('outbox_claim', { p_limit: 1, p_lease_seconds: 60, p_daily_quota: 100, p_reserve: 20 })
    expect(claimError).not.toBeNull()

    // The relation the contact insert path writes to is `finance.email_outbox`
    // — the actual table, in the unexposed `finance` schema. No API role can
    // read it: the migration's `revoke all` left anon and authenticated with
    // no privilege on the real relation.
    const outboxGrants = (
      await postgres.query<{ authenticated: boolean; anon: boolean }>(
        `select has_table_privilege('authenticated', 'finance.email_outbox', 'select') as authenticated,
                has_table_privilege('anon', 'finance.email_outbox', 'select') as anon`,
      )
    ).rows[0]!
    expect(outboxGrants.authenticated).toBe(false)
    expect(outboxGrants.anon).toBe(false)
  })
})

const SITE = 'http://localhost:3000'

describe('contact function email grammar', () => {
  beforeEach(() => {
    // No Turnstile secret: a grammatical address then stops at the verifier,
    // which is exactly the proof of acceptance these tests need.
    vi.stubEnv('SITE_URL', SITE)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function contactRequest(email: string): Request {
    return new Request('http://127.0.0.1:54321/functions/v1/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify({
        name: 'زائر',
        email,
        message: 'رسالة اختبار',
        submissionKey: randomUUID(),
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    })
  }

  it('refuses an address that smuggles mailto headers', async () => {
    const response = await contactPost(contactRequest('x@evil.test?bcc=attacker%40evil.test&body=hello'))
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: { code: string; fields?: { fieldErrors?: { email?: string[] } } } }
    expect(body.error.code).toBe('INVALID')
    expect(body.error.fields?.fieldErrors?.email).toBeDefined()
  })

  it('accepts a normal address', async () => {
    const response = await contactPost(contactRequest('guest@example.com'))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TURNSTILE_UNAVAILABLE')
  })

  it('accepts an internationalised Saudi domain, validated and stored as punycode', async () => {
    // `.السعودية` arrives in Unicode; the route punycodes the domain before
    // the grammar check, so acceptance shows exactly like the normal address
    // above — the 503 Turnstile stub, not a 422 from the schema.
    const response = await contactPost(contactRequest('user@مثال.السعودية'))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TURNSTILE_UNAVAILABLE')
  })
})

describe('contact function body limits', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses a body past the 8 KiB limit when no content-length is declared', async () => {
    vi.stubEnv('SITE_URL', SITE)
    // A Request built from a string carries no content-length header (Node
    // adds one only at dispatch), so this is the chunked-request shape: the
    // pre-read gate sees nothing and the post-read guard alone must refuse.
    const response = await contactPost(
      new Request('http://127.0.0.1:54321/functions/v1/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SITE },
        body: JSON.stringify({
          name: 'زائر',
          email: 'guest@example.com',
          message: 'x'.repeat(9_000),
          submissionKey: randomUUID(),
          turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
        }),
      }),
    )
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TOO_LARGE')
  })
})
