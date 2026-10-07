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

import { createStaff, pgRpc, serviceClient, serviceRoleDb, settledWithin } from './support'

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

/** The `policies_reset` owner alerts queued for one change (`<policy>:<seq>`, or `<policy>:removed`). */
async function resetAlerts(subject: string): Promise<Array<{ recipient: string; payload: unknown }>> {
  return (
    await serviceDb.query<{ recipient: string; payload: unknown }>(
      "select recipient, payload from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1 order by id",
      [`policies_reset:${subject}:%`],
    )
  ).rows
}

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

  it('a stale expected version raises 23505 (409 over the Data API) before anything is written', async () => {
    const owner = await createStaff('owner')
    // One failing call per transaction: a refused statement aborts it.
    await rolledBack(serviceDb, async () => {
      const before = await settingsVersion()
      await expect(
        pgRpc(serviceDb)('commerce_policies_approve', {
          p_actor: owner.userId,
          p_expected_version: before + 5,
        }),
      ).rejects.toMatchObject({ code: '23505' })
    })
    // A missing version is a conflict too, never a blind overwrite.
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: null }),
      ).rejects.toMatchObject({ code: '23505' }),
    )
  })

  // A 40001 never answers through PostgREST (it retries the request without
  // bound), so a stale approval is raised as 23505, which it maps to 409.
  it('a stale expected version answers 23505 promptly through the Data API, not a hang', async () => {
    const owner = await createStaff('owner')
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8_000))
    const reply = await Promise.race([
      // Versions start at 0 and only grow, so -1 is always stale.
      serviceClient.rpc('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: -1 }),
      timeout,
    ])
    expect(reply).not.toBe('timeout')
    expect((reply as { error: { code: string } | null }).error?.code).toBe('23505')
  }, 20_000)

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

// FABLE-AUDIT M2-8 (DB-COMMERCE-05, GAP-G5-3): a policy publish and an approval serialise on the settings row. The
// trigger of the publish matched no row, and so locked nothing, while the approval set was empty: a first approval that
// overlapped a publish read the old seq and pinned it. This race needs two sessions that commit, so it runs on the
// seeded policies (the demo catalog publishes them) and puts back the live store policy itself; the settings row is
// restored after the file.
describe('a policy publish that overlaps an approval', () => {
  it('an approval that starts while a publish of one policy holds the settings row waits for it, then approves the new seq, never the old one', async () => {
    const owner = await createStaff('owner')
    const live = (await postgres.query("select seq, data from public.published_documents where collection = 'policies' and doc_id = 'store'")).rows[0]
    const required = (await postgres.query("select doc_id from public.published_documents where collection = 'policies' and doc_id in ('store', 'delivery', 'refund')")).rows
    expect(required, 'the seeded store, delivery and refund policies').toHaveLength(3)
    // A first approval: nothing approved yet, and the switch off, so a reset tells nobody.
    await postgres.query("update finance.commerce_settings set policy_revisions = '{}'::jsonb, checkout_enabled = false where id = 1")
    const version = (await postgres.query('select version from finance.commerce_settings where id = 1')).rows[0].version as number
    const publisher = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
    await publisher.connect()
    let next = 0
    let open = false
    try {
      // The publish: a new version of the store policy goes live in a transaction that is still open.
      await publisher.query('begin')
      open = true
      next = (await publisher.query("select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = 'policies' and doc_id = 'store'")).rows[0].seq
      await publisher.query("insert into public.content_versions (collection, doc_id, seq, data) values ('policies', 'store', $1, $2::jsonb)", [
        next,
        JSON.stringify({ title: 'سياسة store', body: { root: { type: 'root', children: [] } } }),
      ])
      await publisher.query("select public.content_go_live('policies', 'store', $1)", [next])

      // The owner approves meanwhile, as the Edge Function does: it waits for the publish.
      const approval = pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: version }) as Promise<{
        version: number
        policyRevisions: Record<string, number>
      }>
      approval.catch(() => undefined)
      expect(await settledWithin(approval, 900)).toBe('blocked')
      await publisher.query('commit')
      open = false

      // Then it reads what the publish committed: the new seq is approved, not the one the publish replaced.
      const approved = await approval
      expect(approved.version).toBe(version + 1)
      expect(approved.policyRevisions.store).toBe(next)
      expect(next).toBeGreaterThan(live.seq)
      const settings = (await postgres.query('select policy_revisions, version from finance.commerce_settings where id = 1')).rows[0]
      expect(settings).toMatchObject({ version: version + 1, policy_revisions: { store: next } })
    } finally {
      if (open) await publisher.query('rollback')
      await publisher.end()
      if (next > 0) {
        // The live store policy as it was, and this test's version gone (the reset this republish makes is undone with
        // the settings after the file).
        await postgres.query("update public.published_documents set seq = $1, data = $2::jsonb where collection = 'policies' and doc_id = 'store'", [
          live.seq,
          JSON.stringify(live.data),
        ])
        await postgres.query("delete from public.content_versions where collection = 'policies' and doc_id = 'store' and seq = $1", [next])
      }
    }
  })
})

// FABLE-AUDIT M1b: the store closes when an approved policy changes, while the owner's switch still says on.
describe('a reset while checkout is switched on alerts the owners', () => {
  it('queues one owner alert per active owner for each change while checkout is on, none while it is off, and one for a removal', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        const approve = (enabled: boolean): Promise<unknown> =>
          serviceDb.query('update finance.commerce_settings set checkout_enabled = $1, policy_revisions = $2::jsonb where id = 1', [
            enabled,
            JSON.stringify({ store: 999, delivery: 999, refund: 999 }),
          ])
        const revisions = async (): Promise<unknown> =>
          (await serviceDb.query<{ policy_revisions: unknown }>('select policy_revisions from finance.commerce_settings where id = 1')).rows[0]!.policy_revisions
        const owners = Number(
          (
            await serviceDb.query<{ n: number }>(
              "select count(*)::int as n from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'owner' and u.email is not null",
            )
          ).rows[0]!.n,
        )

        // Switched on: a new seq of an approved policy closes the store, and every active owner is told once.
        await approve(true)
        const seq = await publishPolicy('store')
        expect(await revisions()).toEqual({})
        const told = await resetAlerts(`store:${seq}`)
        expect(told).toHaveLength(owners)
        expect(told.map((entry) => entry.recipient)).toContain(owner.email.toLowerCase())
        for (const entry of told) expect(entry.payload).toEqual({ alert: 'policies_reset', policy: 'store', seq })
        // The same seq published again changes nothing and tells nobody twice.
        await serviceDb.query('select public.content_go_live($1, $2, $3)', ['policies', 'store', seq])
        expect(await resetAlerts(`store:${seq}`)).toHaveLength(owners)

        // Switched off: the approval is reset the same way, and nobody is alerted.
        await approve(false)
        const quiet = await publishPolicy('store')
        expect(await revisions()).toEqual({})
        expect(await resetAlerts(`store:${quiet}`)).toEqual([])

        // A policy taken down while switched on: the removal goes through, and it is told as removed.
        await approve(false)
        await publishPolicy('refund')
        await approve(true)
        await serviceDb.query("delete from public.published_documents where collection = 'policies' and doc_id = 'refund'")
        expect(await revisions()).toEqual({})
        const removed = await resetAlerts('refund:removed')
        expect(removed).toHaveLength(owners)
        for (const entry of removed) expect(entry.payload).toEqual({ alert: 'policies_reset', policy: 'refund', seq: null })
      })
    })
  })
})
