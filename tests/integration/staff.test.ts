// RLS and grants on `staff`, `audit_events` and the `app_server` login (P03,
// D13, D26). Real JWTs through the Data API; no service-role bypass except in
// fixture setup. Runs against a shared local database, so every fixture uses
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

describe('editor', () => {
  it('sees only its own staff row, cannot write staff, sees no audit rows, and staff_directory fails', async () => {
    const { userId, email } = await createStaff('editor')
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

    const all = await client.from('staff').select('user_id')
    expect(all.error).toBeNull()
    const ids = all.data?.map((row) => row.user_id) ?? []
    expect(ids).toEqual(expect.arrayContaining([owner.userId, other.userId]))

    const directory = await client.rpc('staff_directory')
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
})

describe('app_server', () => {
  it('can call public.health() and is refused select on staff and audit_events', async () => {
    const pg = new Client({
      connectionString: 'postgresql://app_server:app_server_local_only@127.0.0.1:54322/postgres',
    })
    await pg.connect()
    try {
      const health = await pg.query('select public.health()')
      expect(health.rows[0].health).toBe(1)

      await expect(pg.query('select * from public.staff')).rejects.toThrow()
      await expect(pg.query('select * from public.audit_events')).rejects.toThrow()
    } finally {
      await pg.end()
    }
  })
})
