// P06 round 3, step 4: the privacy request functions (I31) and contact
// retention (D36). The grants are read straight from the catalog; the
// functions themselves run as the local superuser — no role has execute,
// which is the point — and only on staff and contacts this file creates.
// Everything that would persist (contacts, outbox rows, the audit rows for
// them) runs inside a transaction that is rolled back, so the shared local
// database is left as it was. The one erased member stays erased: that is
// the production shape (the append-only trail keeps the id, I31), and the
// account is inert.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaff, signIn } from './support'

let postgres: Client

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  await postgres.end()
})

async function canExecute(role: string, signature: string): Promise<boolean> {
  const result = await postgres.query<{ ok: boolean }>('select has_function_privilege($1, $2, $3) as ok', [
    role,
    signature,
    'execute',
  ])
  return result.rows[0]!.ok
}

/** Runs `body` in a transaction that is always rolled back. */
async function rolledBack(body: () => Promise<void>): Promise<void> {
  await postgres.query('begin')
  try {
    await body()
  } finally {
    await postgres.query('rollback')
  }
}

/** Rows per `auth` table still referencing the user (refresh_tokens and the Auth log match on text). */
async function authRowCounts(userId: string): Promise<Record<string, number>> {
  const one = async (fragment: string): Promise<number> =>
    (await postgres.query<{ n: number }>(`select count(*)::int as n ${fragment}`, [userId])).rows[0]!.n
  return {
    flow_state: await one('from auth.flow_state where user_id = $1'),
    identities: await one('from auth.identities where user_id = $1'),
    mfa_factors: await one('from auth.mfa_factors where user_id = $1'),
    oauth_authorizations: await one('from auth.oauth_authorizations where user_id = $1'),
    oauth_consents: await one('from auth.oauth_consents where user_id = $1'),
    one_time_tokens: await one('from auth.one_time_tokens where user_id = $1'),
    refresh_tokens: await one('from auth.refresh_tokens where user_id = $1::text'),
    sessions: await one('from auth.sessions where user_id = $1'),
    webauthn_challenges: await one('from auth.webauthn_challenges where user_id = $1'),
    webauthn_credentials: await one('from auth.webauthn_credentials where user_id = $1'),
    audit_log_entries: await one("from auth.audit_log_entries where payload->>'actor_id' = $1::text"),
  }
}

async function insertContact(email: string): Promise<string> {
  const result = await postgres.query<{ id: string }>(
    "insert into public.contacts (name, email, message, submission_key) values ('زائر', $1, 'رسالة اختبار', gen_random_uuid()) returning id",
    [email],
  )
  return result.rows[0]!.id
}

/** One contact notice in the outbox, with a unique dedupe key. */
async function insertNotice(
  contactId: string,
  status: string,
  sentAt: string | null,
  delivery: string | null,
): Promise<void> {
  await postgres.query(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, delivery, sent_at)
     values ($1, 'contact_notice', 1, 'owner@example.com', $2::jsonb, $3, $4, $5)`,
    [`privacy-test-${contactId}-${status}-${delivery ?? 'none'}`, JSON.stringify({ contactId }), status, delivery, sentAt],
  )
}

const ERASE_FUNCTIONS = [
  'public.privacy_erase_staff(uuid)',
  'public.privacy_erase_contacts(uuid[])',
  'finance.contacts_purge()',
]

describe('grants (I31)', () => {
  it.each(ERASE_FUNCTIONS)('%s: no API role can execute it', async (signature) => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await canExecute(role, signature), `${role} ${signature}`).toBe(false)
    }
  })
})

describe('privacy_erase_staff', () => {
  it('refuses an active member and changes nothing', async () => {
    const member = await createStaff('editor')
    const before = await authRowCounts(member.userId)
    await expect(
      postgres.query('select public.privacy_erase_staff($1)', [member.userId]),
    ).rejects.toMatchObject({ code: '55000' })

    const user = (await postgres.query<{ email: string }>('select email from auth.users where id = $1', [member.userId])).rows[0]!
    expect(user.email).toBe(member.email)
    expect(await authRowCounts(member.userId)).toEqual(before)
    const staff = (
      await postgres.query<{ display_name: string; active: boolean }>(
        'select display_name, active from public.staff where user_id = $1',
        [member.userId],
      )
    ).rows[0]!
    expect(staff.display_name).toBe(member.email)
    expect(staff.active).toBe(true)
    expect(
      (await postgres.query<{ n: number }>(
        "select count(*)::int as n from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )).rows[0]!.n,
    ).toBe(0)
  })

  it('erases a revoked member: Auth tables emptied, earlier audit rows identical, staff renamed, repeat is a no-op', async () => {
    const member = await createStaff('editor')
    await signIn(member.email)
    await postgres.query(
      "insert into public.audit_events (actor, action, entity, entity_id, summary) values ($1, 'test.member', 'test', '1', '{}'::jsonb)",
      [member.userId],
    )
    // The revoke path leaves active = false; Auth also bans the user.
    await postgres.query('update public.staff set active = false where user_id = $1', [member.userId])

    const auditBefore = (
      await postgres.query<{ row: Record<string, unknown> }>(
        'select to_jsonb(a) as row from public.audit_events a where actor = $1 order by id',
        [member.userId],
      )
    ).rows.map((r) => r.row)
    expect(auditBefore.length).toBeGreaterThanOrEqual(1)

    const before = await authRowCounts(member.userId)
    expect(before.identities).toBeGreaterThanOrEqual(1)
    expect(before.sessions).toBeGreaterThanOrEqual(1)
    expect(before.refresh_tokens).toBeGreaterThanOrEqual(1)
    expect(before.audit_log_entries).toBeGreaterThanOrEqual(1)

    // Their address also sits where others acted on them (Auth's own log of
    // the account being created) and on notices addressed to them.
    const addressInAuthLog = async () =>
      (
        await postgres.query<{ n: number }>(
          "select count(*)::int as n from auth.audit_log_entries where payload::text ilike '%' || $1 || '%'",
          [member.email],
        )
      ).rows[0]!.n
    expect(await addressInAuthLog()).toBeGreaterThanOrEqual(1)
    const notice = (status: string) =>
      postgres.query(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at)
         values ($1, 'contact_notice', 1, $2, '{"contactId": null}'::jsonb, $3, case when $3 = 'sent' then now() end)`,
        [`privacy-staff-${member.userId}-${status}`, member.email.toLowerCase(), status],
      )
    await notice('sent')
    await notice('pending')

    await postgres.query('select public.privacy_erase_staff($1)', [member.userId])

    expect(await addressInAuthLog()).toBe(0)
    const outbox = (
      await postgres.query<{ status: string; recipient: string }>(
        "select status, recipient from finance.email_outbox where dedupe_key like 'privacy-staff-' || $1 || '-%' order by status",
        [member.userId],
      )
    ).rows
    // The unsent notice is dropped; the sent one keeps its history under the placeholder.
    expect(outbox).toEqual([{ status: 'sent', recipient: `erased-${member.userId}@erased.invalid` }])

    expect(await authRowCounts(member.userId)).toEqual(
      Object.fromEntries(Object.keys(before).map((table) => [table, 0])),
    )
    const user = (
      await postgres.query<{ email: string; phone: string | null; raw_user_meta_data: unknown }>(
        'select email, phone, raw_user_meta_data from auth.users where id = $1',
        [member.userId],
      )
    ).rows[0]!
    expect(user.email).toBe(`erased-${member.userId}@erased.invalid`)
    expect(user.phone).toBeNull()
    expect(user.raw_user_meta_data).toEqual({})
    expect(
      (await postgres.query<{ n: number }>('select count(*)::int as n from auth.users where email = $1', [member.email]))
        .rows[0]!.n,
    ).toBe(0)
    const staff = (
      await postgres.query<{ display_name: string }>('select display_name from public.staff where user_id = $1', [member.userId])
    ).rows[0]!
    expect(staff.display_name).toBe('موظف سابق')

    const auditAfter = (
      await postgres.query<{ row: Record<string, unknown> }>(
        'select to_jsonb(a) as row from public.audit_events a where actor = $1 order by id',
        [member.userId],
      )
    ).rows.map((r) => r.row)
    expect(auditAfter.filter((row) => row.action !== 'privacy.erase_staff')).toEqual(auditBefore)
    const eraseRows = (
      await postgres.query<{ actor: string | null; entity: string; entity_id: string; summary: unknown }>(
        "select actor, entity, entity_id, summary from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )
    ).rows
    expect(eraseRows).toEqual([
      { actor: null, entity: 'staff', entity_id: member.userId, summary: {} },
    ])

    // A second call succeeds, removes nothing and audits nothing.
    const second = (
      await postgres.query<{ r: Record<string, number> }>('select public.privacy_erase_staff($1) as r', [member.userId])
    ).rows[0]!.r
    expect(Object.values(second).every((n) => n === 0)).toBe(true)
    expect(
      (await postgres.query<{ n: number }>(
        "select count(*)::int as n from public.audit_events where action = 'privacy.erase_staff' and entity_id = $1",
        [member.userId],
      )).rows[0]!.n,
    ).toBe(1)
  })
})

describe('privacy_erase_contacts', () => {
  it('deletes the named contacts and their unsent notices, keeps sent rows, audits the count only', async () => {
    const marker = Date.now()
    await rolledBack(async () => {
      const a = await insertContact(`privacy-a-${marker}@example.com`)
      const b = await insertContact(`privacy-b-${marker}@example.com`)
      await insertNotice(a, 'pending', null, null)
      await insertNotice(a, 'sent', new Date().toISOString(), null)

      const deleted = (
        await postgres.query<{ r: number }>('select public.privacy_erase_contacts($1::uuid[]) as r', [[a, b]])
      ).rows[0]!.r
      expect(deleted).toBe(2)
      const gone = (
        await postgres.query<{ n: number }>('select count(*)::int as n from public.contacts where id = any($1::uuid[])', [[a, b]])
      ).rows[0]!.n
      expect(gone).toBe(0)
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1 and status = 'pending'",
          [a],
        )).rows[0]!.n,
      ).toBe(0)
      // The sent row stays, holding only a dangling contactId.
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1 and status = 'sent'",
          [a],
        )).rows[0]!.n,
      ).toBe(1)

      const audit = (
        await postgres.query<{ entity_id: string; summary: { count: number } }>(
          // `at = now()`: only this transaction's rows, not a runbook run left behind on the local stack.
          "select entity_id, summary from public.audit_events where action = 'privacy.erase_contacts' and entity = 'contacts' and at = now()",
        )
      ).rows
      expect(audit).toEqual([{ entity_id: '2', summary: { count: 2 } }])

      expect(
        (await postgres.query<{ r: number }>('select public.privacy_erase_contacts($1::uuid[]) as r', [[a, b]])).rows[0]!.r,
      ).toBe(0)
      // The no-op call wrote no second audit row.
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from public.audit_events where action = 'privacy.erase_contacts' and at = now()",
        )).rows[0]!.n,
      ).toBe(1)
    })
  })
})

describe('contacts_purge (D36)', () => {
  it('purges a contact only once a notice reached a mailbox over 90 days ago and nothing is still pending', async () => {
    const marker = Date.now()
    const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()
    await rolledBack(async () => {
      const old91 = await insertContact(`purge-91-${marker}@example.com`)
      const old89 = await insertContact(`purge-89-${marker}@example.com`)
      const bounced = await insertContact(`purge-bounced-${marker}@example.com`)
      const partlyPending = await insertContact(`purge-pending-${marker}@example.com`)
      const unsent = await insertContact(`purge-unsent-${marker}@example.com`)

      await insertNotice(old91, 'sent', daysAgo(91), null)
      await insertNotice(old91, 'exhausted', null, null) // every outbox row of a purged contact goes
      await insertNotice(old89, 'sent', daysAgo(89), null)
      await insertNotice(bounced, 'sent', daysAgo(91), 'bounced')
      await insertNotice(partlyPending, 'sent', daysAgo(91), null)
      await insertNotice(partlyPending, 'pending', null, null) // still waiting: the contact stays
      await insertNotice(unsent, 'pending', null, null) // reached nobody yet: stays

      const purged = (await postgres.query<{ r: number }>('select finance.contacts_purge() as r')).rows[0]!.r
      expect(purged).toBe(1)

      const remaining = (
        await postgres.query<{ id: string }>('select id from public.contacts where id = any($1::uuid[])', [
          [old91, old89, bounced, partlyPending, unsent],
        ])
      ).rows.map((r) => r.id)
      expect(new Set(remaining)).toEqual(new Set([old89, bounced, partlyPending, unsent]))
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1",
          [old91],
        )).rows[0]!.n,
      ).toBe(0)
      expect(
        (await postgres.query<{ n: number }>(
          "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1",
          [partlyPending],
        )).rows[0]!.n,
      ).toBe(2)
    })
  })

  it('the period lives in the function, not a column; the daily job exists', async () => {
    expect(
      (
        await postgres.query<{ n: number }>(
          "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'retain_until'",
        )
      ).rows[0]!.n,
    ).toBe(0)
    expect(
      (await postgres.query<{ n: number }>("select count(*)::int as n from cron.job where jobname = 'contacts-purge'")).rows[0]!
        .n,
    ).toBe(1)
  })
})
