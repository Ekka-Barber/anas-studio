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

  // FABLE-AUDIT M1b: a policy published after the approval closes the store while the switch still says on, so the
  // admin reads whether checkout is really open, by the cart's own rule, and why it is not.
  it('says whether checkout is open by the cart\'s own rule, and why not: the switch, then the seller, then the policies', async () => {
    const owner = await createStaff('owner')
    type State = { enabled: boolean; name: string | null; registration: string | null; policies: Record<string, number> }
    const open: State = { enabled: true, name: 'بائع', registration: 'REG-1', policies: { store: 1, delivery: 1, refund: 1 } }
    const cases: Array<[string, State, string | null]> = [
      ['everything set', open, null],
      ['the switch off', { ...open, enabled: false }, 'SWITCH_OFF'],
      ['the switch off and nothing else set either', { enabled: false, name: null, registration: null, policies: {} }, 'SWITCH_OFF'],
      ['no seller name', { ...open, name: null }, 'SELLER_UNSET'],
      ['no registration', { ...open, registration: null }, 'SELLER_UNSET'],
      ['no seller and no approved policies', { ...open, registration: null, policies: {} }, 'SELLER_UNSET'],
      ['a policy published since the approval', { ...open, policies: {} }, 'POLICIES_UNAPPROVED'],
    ]
    await rolledBack(serviceDb, async () => {
      for (const [label, state, reason] of cases) {
        await serviceDb.query('set local role postgres')
        await serviceDb.query(
          'update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_registration = $3, policy_revisions = $4::jsonb where id = 1',
          [state.enabled, state.name, state.registration, JSON.stringify(state.policies)],
        )
        // What the cart is told, as the checkout function asks (an empty cart still says whether the store is open).
        await serviceDb.query('set local role service_role')
        const quoted = (await serviceDb.query<{ r: { checkoutEnabled: boolean } }>("select public.checkout_quote($1, '[]'::jsonb, null, null) as r", ['c'.repeat(64)])).rows[0]!.r
        // What the owner's settings screen reads.
        await serviceDb.query('set local role authenticated')
        await serviceDb.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.userId, role: 'authenticated' })])
        const settings = (await serviceDb.query<{ r: Record<string, unknown> }>('select public.commerce_settings_get() as r')).rows[0]!.r
        await serviceDb.query('set local role service_role')
        expect(settings, label).toMatchObject({ checkoutOpen: reason === null, checkoutClosedReason: reason })
        expect(settings.checkoutOpen, label).toBe(quoted.checkoutEnabled)
      }
    })
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

// --- the owner's checkout switch (P08 round 4) --------------------------------------------------------------

const CHECKOUT_SET = 'public.commerce_checkout_set(uuid, integer, boolean)'
const REVISIONS = { store: 1, delivery: 1, refund: 1 }

type Row = {
  checkout_enabled: boolean
  seller_legal_name: string | null
  seller_registration: string | null
  policy_revisions: Record<string, number>
  version: number
}
type Setup = { enabled?: boolean; name?: string | null; registration?: string | null; policies?: Record<string, number> }

/** Writes the row the way only the migration role can (inside a rolled-back transaction), then returns to `service_role`. */
async function setRow(values: Setup): Promise<void> {
  await serviceDb.query('set local role postgres')
  await serviceDb.query(
    `update finance.commerce_settings
        set checkout_enabled = $1, seller_legal_name = $2, seller_registration = $3, policy_revisions = $4::jsonb
      where id = 1`,
    [values.enabled ?? false, values.name === undefined ? 'بائع' : values.name, values.registration === undefined ? 'REG-1' : values.registration, JSON.stringify(values.policies ?? REVISIONS)],
  )
  await serviceDb.query('set local role service_role')
}

async function readRow(): Promise<Row> {
  await serviceDb.query('set local role postgres')
  const result = await serviceDb.query<Row>(
    'select checkout_enabled, seller_legal_name, seller_registration, policy_revisions, version from finance.commerce_settings where id = 1',
  )
  await serviceDb.query('set local role service_role')
  return result.rows[0]!
}

async function switchAudit(actor: string): Promise<Array<{ enabled: boolean; version: number }>> {
  await serviceDb.query('set local role postgres')
  const result = await serviceDb.query<{ summary: { enabled: boolean; version: number } }>(
    "select summary from public.audit_events where action = 'commerce.checkout' and entity = 'commerce_settings' and entity_id = '1' and actor = $1 order by id",
    [actor],
  )
  await serviceDb.query('set local role service_role')
  return result.rows.map((row) => row.summary)
}

describe('commerce_checkout_set (the owner\'s switch)', () => {
  // One set of staff for the whole block, and its owner retired at the end: the shared local database keeps every
  // active owner a test makes, and a long list of them slows the staff-admin tests down.
  let owner: { userId: string; email: string }
  let editor: { userId: string; email: string }
  let operations: { userId: string; email: string }
  let retired: { userId: string; email: string }
  beforeAll(async () => {
    owner = await createStaff('owner')
    editor = await createStaff('editor')
    operations = await createStaff('operations')
    retired = await createStaff('owner', { active: false })
  })
  afterAll(async () => {
    // (Only while another owner remains: a database that has none keeps this run's.)
    await postgres.query(
      `update public.staff set active = false
        where user_id = $1
          and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> $1)`,
      [owner.userId],
    )
  })

  it('is for service_role only: the admin function calls it after the TOTP step-up', async () => {
    expect(await canExecute('service_role', CHECKOUT_SET)).toBe(true)
    expect(await canExecute('authenticated', CHECKOUT_SET)).toBe(false)
    expect(await canExecute('anon', CHECKOUT_SET)).toBe(false)
    const client = await signIn(editor.email)
    expect((await client.rpc('commerce_checkout_set', { p_actor: editor.userId, p_expected_version: 0, p_enabled: true })).error).toBeTruthy()
    expect((await anonClient().rpc('commerce_checkout_set', { p_actor: editor.userId, p_expected_version: 0, p_enabled: true })).error).toBeTruthy()
  })

  it('refuses an actor who is not an active owner (42501), and writes nothing', async () => {
    // One failing call per transaction: a refused statement aborts it.
    for (const actor of [editor.userId, operations.userId, retired.userId, '00000000-0000-0000-0000-000000000000']) {
      await rolledBack(serviceDb, async () => {
        await setRow({ enabled: false })
        await expect(
          pgRpc(serviceDb)('commerce_checkout_set', { p_actor: actor, p_expected_version: (await readRow()).version, p_enabled: true }),
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
    expect((await postgres.query("select 1 from public.audit_events where action = 'commerce.checkout' and actor = any($1::uuid[])", [[editor.userId, operations.userId, retired.userId]])).rowCount).toBe(0)
  })

  it('a stale or missing expected version raises 23505 before anything is written; a missing flag is refused too', async () => {
    await rolledBack(serviceDb, async () => {
      await setRow({ enabled: false })
      const before = (await readRow()).version
      await expect(
        pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: before + 5, p_enabled: true }),
      ).rejects.toMatchObject({ code: '23505' })
    })
    await rolledBack(serviceDb, () =>
      expect(pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: null, p_enabled: false })).rejects.toMatchObject({ code: '23505' }),
    )
    await rolledBack(serviceDb, async () => {
      const before = await currentVersion()
      await expect(
        pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: before, p_enabled: null }),
      ).rejects.toMatchObject({ code: '22023' })
    })
  })

  // 40001 never answers through PostgREST (it retries without bound), so the conflict is 23505, which it maps to 409.
  it('a stale expected version answers 23505 promptly through the Data API, not a hang', async () => {
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8_000))
    const reply = await Promise.race([
      serviceClient.rpc('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: -1, p_enabled: false }),
      timeout,
    ])
    expect(reply).not.toBe('timeout')
    expect((reply as { error: { code: string } | null }).error?.code).toBe('23505')
  }, 20_000)

  it('turning it on needs the seller named, the registration and the approved policies, each on its own; a refusal changes nothing', async () => {
    const missing: Array<[string, Setup]> = [
      ['the seller name', { name: null }],
      ['the registration', { registration: null }],
      ['the approved policies', { policies: {} }],
      ['everything', { name: null, registration: null, policies: {} }],
    ]
    for (const [label, setup] of missing) {
      await rolledBack(serviceDb, async () => {
        await setRow({ enabled: false, ...setup })
        const before = await readRow()
        await serviceDb.query('savepoint refused')
        await expect(
          pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: before.version, p_enabled: true }),
          label,
        ).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/seller.*polic/i) })
        await serviceDb.query('rollback to savepoint refused')
        expect(await readRow(), label).toEqual(before)
        expect(await switchAudit(owner.userId), label).toEqual([])
      })
    }
  })

  it('on and off bump the version and are audited with the flag and the new version; off needs nothing; a settings save made before is stale', async () => {
    await rolledBack(serviceDb, async () => {
      await setRow({ enabled: false })
      const before = await readRow()
      const on = (await pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: before.version, p_enabled: true })) as number
      expect(on).toBe(before.version + 1)
      expect(await readRow()).toMatchObject({ checkout_enabled: true, version: before.version + 1, seller_legal_name: 'بائع', seller_registration: 'REG-1', policy_revisions: REVISIONS })

      // Turning it on again is the same state at the next version.
      const again = (await pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: on, p_enabled: true })) as number
      expect(again).toBe(on + 1)

      // Closing the store needs no seller and no policies: an owner can always stop sales.
      await setRow({ enabled: true, name: null, registration: null, policies: {} })
      const off = (await pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: again, p_enabled: false })) as number
      expect(off).toBe(again + 1)
      expect(await readRow()).toMatchObject({ checkout_enabled: false, version: again + 1 })
      expect(await switchAudit(owner.userId)).toEqual([
        { enabled: true, version: on },
        { enabled: true, version: again },
        { enabled: false, version: off },
      ])

      // The version is the settings form's guard too: a form read before the switch moved cannot overwrite it.
      await expect(
        pgRpc(serviceDb)('commerce_settings_save', {
          p_actor: owner.userId,
          p_expected_version: before.version,
          p_seller_legal_name: 'بائع',
          p_seller_address: null,
          p_seller_registration: null,
        }),
      ).rejects.toMatchObject({ code: '23505' })
    })
  })

  it('the audit row names no secret and no seller detail: the flag and the version only', async () => {
    await rolledBack(serviceDb, async () => {
      await setRow({ enabled: false, name: 'اسم البائع الخاص', registration: 'REG-SECRET-7' })
      await pgRpc(serviceDb)('commerce_checkout_set', { p_actor: owner.userId, p_expected_version: (await readRow()).version, p_enabled: true })
      await serviceDb.query('set local role postgres')
      const row = (
        await serviceDb.query<{ summary: unknown }>("select summary from public.audit_events where action = 'commerce.checkout' and actor = $1", [owner.userId])
      ).rows[0]!
      await serviceDb.query('set local role service_role')
      expect(Object.keys(row.summary as object).sort()).toEqual(['enabled', 'version'])
      expect(JSON.stringify(row.summary)).not.toMatch(/REG-SECRET|اسم البائع/)
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
