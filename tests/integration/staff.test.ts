// RLS and grants on `staff` and `audit_events`, and the retired `app_server`
// login (P03, D13, D26, D32). Real JWTs through the Data API; no service-role
// bypass except in fixture setup. Runs against a shared local database, so every fixture uses
// a unique email — never assert exact row counts, only presence/absence.
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
