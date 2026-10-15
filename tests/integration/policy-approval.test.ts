// P07 round 2: the owner's policy approval
// (`public.commerce_policies_approve`, migration 20260927170000; RESIDUALS-1 R1
// item 1 adds its third argument, the revisions the owner's screen showed, and
// the `publishedPolicies` list of `commerce_settings_get` that the screen reads
// them from). The
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

const APPROVE = 'public.commerce_policies_approve(uuid, integer, jsonb)'

/** The published revision of each policy that is published, as the approval reads them (the map a screen sends). */
async function publishedMap(): Promise<Record<string, number>> {
  let rows: Array<{ doc_id: string; seq: number }> = []
  await asPostgres(async () => {
    rows = (
      await serviceDb.query<{ doc_id: string; seq: number }>(
        "select doc_id, seq from public.published_documents where collection = 'policies' and doc_id in ('store', 'delivery', 'refund', 'privacy')",
      )
    ).rows
  })
  return Object.fromEntries(rows.map((row) => [row.doc_id, row.seq]))
}

/** The approval row as it stands: what a refused call must leave as it was. */
async function approvalRow(): Promise<{ policy_revisions: unknown; version: number }> {
  let row: { policy_revisions: unknown; version: number } | undefined
  await asPostgres(async () => {
    row = (await serviceDb.query<{ policy_revisions: unknown; version: number }>('select policy_revisions, version from finance.commerce_settings where id = 1')).rows[0]
  })
  return row!
}

/**
 * An approval that must be refused with `code`, inside the open transaction: a savepoint is taken and rolled back to, so the
 * transaction goes on and the state after the refusal can be read.
 */
async function refusedApproval(args: Record<string, unknown>, code: string): Promise<void> {
  await serviceDb.query('savepoint refused')
  await expect(pgRpc(serviceDb)('commerce_policies_approve', args)).rejects.toMatchObject({ code })
  await serviceDb.query('rollback to savepoint refused')
}

/** `commerce_settings_get` as the signed-in owner reads it. */
async function settingsAsOwner(ownerId: string): Promise<Record<string, unknown>> {
  await serviceDb.query('set local role authenticated')
  await serviceDb.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ownerId, role: 'authenticated' })])
  try {
    return (await serviceDb.query<{ r: Record<string, unknown> }>('select public.commerce_settings_get() as r')).rows[0]!.r
  } finally {
    await serviceDb.query('set local role service_role')
  }
}

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

  it('the two-argument signature is gone: no caller can approve without saying what it approves', async () => {
    const old = await postgres.query<{ found: string | null }>("select to_regprocedure('public.commerce_policies_approve(uuid, integer)')::text as found")
    expect(old.rows[0]!.found).toBeNull()
    const rows = await postgres.query<{ args: string }>(
      "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'commerce_policies_approve'",
    )
    expect(rows.rows.map((row) => row.args)).toEqual(['p_actor uuid, p_expected_version integer, p_revisions jsonb'])
  })
})

describe('commerce_policies_approve', () => {
  it('refuses an actor who is not an active owner (42501)', async () => {
    const editor = await createStaff('editor')
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: editor.userId, p_expected_version: 0, p_revisions: {} }),
      ).rejects.toMatchObject({ code: '42501' }),
    )
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', {
          p_actor: '00000000-0000-0000-0000-000000000000',
          p_expected_version: 0,
          p_revisions: {},
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
          p_revisions: {},
        }),
      ).rejects.toMatchObject({ code: '23505' })
    })
    // A missing version is a conflict too, never a blind overwrite.
    await rolledBack(serviceDb, () =>
      expect(
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: null, p_revisions: {} }),
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
      serviceClient.rpc('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: -1, p_revisions: {} }),
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
        pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: before, p_revisions: {} }),
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
        p_revisions: { store, delivery, refund },
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
        p_revisions: { store, delivery, refund, privacy },
      })) as { version: number; policyRevisions: Record<string, number> }
      expect(second.version).toBe(before + 2)
      expect(second.policyRevisions).toEqual({ store, delivery, refund, privacy })
    })
  })
})

// RESIDUALS-1 R1, I44 (1): the approval pins the revisions the owner reviewed, not whatever is published when he clicks.
describe('the revisions the owner reviewed', () => {
  it('the current map approves, privacy included only when it is published', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
        for (const doc of ['store', 'delivery', 'refund']) await publishPolicy(doc)
      })
      const map = await publishedMap()
      expect(Object.keys(map).sort()).toEqual(['delivery', 'refund', 'store'])
      const before = (await approvalRow()).version
      const approved = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: before,
        p_revisions: map,
      })) as { version: number; policyRevisions: Record<string, number> }
      expect(approved).toEqual({ version: before + 1, policyRevisions: map })
    })
  })

  it('a revision published between the read and the approval refuses with a distinct error and leaves the approval as it was', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
        for (const doc of ['store', 'delivery', 'refund']) await publishPolicy(doc)
        await serviceDb.query("update finance.commerce_settings set checkout_enabled = false, policy_revisions = '{}'::jsonb where id = 1")
      })
      // The owner's screen read these revisions.
      const read = await publishedMap()
      // A new revision of the refund policy goes live meanwhile.
      let newer = 0
      await asPostgres(async () => {
        newer = await publishPolicy('refund')
      })
      const after = await approvalRow()
      const audits = async (): Promise<number> => {
        let n = 0
        await asPostgres(async () => {
          n = Number((await serviceDb.query<{ n: number }>("select count(*)::int as n from public.audit_events where action = 'commerce.policies' and actor = $1", [owner.userId])).rows[0]!.n)
        })
        return n
      }
      await refusedApproval({ p_actor: owner.userId, p_expected_version: after.version, p_revisions: read }, '55000')
      expect(await approvalRow(), 'nothing is written').toEqual(after)
      expect(await audits()).toBe(0)
      // From the list as it is now, the approval goes through, with the new revision.
      const approved = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: after.version,
        p_revisions: await publishedMap(),
      })) as { policyRevisions: Record<string, number> }
      expect(approved.policyRevisions.refund).toBe(newer)
    })
  })

  it('a set that changed since an approval (a policy published for the first time) leaves that approval standing', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
        for (const doc of ['store', 'delivery', 'refund']) await publishPolicy(doc)
      })
      const read = await publishedMap()
      const first = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: (await approvalRow()).version,
        p_revisions: read,
      })) as { version: number }
      // The privacy policy goes live: it is not in the approved set, so no reset, but the map the owner read lacks it.
      await asPostgres(async () => {
        await publishPolicy('privacy')
      })
      const standing = await approvalRow()
      expect(standing).toEqual({ policy_revisions: read, version: first.version })
      await refusedApproval({ p_actor: owner.userId, p_expected_version: standing.version, p_revisions: read }, '55000')
      expect(await approvalRow()).toEqual(standing)
    })
  })

  it('a policy missing from the map, an extra key, a wrong revision and a map that is not an object all refuse', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
        for (const doc of ['store', 'delivery', 'refund']) await publishPolicy(doc)
        await serviceDb.query("update finance.commerce_settings set checkout_enabled = false, policy_revisions = '{}'::jsonb where id = 1")
      })
      const read = await publishedMap()
      const standing = await approvalRow()
      const cases: Array<[string, unknown]> = [
        ['a policy missing', { store: read.store, delivery: read.delivery }],
        ['the empty map', {}],
        ['an extra key', { ...read, privacy: 1 }],
        ['an unknown key', { ...read, other: 1 }],
        ['a wrong revision', { ...read, store: read.store! + 1 }],
        ['a revision sent as text', { ...read, store: String(read.store) }],
        ['null', null],
        ['an array', []],
        ['a number', 7],
      ]
      for (const [label, map] of cases) {
        await refusedApproval({ p_actor: owner.userId, p_expected_version: standing.version, p_revisions: map }, '55000')
        expect(await approvalRow(), label).toEqual(standing)
      }
      // The version is checked first: a stale one is the conflict, whatever the map says.
      await refusedApproval({ p_actor: owner.userId, p_expected_version: standing.version + 5, p_revisions: { other: 1 } }, '23505')
    })
  })

  it('commerce_settings_get lists the policies an approval would cover: the published ones among the four, in order, each with its revision and when it went live', async () => {
    const owner = await createStaff('owner')
    await rolledBack(serviceDb, async () => {
      await asPostgres(async () => {
        await serviceDb.query('delete from public.published_documents where collection = $1', ['policies'])
        for (const doc of ['privacy', 'refund', 'store', 'delivery']) await publishPolicy(doc)
      })
      const four = await publishedMap()
      const listed = (await settingsAsOwner(owner.userId)).publishedPolicies as Array<{ id: string; title: string; seq: number; publishedAt: string }>
      expect(listed.map((entry) => entry.id)).toEqual(['store', 'delivery', 'refund', 'privacy'])
      expect(Object.fromEntries(listed.map((entry) => [entry.id, entry.seq]))).toEqual(four)
      expect(listed.map((entry) => entry.title)).toEqual(['سياسة store', 'سياسة delivery', 'سياسة refund', 'سياسة privacy'])
      for (const entry of listed) expect(Math.abs(Date.now() - Date.parse(entry.publishedAt)), entry.id).toBeLessThan(10 * 60_000)

      // Privacy not published: it is not listed, and the list is the map that approves.
      await asPostgres(async () => {
        await serviceDb.query("delete from public.published_documents where collection = 'policies' and doc_id = 'privacy'")
      })
      const three = (await settingsAsOwner(owner.userId)).publishedPolicies as Array<{ id: string; seq: number }>
      expect(three.map((entry) => entry.id)).toEqual(['store', 'delivery', 'refund'])
      const map = Object.fromEntries(three.map((entry) => [entry.id, entry.seq]))
      const approved = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: (await approvalRow()).version,
        p_revisions: map,
      })) as { policyRevisions: Record<string, number> }
      expect(approved.policyRevisions).toEqual(map)
    })
  })
})

// FABLE-AUDIT M2-8 (DB-COMMERCE-05, GAP-G5-3): a policy publish and an approval serialise on the settings row. The
// trigger of the publish matched no row, and so locked nothing, while the approval set was empty: a first approval that
// overlapped a publish read the old seq and pinned it. This race needs two sessions that commit, so it runs on the
// seeded policies (the demo catalog publishes them) and puts back the live store policy itself; the settings row is
// restored after the file.
describe('a policy publish that overlaps an approval', () => {
  it('an approval that starts while a publish of one policy holds the settings row waits for it and is refused (the screen showed the old seq); the new seq is approved only from a fresh list', async () => {
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

      // The owner approves meanwhile, as the Edge Function does, with the revisions his screen read before the publish:
      // it waits for the publish.
      const read = Object.fromEntries(
        (await postgres.query("select doc_id, seq from public.published_documents where collection = 'policies' and doc_id in ('store', 'delivery', 'refund', 'privacy')")).rows.map(
          (row: { doc_id: string; seq: number }) => [row.doc_id, row.seq],
        ),
      ) as Record<string, number>
      expect(read.store).toBe(live.seq)
      const approval = pgRpc(serviceDb)('commerce_policies_approve', { p_actor: owner.userId, p_expected_version: version, p_revisions: read }) as Promise<{
        version: number
        policyRevisions: Record<string, number>
      }>
      const refused = approval.then(
        () => null,
        (error: unknown) => error,
      )
      expect(await settledWithin(refused, 900)).toBe('blocked')
      await publisher.query('commit')
      open = false

      // Then it reads what the publish committed: the old seq is never pinned. The revisions the owner read are no longer
      // the published ones, so the approval is refused and nothing is written (RESIDUALS-1: it used to take the new seq).
      expect(await refused).toMatchObject({ code: '55000' })
      expect(next).toBeGreaterThan(live.seq)
      expect((await postgres.query('select policy_revisions, version from finance.commerce_settings where id = 1')).rows[0]).toMatchObject({
        version,
        policy_revisions: {},
      })

      // An approval from the list as it is after the publish waits for nothing and pins the new seq.
      const approved = (await pgRpc(serviceDb)('commerce_policies_approve', {
        p_actor: owner.userId,
        p_expected_version: version,
        p_revisions: { ...read, store: next },
      })) as { version: number; policyRevisions: Record<string, number> }
      expect(approved.version).toBe(version + 1)
      expect(approved.policyRevisions.store).toBe(next)
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
