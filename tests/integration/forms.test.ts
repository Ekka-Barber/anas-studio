// P06: the contact form's SQL surface (`supabase/migrations/
// 20260926120000_contacts_and_email.sql`) against the real local database.
// `contact_submit` is called as `app_server` (the Worker's path through
// `src/lib/db.ts`); RLS on `public.contacts` goes through real JWTs at the
// Data API, like `tests/integration/media-security.test.ts`. The route
// handler's email grammar is exercised directly at the bottom (M1: an
// address must not be able to smuggle mailto headers into the inbox).
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as contactPost } from '../../src/app/api/contact/route'
import { anonClient, createStaff, signIn } from './support'

// The route handler is imported above, but vitest resolves no `@/` alias, so
// every `@/lib/*` specifier the route imports is mocked here: the database
// with a guard that must never be reached, the rest with the real modules.
vi.mock('@/lib/db', () => ({
  withDb: () => {
    throw new Error('unexpected database call')
  },
}))
vi.mock('@/lib/env', async () => vi.importActual('../../src/lib/env'))
vi.mock('@/lib/rate-limit', async () => vi.importActual('../../src/lib/rate-limit'))
vi.mock('@/lib/turnstile', async () => vi.importActual('../../src/lib/turnstile'))

let app: Client
let postgres: Client

beforeAll(async () => {
  app = new Client({ connectionString: 'postgresql://app_server:app_server_local_only@127.0.0.1:54322/postgres' })
  await app.connect()
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
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
      await postgres.query<{ status: string; email: string; submission_key: string }>(
        'select status, email, submission_key from public.contacts where id = $1',
        [stored.id],
      )
    ).rows[0]!
    expect(contact.status).toBe('new')
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

describe('contacts RLS through real JWTs', () => {
  let contactId: string
  let ownerId: string
  let ownerEmail: string

  beforeAll(async () => {
    const owner = await createStaff('owner')
    ownerId = owner.userId
    ownerEmail = owner.email
    const result = await submit({})
    contactId = result.id!
  })

  it('the owner reads the inbox and updates status, notes and assignment', async () => {
    const client = await signIn(ownerEmail)
    const read = await client.from('contacts').select('id,status').eq('id', contactId)
    expect(read.error).toBeNull()
    expect(read.data?.[0]?.id).toBe(contactId)

    const { error } = await client
      .from('contacts')
      .update({ status: 'read', notes: 'تم الاطلاع', assigned_to: ownerId })
      .eq('id', contactId)
    expect(error).toBeNull()

    const row = (
      await postgres.query<{ status: string; notes: string; assigned_to: string | null }>(
        'select status, notes, assigned_to from public.contacts where id = $1',
        [contactId],
      )
    ).rows[0]!
    expect(row.status).toBe('read')
    expect(row.notes).toBe('تم الاطلاع')
    expect(row.assigned_to).toBe(ownerId)
  })

  it('operations can update too, and a column outside the grant refuses', async () => {
    const operations = await createStaff('operations')
    const client = await signIn(operations.email)
    const { error } = await client.from('contacts').update({ status: 'closed' }).eq('id', contactId)
    expect(error).toBeNull()

    // Only status, notes, assigned_to were granted for update.
    const { error: messageError } = await client.from('contacts').update({ message: 'معدّل' }).eq('id', contactId)
    expect(messageError).not.toBeNull()
  })

  it('editors, anonymous visitors and revoked members see nothing', async () => {
    const editor = await createStaff('editor')
    const editorRead = await (await signIn(editor.email)).from('contacts').select('id').eq('id', contactId)
    expect(editorRead.error).toBeNull()
    expect(editorRead.data).toEqual([])

    // The migration grants select to authenticated only; anon is refused by
    // table privileges (42501) before RLS could even return an empty set.
    const anonRead = await anonClient().from('contacts').select('id').eq('id', contactId)
    if (anonRead.error) expect(anonRead.error.code).toBe('42501')
    else expect(anonRead.data).toEqual([])

    const revoked = await createStaff('operations', { active: false })
    const revokedRead = await (await signIn(revoked.email)).from('contacts').select('id').eq('id', contactId)
    expect(revokedRead.error).toBeNull()
    expect(revokedRead.data).toEqual([])
  })

  it('no API role inserts or deletes contacts', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    const { error: insertError } = await client
      .from('contacts')
      .insert({ name: 'x', email: 'x@example.com', message: 'y', submission_key: randomUUID() })
    expect(insertError).not.toBeNull()
    const { error: deleteError } = await client.from('contacts').delete().eq('id', contactId)
    expect(deleteError).not.toBeNull()
  })

  it('no API role executes the app_server functions or reads finance', async () => {
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

describe('contact route email grammar', () => {
  beforeEach(() => {
    // No Turnstile credentials: a grammatical address then stops at the
    // verifier, which is exactly the proof of acceptance these tests need.
    vi.stubEnv('SITE_URL', '')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function contactRequest(email: string): Request {
    return new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
})
