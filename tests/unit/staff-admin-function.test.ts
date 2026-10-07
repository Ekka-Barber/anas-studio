// staff-admin (D13): a request body that is not a JSON object is 400 BAD_JSON
// instead of a crash (EF-admin-1), and an invite finishes an auth user left
// without a staff row instead of answering USER_EXISTS for ever (GAP-G2-3).
// The function calls `Deno.serve` when imported, so the test captures its
// handler; the caller's identity and the service client are faked. Each test
// starts as an active owner with a fresh TOTP; the gate tests set another one.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (request: Request) => Promise<Response>

const hoisted = vi.hoisted(() => ({
  handler: undefined as undefined | ((request: Request) => Promise<Response>),
  client: undefined as unknown,
  identity: undefined as unknown,
}))

vi.mock('../../supabase/functions/_shared/staff.ts', () => ({ staffFromRequest: async () => hoisted.identity }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ serviceClient: () => hoisted.client }))

const OWNER = { userId: '11111111-1111-4111-8111-111111111111', role: 'owner', recentTotp: true }

beforeEach(() => {
  hoisted.identity = OWNER
})

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (handler: Handler) => {
      hoisted.handler = handler
    },
    env: { get: (name: string) => process.env[name] },
  })
  // A variable specifier keeps tsc from pulling this Deno entry point into
  // the program (supabase/functions is excluded; `Deno` has no types here).
  const entry = '../../supabase/functions/staff-admin/index.ts'
  await import(/* @vite-ignore */ entry)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const send = (body: string) =>
  hoisted.handler!(new Request('http://127.0.0.1:54321/functions/v1/staff-admin', { method: 'POST', body }))

const invite = (email: string) =>
  send(JSON.stringify({ action: 'invite', email, displayName: 'مها', role: 'editor' }))

interface World {
  users: Array<{ id: string; email: string }>
  staff: Set<string>
  staffInsertFails: boolean
  deleteFails: boolean
}

/** A fake service client over an in-memory auth users list and staff table. */
function install(world: World) {
  const deleted: string[] = []
  hoisted.client = {
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          if (world.users.some((user) => user.email === email)) return { data: { user: null }, error: { code: 'email_exists' } }
          const user = { id: randomUUID(), email }
          world.users.push(user)
          return { data: { user }, error: null }
        },
        deleteUser: async (id: string) => {
          deleted.push(id)
          if (world.deleteFails) return { error: { message: 'unavailable' } }
          world.users = world.users.filter((user) => user.id !== id)
          return { error: null }
        },
        listUsers: async () => ({ data: { users: world.users }, error: null }),
      },
    },
    from: (table: string) => ({
      insert: async (row: { user_id?: string }) => {
        if (table !== 'staff') return { error: null }
        if (world.staffInsertFails) return { error: { code: 'XX000' } }
        world.staff.add(row.user_id!)
        return { error: null }
      },
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: world.staff.has(value) ? { user_id: value } : null, error: null }),
        }),
      }),
    }),
  }
  return { deleted }
}

// FABLE-AUDIT T-9: the gates before any action (index.ts, step 1). Every request below would write if it got past
// them, so each case also proves the service client was never called.
describe('staff-admin: who may call it', () => {
  const MEMBER = '22222222-2222-4222-8222-222222222222'
  const actions = [
    { action: 'invite', email: 'new@example.com', displayName: 'مها', role: 'editor' },
    { action: 'set_role', userId: MEMBER, role: 'owner' },
    { action: 'set_active', userId: MEMBER, active: false },
  ]

  /** A service client whose every method only counts its calls. */
  function countingClient(): () => number {
    const client = {
      auth: { admin: { createUser: vi.fn(), updateUserById: vi.fn(), deleteUser: vi.fn(), listUsers: vi.fn() } },
      from: vi.fn(),
      rpc: vi.fn(),
    }
    hoisted.client = client
    const methods = [...Object.values(client.auth.admin), client.from, client.rpc]
    return () => methods.reduce((sum, method) => sum + method.mock.calls.length, 0)
  }

  it.each([
    ['an editor', 'FORBIDDEN', { role: 'editor', recentTotp: true }],
    ['an operations member', 'FORBIDDEN', { role: 'operations', recentTotp: true }],
    ['a member with no active role (revoked, or an unknown role)', 'FORBIDDEN', { role: null, recentTotp: true }],
    ['an owner whose TOTP is not fresh', 'STEP_UP_REQUIRED', { role: 'owner', recentTotp: false }],
  ])('%s is refused with 403 %s before any action, and nothing is called', async (_who, code, identity) => {
    hoisted.identity = { userId: OWNER.userId, ...identity }
    const callsMade = countingClient()
    for (const body of actions) {
      const response = await send(JSON.stringify(body))
      expect(response.status, body.action).toBe(403)
      expect(await response.json(), body.action).toMatchObject({ ok: false, error: { code } })
    }
    expect(callsMade()).toBe(0)
  })

  it('no identity (a missing, bad or expired token) is 401 UNAUTHENTICATED, and nothing is called', async () => {
    hoisted.identity = null
    const callsMade = countingClient()
    for (const body of actions) {
      const response = await send(JSON.stringify(body))
      expect(response.status, body.action).toBe(401)
      expect(await response.json(), body.action).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    }
    expect(callsMade()).toBe(0)
  })
})

describe('staff-admin: the request body', () => {
  it.each(['null', '[]', '"invite"', '7'])('a %s body is 400 BAD_JSON, not an unhandled TypeError', async (body) => {
    install({ users: [], staff: new Set(), staffInsertFails: false, deleteFails: false })
    const response = await send(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAD_JSON' } })
  })
})

describe('staff-admin: invite', () => {
  it('an auth user orphaned by a failed rollback is finished by the next invite, not blocked as USER_EXISTS', async () => {
    const world: World = { users: [], staff: new Set(), staffInsertFails: true, deleteFails: true }
    install(world)
    // The staff insert fails and so does the rollback delete: an orphan remains.
    expect((await invite('maha@example.com')).status).toBe(500)
    expect(world.users).toHaveLength(1)
    expect(world.staff.size).toBe(0)

    world.staffInsertFails = false
    world.deleteFails = false
    const retry = await invite('Maha@Example.com')
    expect(retry.status).toBe(200)
    const { data } = (await retry.json()) as { data: { userId: string } }
    expect(data.userId).toBe(world.users[0]!.id)
    expect(world.users).toHaveLength(1)
    expect(world.staff.has(data.userId)).toBe(true)
  })

  it('an address that belongs to a real member is still USER_EXISTS, and nothing is written', async () => {
    const member = { id: randomUUID(), email: 'owner@example.com' }
    const world: World = { users: [member], staff: new Set([member.id]), staffInsertFails: false, deleteFails: false }
    const { deleted } = install(world)
    const response = await invite('owner@example.com')
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'USER_EXISTS' } })
    expect(world.staff.size).toBe(1)
    expect(deleted).toEqual([])
  })

  it('a failed staff insert for a new user rolls the new auth user back', async () => {
    const world: World = { users: [], staff: new Set(), staffInsertFails: true, deleteFails: false }
    const { deleted } = install(world)
    expect((await invite('new@example.com')).status).toBe(500)
    expect(deleted).toHaveLength(1)
    expect(world.users).toHaveLength(0)
  })
})

// FABLE-AUDIT F1-8 and F1-9: a revoke ends the member's sessions once the ban holds (a restore lifts the ban, and must
// not bring back a session left open), and a ban that fails leaves the member revocable again. F3-12: what the reply says of
// that rollback rests on the rollback's own result, and the audit row records it.
describe('staff-admin: set_active', () => {
  const MEMBER = '22222222-2222-4222-8222-222222222222'

  interface ActiveWorld {
    active: Map<string, boolean>
    banFails: boolean
    /** The update that puts the member back to active (after a ban that failed) fails, or matches no member. */
    rollbackFails: boolean
    rollbackEmpty: boolean
    /** The last-owner trigger refuses the revoke (23514). */
    lastOwner: boolean
    sessionsFail: boolean
    bans: string[]
    rpcs: Array<[string, Record<string, unknown>]>
    audits: Array<{ action: string; summary: Record<string, unknown> }>
  }

  /** A fake service client over one staff table, the auth bans, the audit table and `staff_sessions_end`. */
  function installActive(over: Partial<ActiveWorld> = {}): ActiveWorld {
    const world: ActiveWorld = { active: new Map([[MEMBER, true]]), banFails: false, rollbackFails: false, rollbackEmpty: false, lastOwner: false, sessionsFail: false, bans: [], rpcs: [], audits: [], ...over }
    hoisted.client = {
      auth: {
        admin: {
          updateUserById: async (_id: string, attributes: { ban_duration: string }) => {
            world.bans.push(attributes.ban_duration)
            return { data: {}, error: world.banFails && attributes.ban_duration !== 'none' ? { message: 'auth unavailable' } : null }
          },
        },
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        world.rpcs.push([fn, args])
        return world.sessionsFail ? { data: null, error: { message: 'down', code: 'XX000' } } : { data: 1, error: null }
      },
      from: (table: string) => ({
        insert: async (row: { action: string; summary: Record<string, unknown> }) => {
          if (table === 'audit_events') world.audits.push({ action: row.action, summary: row.summary })
          return { error: null }
        },
        update: (values: { active: boolean }) => {
          // The filters of `.eq(...)`, in order: the member, and for a revoke the state it must still have (`active` true).
          const filters: Array<[string, unknown]> = []
          const apply = () => {
            const userId = filters.find(([column]) => column === 'user_id')?.[1] as string
            const onlyWhile = filters.find(([column]) => column === 'active')
            if (world.rollbackFails && values.active) return { data: null, error: { code: 'XX000', message: 'database down' } }
            if (world.lastOwner && !values.active) return { data: null, error: { code: '23514', message: 'At least one active owner is required.' } }
            if (world.rollbackEmpty && values.active) return { data: [], error: null }
            if (!world.active.has(userId)) return { data: [], error: null }
            if (onlyWhile !== undefined && world.active.get(userId) !== onlyWhile[1]) return { data: [], error: null }
            world.active.set(userId, values.active)
            return { data: [{ user_id: userId }], error: null }
          }
          // Awaited with `.select()` (the change) or as it is (the rollback), like the query builder.
          const builder = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value])
              return builder
            },
            select: async () => apply(),
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(apply).then(resolve, reject),
          }
          return builder
        },
        // Whether a member exists, read after a revoke that changed nothing.
        select: () => ({ eq: async (_column: string, userId: string) => ({ data: world.active.has(userId) ? [{ user_id: userId }] : [], error: null }) }),
      }),
    }
    return world
  }

  const setActive = (active: boolean) => send(JSON.stringify({ action: 'set_active', userId: MEMBER, active }))

  it('a revoke bans the member, then ends their sessions, and the audit row says both', async () => {
    const world = installActive()
    const response = await setActive(false)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { userId: MEMBER, active: false } })
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.bans).toEqual(['876000h'])
    expect(world.rpcs).toEqual([['staff_sessions_end', { p_user: MEMBER }]])
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: true, sessionsEnded: true } }])
  })

  it('sessions that cannot be ended answer SESSIONS_FAILED after the audit row, which says so; the member stays revoked and banned', async () => {
    const world = installActive({ sessionsFail: true })
    const response = await setActive(false)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'SESSIONS_FAILED', message: 'أُوقف الدخول لكن تعذّر إنهاء الجلسات المفتوحة. حاول مرة أخرى.' },
    })
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: true, sessionsEnded: false } }])
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.bans).toEqual(['876000h'])
  })

  it('a ban that fails puts the member back to active, so the revoke can be tried again; BAN_FAILED says the state is unchanged, banApplied false, rolledBack true, no session is touched', async () => {
    const world = installActive({ banFails: true })
    const response = await setActive(false)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'BAN_FAILED', message: 'تعذّر إيقاف الدخول؛ لم تتغيّر حالة العضو. حاول مرة أخرى.' },
    })
    expect(world.active.get(MEMBER)).toBe(true)
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: false, rolledBack: true } }])

    // «حاول مرة أخرى» can be followed: the member is still revocable, and the next revoke goes through.
    world.banFails = false
    expect((await setActive(false)).status).toBe(200)
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.rpcs).toEqual([['staff_sessions_end', { p_user: MEMBER }]])
  })

  it('a ban that fails and a rollback that fails too: the reply does not claim the state is unchanged, the audit row says so, and the revoke can be asked again', async () => {
    const world = installActive({ banFails: true, rollbackFails: true })
    const response = await setActive(false)
    expect(response.status).toBe(500)
    const reply = (await response.json()) as { ok: false; error: { code: string; message: string } }
    expect(reply.error).toEqual({ code: 'ROLLBACK_FAILED', message: 'حُدّثت الحالة لكن تعذّر إيقاف الدخول. حاول مرة أخرى.' })
    expect(reply.error.message).not.toContain('لم تتغيّر')
    // What the message says is what is true: the member is revoked in the table and not banned, and no session was touched.
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: false, rolledBack: false } }])

    // «حاول مرة أخرى»: the same revoke, once the Auth API answers, ends the job (the update and the ban are idempotent).
    world.banFails = false
    world.rollbackFails = false
    expect((await setActive(false)).status).toBe(200)
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.bans).toEqual(['876000h', '876000h'])
    expect(world.rpcs).toEqual([['staff_sessions_end', { p_user: MEMBER }]])
    expect(world.audits.at(-1)).toEqual({ action: 'staff.revoke', summary: { banApplied: true, sessionsEnded: true } })
  })

  it('«حاول مرة أخرى» on a member already revoked never brings them back: a ban that fails then answers BAN_INCOMPLETE, rolls nothing back and ends no session', async () => {
    // SESSIONS_FAILED or ROLLBACK_FAILED left the member revoked (the handler reads no earlier ban); the retry's ban fails.
    const world = installActive({ active: new Map([[MEMBER, false]]), banFails: true })
    const response = await setActive(false)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'BAN_INCOMPLETE', message: 'لم يكتمل إيقاف الدخول؛ العضو ما زال موقوفًا. حاول مرة أخرى.' },
    })
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: false, alreadyRevoked: true } }])

    // And once the Auth API answers, the same retry finishes the revoke.
    world.banFails = false
    expect((await setActive(false)).status).toBe(200)
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.rpcs).toEqual([['staff_sessions_end', { p_user: MEMBER }]])
    expect(world.audits.at(-1)).toEqual({ action: 'staff.revoke', summary: { banApplied: true, sessionsEnded: true } })
  })

  it('a revoke of the last active owner is refused by the trigger: 409 LAST_OWNER, nothing banned, ended or audited', async () => {
    const world = installActive({ lastOwner: true })
    const response = await setActive(false)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'LAST_OWNER' } })
    expect(world.active.get(MEMBER)).toBe(true)
    expect(world.bans).toEqual([])
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([])
  })

  it('a revoke of a member who does not exist is NOT_FOUND and bans nothing', async () => {
    const world = installActive({ active: new Map() })
    const response = await setActive(false)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(world.bans).toEqual([])
    expect(world.audits).toEqual([])
  })

  it('a rollback that matched no member does not count as one that held', async () => {
    // The member vanished between the update and the rollback: the update answers without an error and puts nothing back.
    const world = installActive({ banFails: true, rollbackEmpty: true })
    const response = await setActive(false)
    expect(await response.json()).toMatchObject({ error: { code: 'ROLLBACK_FAILED' } })
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: false, rolledBack: false } }])
  })

  it('a restore lifts the ban and ends nothing', async () => {
    const world = installActive({ active: new Map([[MEMBER, false]]) })
    const response = await setActive(true)
    expect(response.status).toBe(200)
    expect(world.active.get(MEMBER)).toBe(true)
    expect(world.bans).toEqual(['none'])
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([{ action: 'staff.restore', summary: { banApplied: true } }])
  })
})
