// P07 round 2: the owner's policy approval
// (`public.commerce_policies_approve`, migration 20260927170000). The
// grants are read straight from the catalog; the SQL function's own guards
// run as the roles that really call them (`service_role` through a direct
// session that connects as the local superuser and switches role, like the
// Edge Function would). Everything that touches the one settings row or the
// published policies runs inside a transaction that is rolled back, and the
// `finance.commerce_settings` row is saved before and restored after the
// whole file as a second net.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaff, pgRpc, serviceRoleDb } from './support'

let postgres: Client
let serviceDb: Client
let savedSettings: Record<string, unknown>

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  serviceDb = await serviceRoleDb()
  savedSettings = (
    await postgres.query(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  ).rows[0]!
})

afterAll(async () => {
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_address = $3,
       seller_registration = $4, policy_revisions = $5::jsonb, version = $6, configured_at = $7, approved_by = $8
     where id = 1`,
    [
      savedSettings.checkout_enabled,
      savedSettings.seller_legal_name,
      savedSettings.seller_address,
      savedSettings.seller_registration,
      JSON.stringify(savedSettings.policy_revisions),
      savedSettings.version,
      savedSettings.configured_at,
      savedSettings.approved_by,
    ],
  )
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

/** The service-role session's own role: the local superuser it connected as. */
async function asPostgres(body: () => Promise<void>): Promise<void> {
  await serviceDb.query('set local role postgres')
  try {
    await body()
  } finally {
    await serviceDb.query('set local role service_role')
  }
}

async function settingsVersion(): Promise<number> {
  let version = 0
  await asPostgres(async () => {
    const result = await serviceDb.query<{ version: number }>('select version from finance.commerce_settings where id = 1')
    version = result.rows[0]!.version
  })
  return version
}

/** Publishes a fresh policy version the way the seed does (as the superuser). */
async function publishPolicy(docId: string): Promise<number> {
  const next = (
    await serviceDb.query<{ seq: number }>(
      'select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = $1 and doc_id = $2',
      ['policies', docId],
    )
  ).rows[0]!.seq
  await serviceDb.query(
    "insert into public.content_versions (collection, doc_id, seq, data) values ('policies', $1, $2, $3::jsonb)",
    [docId, next, JSON.stringify({ title: `سياسة ${docId}`, body: { root: { type: 'root', children: [] } } })],
  )
  await serviceDb.query('select public.content_go_live($1, $2, $3)', ['policies', docId, next])
  return next
}

const APPROVE = 'public.commerce_policies_approve(uuid, integer)'

describe('grants (D32)', () => {
  it('only service_role executes the approval', async () => {
    expect(await canExecute('service_role', APPROVE)).toBe(true)
    for (const role of ['authenticated', 'anon']) {
      expect(await canExecute(role, APPROVE)).toBe(false)
    }
  })
})

describe('commerce_policies_approve', () => {
  it('refuses an actor who is not an active owner (42501)', async () => {
    const editor = await createStaff('editor')
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: editor.userId, p_expected_version: 0 }),
      ).rejects.toMatchObject({ code: '42501' }),
    )
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', {
          p_actor: '00000000-0000-0000-0000-000000000000',
          p_expected_version: 0,
        }),
      ).rejects.toMatchObject({ code: '42501' }),
    )
  })

  it('a stale expected version raises 40001 before anything is written', async () => {
    const owner = await createStaff('owner')
    // One failing call per transaction: a refused statement aborts it.
    await rolledBack(serviceDb, async () => {
      const before = await settingsVersion()
      await expect(
        pgRpc(serviceDb)('commerce_policies_approve', {
          p_actor: owner.userId,
          p_expected_version: before + 5,
        }),
      ).rejects.toMatchObject({ code: '40001' })
    })
    // A missing version is a conflict too, never a blind overwrite.
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: null }),
      ).rejects.toMatchObject({ code: '40001' }),
    )
  })

  it('a missing required policy raises P0001 with its message', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
      })
      const before = await settingsVersion()
      await expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: before }),
      ).rejects.toMatchObject({ code: 'P0001', message: 'Publish the store, delivery and refund policies first.' })
    })
  })

  it('approves the published seqs, includes privacy only when published, and writes exactly one audit row', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      // A controlled set of published policies: the three required ones, and
      // privacy left unpublished for the first approval.
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
      })
      let store = 0
      let delivery = 0
      let refund = 0
      await asPostgres(async () => {
        store = await publishPolicy('store')
        delivery = await publishPolicy('delivery')
        refund = await publishPolicy('refund')
      })
      const before = await settingsVersion()

      const first = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: before,
      })) as { version: number; policyRevisions: Record<string, number> }
      expect(first.version).toBe(before + 1)
      expect(first.policyRevisions).toEqual({ store, delivery, refund })
      expect(first.policyRevisions).not.toHaveProperty('privacy')

      let privacy = 0
      await asPostgres(async () => {
        const row = (
          await serviceDb.query<{ policy_revisions: Record<string, number>; approved_by: string; configured_at: string | null }>(
            'select policy_revisions, approved_by, configured_at from finance.commerce_settings where id = 1',
          )
        ).rows[0]!
        expect(row.policy_revisions).toEqual({ store, delivery, refund })
        expect(row.approved_by).toBe(owner.userId)
        expect(row.configured_at).not.toBeNull()

        const audit = (
          await serviceDb.query<{ summary: unknown }>(
            "select summary from public.audit_events where action = 'commerce.policies' and actor = $1",
            [owner.userId],
          )
        ).rows
        expect(audit.length).toBe(1)
        expect(audit[0]!.summary).toEqual({ version: before + 1, revisions: { store, delivery, refund } })

        // Privacy published now: the next approval includes it.
        privacy = await publishPolicy('privacy')
      })
      const second = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: before + 1,
      })) as { version: number; policyRevisions: Record<string, number> }
      expect(second.version).toBe(before + 2)
      expect(second.policyRevisions).toEqual({ store, delivery, refund, privacy })
    })
  })
})
