// The `staff-admin` Edge Function (P03, D13): owner-only, step-up-gated
// invite/set_role/set_active. Real JWTs, a real TOTP step-up and a real
// email-code sign-in, all against the local stack.
import { describe, expect, it } from 'vitest'

import { anonClient, callStaffAdmin, createStaff, serviceClient, signIn, stepUp, uniqueEmail } from './support'

describe('staff-admin', () => {
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
    for (const row of others.data ?? []) {
      await serviceClient.from('staff').update({ active: false }).eq('user_id', row.user_id)
    }

    const result = await callStaffAdmin(client, { action: 'set_role', userId: owner.userId, role: 'editor' })
    expect(result.status).toBe(409)
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'LAST_OWNER' } })
  })
})
