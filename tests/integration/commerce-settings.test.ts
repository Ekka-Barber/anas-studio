// P06 round 3: the commerce settings singleton (D34; no tax anywhere). The
// grants are read straight from the catalog, the SQL functions' own guards
// run as the roles that really call them (real JWTs through the Data API,
// `service_role` through a direct session), and everything that touches the
// one row runs inside a transaction that is rolled back, so the shared local
// database is left as it was.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createStaff, pgRpc, serviceClient, serviceRoleDb, signIn } from './support'

let postgres: Client
let serviceDb: Client

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  serviceDb = await serviceRoleDb()
})

afterAll(async () => {
  await postgres.end()
  await serviceDb.end()
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
async function rolledBack(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin')
  try {
    await body()
  } finally {
    await client.query('rollback')
  }
}

async function currentVersion(): Promise<number> {
  // The service role has no USAGE on `finance` (the functions are security
  // definer), so the row is read as the superuser this session is.
  await serviceDb.query('set local role postgres')
  const result = await serviceDb.query<{ version: number }>('select version from finance.commerce_settings where id = 1')
  await serviceDb.query('set local role service_role')
  return result.rows[0]!.version
}

const SAVE = 'public.commerce_settings_save(uuid, integer, text, text, text)'

describe('grants (D32)', () => {
  it('no API role has any grant on the table', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['select', 'insert', 'update', 'delete']) {
        const result = await postgres.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [
          role,
          'finance.commerce_settings',
          privilege,
        ])
        expect(result.rows[0]!.ok, `${role} ${privilege} on finance.commerce_settings`).toBe(false)
      }
    }
  })

  it('commerce_settings_get: authenticated only; the save: service_role only', async () => {
    expect(await canExecute('authenticated', 'public.commerce_settings_get()')).toBe(true)
    expect(await canExecute('anon', 'public.commerce_settings_get()')).toBe(false)
    expect(await canExecute('service_role', SAVE)).toBe(true)
    expect(await canExecute('authenticated', SAVE)).toBe(false)
    expect(await canExecute('anon', SAVE)).toBe(false)
  })
})

describe('commerce_settings_get', () => {
  it('an editor or operations member gets nothing', async () => {
    for (const role of ['editor', 'operations'] as const) {
      const member = await createStaff(role)
      const client = await signIn(member.email)
      expect((await client.rpc('commerce_settings_get')).error, role).toBeTruthy()
    }
  })

  it('the owner reads the singleton row, anon cannot', async () => {
    const owner = await createStaff('owner')
    const client = await signIn(owner.email)
    const { data, error } = await client.rpc('commerce_settings_get')
    expect(error).toBeNull()
    // The row as it stands (the local demo seed, D37, may have filled it).
    const row = (
      await postgres.query<{ checkout_enabled: boolean; version: number; policy_revisions: unknown }>(
        'select checkout_enabled, version, policy_revisions from finance.commerce_settings where id = 1',
      )
    ).rows[0]!
    expect(data).toMatchObject({
      checkoutEnabled: row.checkout_enabled,
      currency: 'SAR',
      version: row.version,
      policyRevisions: row.policy_revisions,
    })
    expect((await anonClient().rpc('commerce_settings_get')).error).toBeTruthy()
  })
})

describe('commerce_settings_save', () => {
  it('refuses an actor who is not an active owner (42501)', async () => {
    const editor = await createStaff('editor')
    const rpc = pgRpc(serviceDb)
    // One failing call per transaction: a refused statement aborts it.
    for (const actor of [editor.userId, '00000000-0000-0000-0000-000000000000']) {
      await rolledBack(serviceDb, () =>
        expect(
          rpc('commerce_settings_save', {
            p_actor: actor,
            p_expected_version: 0,
            p_seller_legal_name: 'بائع',
            p_seller_address: null,
            p_seller_registration: null,
          }),
        ).rejects.toMatchObject({ code: '42501' }),
      )
    }
  })

  it('has no grant for an authenticated session through the Data API', async () => {
    const editor = await createStaff('editor')
    const client = await signIn(editor.email)
    const { error } = await client.rpc('commerce_settings_save', {
      p_actor: editor.userId,
      p_expected_version: 0,
      p_seller_legal_name: 'بائع',
      p_seller_address: null,
      p_seller_registration: null,
    })
    expect(error).toBeTruthy()
  })

  it('a stale expected version raises 23505 (409 over the Data API) before anything is written', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      const before = await currentVersion()
      await expect(
        pgRpc(serviceDb)('commerce_settings_save', {
          p_actor: owner.userId,
          p_expected_version: before + 5,
          p_seller_legal_name: 'بائع',
          p_seller_address: null,
          p_seller_registration: null,
        }),
      ).rejects.toMatchObject({ code: '23505' })
    })
    // A missing version is a conflict too, never a blind overwrite.
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_settings_save', {
          p_actor: owner.userId,
          p_expected_version: null,
          p_seller_legal_name: 'بائع',
          p_seller_address: null,
          p_seller_registration: null,
        }),
      ).rejects.toMatchObject({ code: '23505' }),
    )
  })

  // A 40001 never answers through PostgREST (it retries the request without
  // bound), so the stale-version conflict is raised as 23505, which it maps to
  // 409. The race guards a hang: a failing run times out instead of hanging.
  it('a stale expected version answers 23505 promptly through the Data API, not a hang', async () => {
    const owner = await createStaff('owner')
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8_000))
    const reply = await Promise.race([
      serviceClient.rpc('commerce_settings_save', {
        p_actor: owner.userId,
        // Versions start at 0 and only grow, so -1 is always stale.
        p_expected_version: -1,
        p_seller_legal_name: 'بائع',
        p_seller_address: null,
        p_seller_registration: null,
      }),
      timeout,
    ])
    expect(reply).not.toBe('timeout')
    expect((reply as { error: { code: string } | null }).error?.code).toBe('23505')
  }, 20_000)

  it('a save trims, bumps the version, stamps the actor and time, and writes exactly one audit row', async () => {
    const owner = await createStaff('owner')
    const marker = `${Date.now()}`
    await rolledBack(serviceDb, async () => {
      const before = await currentVersion()
      const version = await pgRpc(serviceDb)('commerce_settings_save', {
        p_actor: owner.userId,
        p_expected_version: before,
        p_seller_legal_name: `  بائع الاختبار ${marker}  `,
        p_seller_address: `الرياض ${marker}`,
        p_seller_registration: marker,
      })
      expect(version).toBe(before + 1)

      // The row and the audit trail, still inside the rolled-back
      // transaction, read as the superuser (no service-role table grants).
      await serviceDb.query('set local role postgres')
      const row = (
        await serviceDb.query<{
          version: number
          configured_at: string | null
          approved_by: string | null
          seller_legal_name: string | null
        }>('select version, configured_at, approved_by, seller_legal_name from finance.commerce_settings where id = 1')
      ).rows[0]!
      expect(row.version).toBe(before + 1)
      expect(row.configured_at).not.toBeNull()
      expect(row.approved_by).toBe(owner.userId)
      expect(row.seller_legal_name).toBe(`بائع الاختبار ${marker}`)

      const audit = (
        await serviceDb.query<{ summary: { version: number; changed: string[] } }>(
          "select summary from public.audit_events where action = 'commerce.settings' and entity = 'commerce_settings' and actor = $1",
          [owner.userId],
        )
      ).rows
      expect(audit.length).toBe(1)
      expect(audit[0]!.summary).toEqual({
        version: before + 1,
        changed: ['seller_legal_name', 'seller_address', 'seller_registration'],
      })
    })
  })

  it('no API path switches checkout on (P07 lifted the table check), and the table refuses any currency but SAR', async () => {
    // The save takes no checkout argument; P08 adds the owner's switch behind
    // the verified gateway.
    const save = await postgres.query<{ args: string }>(
      "select pg_get_function_identity_arguments('public.commerce_settings_save'::regproc) as args",
    )
    expect(save.rows[0]!.args).not.toMatch(/checkout/)
    await rolledBack(postgres, async () => {
      await expect(postgres.query("update finance.commerce_settings set currency = 'USD' where id = 1")).rejects.toMatchObject(
        { code: '23514' },
      )
    })
  })
})

describe('no tax anywhere (D34)', () => {
  it('no column of finance.commerce_settings is named after a tax', async () => {
    const result = await postgres.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'finance' and table_name = 'commerce_settings' and column_name ~* 'tax|vat'`,
    )
    expect(result.rows).toEqual([])
  })
})
