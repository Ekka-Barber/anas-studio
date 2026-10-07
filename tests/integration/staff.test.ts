// RLS and grants on `staff` and `audit_events`, and the retired `app_server`
// login (P03, D13, D26, D32). Real JWTs through the Data API; no service-role
// bypass except in fixture setup. Runs against a shared local database, so every fixture uses
// a unique email — never assert exact row counts, only presence/absence.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { anonClient, createStaff, serviceClient, signIn } from './support'

describe('anon', () => {
  it('cannot read staff, audit_events, or call staff_directory/current_staff_role/health', async () => {
    const anon = anonClient()
    expect((await anon.from('staff').select('*')).error).toBeTruthy()
    expect((await anon.from('audit_events').select('*')).error).toBeTruthy()
    expect((await anon.rpc('staff_directory')).error).toBeTruthy()
    expect((await anon.rpc('current_staff_role')).error).toBeTruthy()
    expect((await anon.rpc('health')).error).toBeTruthy()
  })
})

describe.each(['editor', 'operations'] as const)('%s', (role) => {
  it('sees only its own staff row, cannot write staff, sees no audit rows, and staff_directory fails', async () => {
    const { userId, email } = await createStaff(role)
    const client = await signIn(email)

    const own = await client.from('staff').select('user_id').single()
    expect(own.error).toBeNull()
    expect(own.data?.user_id).toBe(userId)

    const all = await client.from('staff').select('user_id')
    expect(all.data?.every((row) => row.user_id === userId)).toBe(true)

    expect((await client.from('staff').update({ role: 'owner' }).eq('user_id', userId)).error).toBeTruthy()
    expect(
      (await client.from('staff').insert({ user_id: userId, display_name: 'x', role: 'owner' })).error,
    ).toBeTruthy()
    expect((await client.from('staff').delete().eq('user_id', userId)).error).toBeTruthy()

    const audit = await client.from('audit_events').select('*')
    expect(audit.error).toBeNull()
    expect(audit.data).toEqual([])

    expect((await client.rpc('staff_directory')).error).toBeTruthy()
  })
})

describe('owner', () => {
  it('reads all staff, the directory and audit, but cannot write staff through the Data API', async () => {
    const owner = await createStaff('owner')
    const other = await createStaff('editor')
    const client = await signIn(owner.email)

    // Filtered: earlier runs leave staff rows behind and PostgREST caps a plain select at max_rows (1000).
    const all = await client.from('staff').select('user_id').in('user_id', [owner.userId, other.userId])
    expect(all.error).toBeNull()
    const ids = all.data?.map((row) => row.user_id) ?? []
    expect(ids).toEqual(expect.arrayContaining([owner.userId, other.userId]))

    const directory = await client.rpc('staff_directory').eq('user_id', other.userId)
    expect(directory.error).toBeNull()
    expect(directory.data?.some((row: { user_id: string }) => row.user_id === other.userId)).toBe(true)

    const audit = await client.from('audit_events').select('*')
    expect(audit.error).toBeNull()

    expect(
      (await client.from('staff').update({ role: 'editor' }).eq('user_id', other.userId)).error,
    ).toBeTruthy()
  })
})

describe('current_staff_role', () => {
  it('goes null on the next query once the service client deactivates the member', async () => {
    const { userId, email } = await createStaff('editor')
    const client = await signIn(email)

    const before = await client.rpc('current_staff_role')
    expect(before.data).toBe('editor')

    const { error: deactivateError } = await serviceClient.from('staff').update({ active: false }).eq('user_id', userId)
    expect(deactivateError).toBeNull()

    const after = await client.rpc('current_staff_role')
    expect(after.data).toBeNull()
  })

  it('a revoked owner keeps its session but reads no audit rows or directory, and cannot write staff', async () => {
    // A second active owner keeps the "at least one owner" rule satisfied.
    await createStaff('owner')
    const { userId, email } = await createStaff('owner')
    const client = await signIn(email)
    expect((await client.from('audit_events').select('*').limit(1)).error).toBeNull()
    expect((await client.rpc('staff_directory')).error).toBeNull()

    const { error: deactivateError } = await serviceClient.from('staff').update({ active: false }).eq('user_id', userId)
    expect(deactivateError).toBeNull()

    const audit = await client.from('audit_events').select('*')
    expect(audit.error).toBeNull()
    expect(audit.data).toEqual([])
    // staff_read still lets the member see its own row; nothing else.
    const staff = await client.from('staff').select('user_id')
    expect(staff.error).toBeNull()
    expect(staff.data?.every((row) => row.user_id === userId)).toBe(true)
    expect((await client.rpc('staff_directory')).error).toBeTruthy()
    expect((await client.from('staff').update({ role: 'owner', active: true }).eq('user_id', userId)).error).toBeTruthy()
  })
})

// FABLE-AUDIT T-5 (TEST-DB-06): the audit trail is append-only (20260925090000_audit_and_staff_directory.sql). No staff
// role holds update or delete on it, the service role is granted insert alone (the staff-admin function appends), and
// a trigger refuses update and delete for every role, the table's owner included.
describe('audit_events is append-only', () => {
  it('no staff JWT and not the service role can change or delete an audit row through the Data API, and the trigger refuses even the owner of the table', async () => {
    const entityId = `append-only-${randomUUID()}`
    const appended = await serviceClient.from('audit_events').insert({ action: 'test.append_only', entity: 'test', entity_id: entityId, summary: { test: true } })
    expect(appended.error).toBeNull()
    const pg = new Client({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    await pg.connect()
    try {
      const stored = (await pg.query('select * from public.audit_events where entity_id = $1', [entityId])).rows
      expect(stored).toHaveLength(1)

      // The service role may append, and nothing else: no read, no update, no delete.
      expect((await serviceClient.from('audit_events').select('id').eq('entity_id', entityId)).error?.code).toBe('42501')
      expect((await serviceClient.from('audit_events').update({ action: 'test.edited' }).eq('entity_id', entityId)).error?.code).toBe('42501')
      expect((await serviceClient.from('audit_events').delete().eq('entity_id', entityId)).error?.code).toBe('42501')
      for (const role of ['owner', 'editor', 'operations'] as const) {
        const client = await signIn((await createStaff(role)).email)
        expect((await client.from('audit_events').update({ action: 'test.edited' }).eq('entity_id', entityId)).error?.code, `${role} update`).toBe('42501')
        expect((await client.from('audit_events').delete().eq('entity_id', entityId)).error?.code, `${role} delete`).toBe('42501')
      }

      // The trigger itself, for the role that owns the table: refused, inside a transaction that is rolled back anyway.
      for (const statement of ["update public.audit_events set action = 'test.edited' where entity_id = $1", 'delete from public.audit_events where entity_id = $1']) {
        await pg.query('begin')
        const code = await pg.query(statement, [entityId]).then(
          () => 'not refused',
          (error: { code?: string }) => error.code,
        )
        await pg.query('rollback')
        expect(code, statement).toBe('42501')
      }
      expect((await pg.query('select * from public.audit_events where entity_id = $1', [entityId])).rows).toEqual(stored)
    } finally {
      await pg.end()
    }
  })

  // FABLE-AUDIT M2-16: the row trigger never sees a TRUNCATE, and the default privileges had given the service role one.
  it('TRUNCATE is refused for the role that owns the table too, and the service role no longer holds it', async () => {
    const pg = new Client({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    await pg.connect()
    try {
      const rows = Number((await pg.query<{ n: string }>('select count(*) as n from public.audit_events')).rows[0]!.n)
      // Inside a transaction that is rolled back whatever happens.
      await pg.query('begin')
      const code = await pg.query('truncate public.audit_events').then(
        () => 'not refused',
        (error: { code?: string }) => error.code,
      )
      await pg.query('rollback')
      expect(code).toBe('42501')
      expect(Number((await pg.query<{ n: string }>('select count(*) as n from public.audit_events')).rows[0]!.n)).toBeGreaterThanOrEqual(rows)
      const held = (
        await pg.query(
          `select has_table_privilege('service_role', 'public.audit_events', 'truncate') as truncate,
                  has_table_privilege('service_role', 'public.audit_events', 'insert') as insert`,
        )
      ).rows[0]
      expect(held).toEqual({ truncate: false, insert: true })
    } finally {
      await pg.end()
    }
  })
})

describe('server roles (D32)', () => {
  it('the app_server login and its health probe are gone', async () => {
    const pg = new Client({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    await pg.connect()
    try {
      const role = await pg.query("select 1 from pg_catalog.pg_roles where rolname = 'app_server'")
      expect(role.rowCount).toBe(0)
      const health = await pg.query("select to_regprocedure('public.health()') as fn")
      expect(health.rows[0].fn).toBeNull()
    } finally {
      await pg.end()
    }
  })
})
