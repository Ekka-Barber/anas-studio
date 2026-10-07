// The `staff-admin` Edge Function (P03, D13): owner-only, step-up-gated
// invite/set_role/set_active. Real JWTs, a real TOTP step-up and a real
// email-code sign-in, all against the local stack.
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { anonClient, callStaffAdmin, createStaff, serviceClient, signIn, stepUp, uniqueEmail } from './support'

// Each case signs real users in and enrols a TOTP through the local auth service: about 3.5 seconds alone, so the
// default 5 seconds fails as soon as the stack is busy (a full test:db run).
describe('staff-admin', { timeout: 20_000 }, () => {
  it('rejects a call with no token', async () => {
    const result = await callStaffAdmin(anonClient(), { action: 'invite' })
    expect(result.status).toBe(401)
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
  })

  it('rejects an editor', async () => {
    const { email } = await createStaff('editor')
    const client = await signIn(email)
    const result = await callStaffAdmin(client, { action: 'invite' })
    expect(result.status).toBe(403)
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('requires step-up for an owner at aal1', async () => {
    const { email } = await createStaff('owner')
    const client = await signIn(email)
    const result = await callStaffAdmin(client, { action: 'invite' })
    expect(result.status).toBe(403)
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED' } })
  })

  it('an owner with a fresh TOTP can invite, and rejects bad input', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    await stepUp(client)

    const invitedEmail = uniqueEmail('invited')
    const invite = await callStaffAdmin(client, {
      action: 'invite',
      email: invitedEmail,
      displayName: 'Invited Member',
      role: 'operations',
    })
    expect(invite.status).toBe(200)
    expect(invite.reply.ok).toBe(true)

    const invitee = await signIn(invitedEmail)
    const role = await invitee.rpc('current_staff_role')
    expect(role.data).toBe('operations')

    const again = await callStaffAdmin(client, {
      action: 'invite',
      email: invitedEmail,
      displayName: 'Invited Member',
      role: 'operations',
    })
    expect(again.status).toBe(409)
    expect(again.reply).toMatchObject({ ok: false, error: { code: 'USER_EXISTS' } })

    const bad = await callStaffAdmin(client, {
      action: 'invite',
      email: 'not-an-email',
      displayName: 'x',
      role: 'operations',
    })
    expect(bad.status).toBe(422)
    expect(bad.reply).toMatchObject({ ok: false, error: { code: 'INVALID' } })

    const unknown = await callStaffAdmin(client, { action: 'nope' })
    expect(unknown.status).toBe(400)
    expect(unknown.reply).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ACTION' } })
  })

  it('set_role writes an audit row, and set_active revokes then restores access', async () => {
    const owner = await createStaff('owner')
    const ownerClient = await signIn(owner.email)
    await stepUp(ownerClient)

    const member = await createStaff('operations')
    const memberClient = await signIn(member.email)

    const setRole = await callStaffAdmin(ownerClient, { action: 'set_role', userId: member.userId, role: 'editor' })
    expect(setRole.status).toBe(200)

    const audit = await ownerClient
      .from('audit_events')
      .select('*')
      .eq('action', 'staff.set_role')
      .eq('entity_id', member.userId)
    expect(audit.error).toBeNull()
    expect(audit.data?.length).toBeGreaterThan(0)

    const revoke = await callStaffAdmin(ownerClient, { action: 'set_active', userId: member.userId, active: false })
    expect(revoke.status).toBe(200)

    const roleAfterRevoke = await memberClient.rpc('current_staff_role')
    expect(roleAfterRevoke.data).toBeNull()
    await expect(signIn(member.email)).rejects.toThrow()

    const restore = await callStaffAdmin(ownerClient, { action: 'set_active', userId: member.userId, active: true })
    expect(restore.status).toBe(200)
    await expect(signIn(member.email)).resolves.toBeTruthy()
  })

  // FABLE-AUDIT M1b: revoking a member never ended their sessions; the function the revoke runs ends them.
  it('staff_sessions_end ends every session of a member for the server, and an owner\'s own token cannot run it', async () => {
    const owner = await createStaff('owner')
    const ownerClient = await signIn(owner.email)
    const member = await createStaff('editor')
    const memberClient = await signIn(member.email)
    const postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
    await postgres.connect()
    try {
      const count = async (sql: string, userId: string): Promise<number> => (await postgres.query<{ n: number }>(sql, [userId])).rows[0]!.n
      const sessions = (userId: string): Promise<number> => count('select count(*)::int as n from auth.sessions where user_id = $1', userId)
      const tokens = (userId: string): Promise<number> => count('select count(*)::int as n from auth.refresh_tokens where user_id = $1', userId)
      const can = async (role: string): Promise<boolean> =>
        (await postgres.query<{ ok: boolean }>("select has_function_privilege($1, 'public.staff_sessions_end(uuid)', 'execute') as ok", [role])).rows[0]!.ok
      expect(await can('service_role')).toBe(true)
      for (const role of ['authenticated', 'anon']) expect(await can(role), role).toBe(false)
      expect(await sessions(member.userId)).toBe(1)
      expect(await tokens(member.userId)).toBeGreaterThan(0)

      // An owner's own token cannot run it: it is the server's alone, and nothing ends.
      const refused = await ownerClient.rpc('staff_sessions_end', { p_user: member.userId })
      expect(refused.error?.code).toBe('42501')
      expect(await sessions(member.userId)).toBe(1)

      const ended = await serviceClient.rpc('staff_sessions_end', { p_user: member.userId })
      expect(ended.error).toBeNull()
      expect(ended.data).toBe(1)
      expect(await sessions(member.userId)).toBe(0)
      expect(await tokens(member.userId)).toBe(0)
      // The member's refresh token renews nothing any more; the owner's own session is untouched.
      expect((await memberClient.auth.refreshSession()).error).not.toBeNull()
      expect(await sessions(owner.userId)).toBe(1)
    } finally {
      await postgres.end()
    }
  })

  // FABLE-AUDIT F1-8: the revoke itself ends the member's sessions once the ban holds, so a later restore (which lifts
  // the ban) cannot bring back a session left open somewhere.
  it('set_active revoking a signed-in editor ends every session of theirs, and the audit row says the ban and the end both held', async () => {
    const owner = await createStaff('owner')
    const ownerClient = await signIn(owner.email)
    await stepUp(ownerClient)
    const member = await createStaff('editor')
    const memberClient = await signIn(member.email)
    const postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
    await postgres.connect()
    try {
      const count = async (sql: string): Promise<number> => (await postgres.query<{ n: number }>(sql, [member.userId])).rows[0]!.n
      const sessions = (): Promise<number> => count('select count(*)::int as n from auth.sessions where user_id = $1')
      expect(await sessions()).toBe(1)

      const revoke = await callStaffAdmin(ownerClient, { action: 'set_active', userId: member.userId, active: false })
      expect(revoke.status, JSON.stringify(revoke.reply)).toBe(200)
      expect(revoke.reply).toEqual({ ok: true, data: { userId: member.userId, active: false } })
      expect(await sessions()).toBe(0)
      expect(await count('select count(*)::int as n from auth.refresh_tokens where user_id = $1::text')).toBe(0)
      const audit = await postgres.query<{ summary: unknown }>(
        "select summary from public.audit_events where action = 'staff.revoke' and entity_id = $1 order by at desc, id desc limit 1",
        [member.userId],
      )
      expect(audit.rows[0]?.summary).toEqual({ banApplied: true, sessionsEnded: true })
      // The member's refresh token renews nothing; the owner, whose session was not touched, can still restore them.
      expect((await memberClient.auth.refreshSession()).error).not.toBeNull()
      const restore = await callStaffAdmin(ownerClient, { action: 'set_active', userId: member.userId, active: true })
      expect(restore.status, JSON.stringify(restore.reply)).toBe(200)
      // Restored, the member signs in again with a new session; the old one stays ended.
      await expect(signIn(member.email)).resolves.toBeTruthy()
      expect(await sessions()).toBe(1)
    } finally {
      await postgres.end()
    }
  })

  it('refuses to remove the last active owner', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    await stepUp(client)

    const others = await serviceClient
      .from('staff')
      .select('user_id')
      .eq('role', 'owner')
      .eq('active', true)
      .neq('user_id', owner.userId)
    const paused = (others.data ?? []).map((row) => row.user_id as string)
    try {
      for (const userId of paused) {
        await serviceClient.from('staff').update({ active: false }).eq('user_id', userId)
      }

      const result = await callStaffAdmin(client, { action: 'set_role', userId: owner.userId, role: 'editor' })
      expect(result.status).toBe(409)
      expect(result.reply).toMatchObject({ ok: false, error: { code: 'LAST_OWNER' } })
    } finally {
      // The shared local database keeps its owners, the bootstrapped one included.
      for (const userId of paused) {
        await serviceClient.from('staff').update({ active: true }).eq('user_id', userId)
      }
    }
  })
})
