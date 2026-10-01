// staff-admin (D13): a request body that is not a JSON object is 400 BAD_JSON
// instead of a crash (EF-admin-1), and an invite finishes an auth user left
// without a staff row instead of answering USER_EXISTS for ever (GAP-G2-3).
// The function calls `Deno.serve` when imported, so the test captures its
// handler; the owner check and the service client are faked.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

type Handler = (request: Request) => Promise<Response>

const hoisted = vi.hoisted(() => ({ handler: undefined as undefined | ((request: Request) => Promise<Response>), client: undefined as unknown }))

vi.mock('../../supabase/functions/_shared/staff.ts', () => ({
  staffFromRequest: async () => ({ userId: '11111111-1111-4111-8111-111111111111', role: 'owner', recentTotp: true }),
}))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ serviceClient: () => hoisted.client }))

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
