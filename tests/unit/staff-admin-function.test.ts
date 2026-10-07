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
// not bring back a session left open), and a ban that fails leaves the member revocable again.
describe('staff-admin: set_active', () => {
  const MEMBER = '22222222-2222-4222-8222-222222222222'

  interface ActiveWorld {
    active: Map<string, boolean>
    banFails: boolean
    sessionsFail: boolean
    bans: string[]
    rpcs: Array<[string, Record<string, unknown>]>
    audits: Array<{ action: string; summary: Record<string, unknown> }>
  }

  /** A fake service client over one staff table, the auth bans, the audit table and `staff_sessions_end`. */
  function installActive(over: Partial<ActiveWorld> = {}): ActiveWorld {
    const world: ActiveWorld = { active: new Map([[MEMBER, true]]), banFails: false, sessionsFail: false, bans: [], rpcs: [], audits: [], ...over }
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
        update: (values: { active: boolean }) => ({
          eq: (_column: string, userId: string) => {
            const apply = () => {
              if (!world.active.has(userId)) return { data: [], error: null }
              world.active.set(userId, values.active)
              return { data: [{ user_id: userId }], error: null }
            }
            // Awaited with `.select()` (the change) or as it is (the rollback), like the query builder.
            return {
              select: async () => apply(),
              then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(apply).then(resolve, reject),
            }
          },
        }),
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

  it('a ban that fails puts the member back to active, so the revoke can be tried again; BAN_FAILED, banApplied false, no session is touched', async () => {
    const world = installActive({ banFails: true })
    const response = await setActive(false)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAN_FAILED' } })
    expect(world.active.get(MEMBER)).toBe(true)
    expect(world.rpcs).toEqual([])
    expect(world.audits).toEqual([{ action: 'staff.revoke', summary: { banApplied: false } }])

    // «حاول مرة أخرى» can be followed: the member is still revocable, and the next revoke goes through.
    world.banFails = false
    expect((await setActive(false)).status).toBe(200)
    expect(world.active.get(MEMBER)).toBe(false)
    expect(world.rpcs).toEqual([['staff_sessions_end', { p_user: MEMBER }]])
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
