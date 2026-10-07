// Every pg_cron schedule the migrations create is in the local database's
// cron.job under its name: the same list `pnpm restore-check` requires after a
// restore (scripts/lib/cron-jobs.mjs reads it from the migrations). And the
// failures of those jobs reach the admin (`cron_failures_recent`, FABLE-AUDIT
// M2-5), read from pg_cron's own log.
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectedCronJobs, missingCronJobs } from '../../scripts/lib/cron-jobs.mjs'
import { anonClient, createStaff, signIn } from './support'

let postgres: Client

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  await postgres.end()
})

describe('pg_cron schedules', () => {
  it('cron.job holds every schedule the migrations create', async () => {
    const { rows } = await postgres.query<{ jobname: string }>('select jobname from cron.job')
    const expected = expectedCronJobs(fileURLToPath(new URL('../../supabase/migrations', import.meta.url)))
    expect(missingCronJobs(expected, rows.map((row) => row.jobname))).toEqual([])
  })
})

type Failure = { jobname: string; failures: number; lastFailedAt: string }

describe('cron_failures_recent', () => {
  it('is for an owner or operations only: anon has no grant, an editor is refused; security definer with an empty search_path', async () => {
    const editor = await createStaff('editor')
    const refused = await (await signIn(editor.email)).rpc('cron_failures_recent')
    expect(refused.error?.code).toBe('42501')
    expect(refused.data).toBeNull()
    expect((await anonClient().rpc('cron_failures_recent')).error?.code).toBe('42501')
    const operations = await createStaff('operations')
    const read = await (await signIn(operations.email)).rpc('cron_failures_recent')
    expect(read.error).toBeNull()
    expect(Array.isArray(read.data)).toBe(true)
    const meta = (
      await postgres.query(
        `select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated
           from pg_proc p where p.oid = 'public.cron_failures_recent()'::regprocedure`,
      )
    ).rows[0]
    expect(meta).toEqual({ prosecdef: true, proconfig: ['search_path=""'], anon: false, authenticated: true })
  })

  it('answers each job that failed in the last 24 hours with its count and its latest failure, the latest first, and never the command or the error', async () => {
    const owner = await createStaff('owner')
    // One transaction, rolled back: the failed runs are written as the migration role (pg_cron's log belongs to it) and
    // read through the function as the owner, with now() fixed.
    await postgres.query('begin')
    try {
      const asOwner = async (): Promise<Failure[]> => {
        await postgres.query('set local role authenticated')
        await postgres.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.userId, role: 'authenticated' })])
        const answer = (await postgres.query<{ r: Failure[] }>('select public.cron_failures_recent() as r')).rows[0]!.r
        await postgres.query('set local role postgres')
        return answer
      }
      const before = await asOwner()
      const countOf = (answer: Failure[], job: string): number => answer.find((entry) => entry.jobname === job)?.failures ?? 0
      // pg_cron numbers its runs from its own sequence, which the migration role may not draw from: the test's runs take
      // negative numbers, which pg_cron never gives.
      let runid = -Date.now()
      const run = (job: string, status: string, endedAgo: string): Promise<unknown> =>
        postgres.query(
          `insert into cron.job_run_details (runid, jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
           select $4, j.jobid, 0, 'postgres', 'postgres', j.command, $2, 'ERROR: a failure the test made', now() - $3::interval - interval '2 seconds', now() - $3::interval
             from cron.job j where j.jobname = $1`,
          [job, status, endedAgo, (runid -= 1)],
        )
      await run('media-sweep', 'failed', '2 hours')
      await run('media-sweep', 'failed', '1 hour')
      await run('media-sweep', 'failed', '25 hours')
      await run('media-sweep', 'succeeded', '10 minutes')
      await run('contacts-purge', 'failed', '1 minute')

      const after = await asOwner()
      expect(countOf(after, 'media-sweep')).toBe(countOf(before, 'media-sweep') + 2)
      expect(countOf(after, 'contacts-purge')).toBe(countOf(before, 'contacts-purge') + 1)
      for (const entry of after) expect(Object.keys(entry).sort()).toEqual(['failures', 'jobname', 'lastFailedAt'])
      expect(JSON.stringify(after)).not.toContain('a failure the test made')
      // The latest failure first.
      const times = after.map((entry) => Date.parse(entry.lastFailedAt))
      expect(times).toEqual([...times].sort((a, b) => b - a))
      const latest = (await postgres.query<{ t: string }>("select to_jsonb(now() - interval '1 minute') #>> '{}' as t")).rows[0]!.t
      expect(after.find((entry) => entry.jobname === 'contacts-purge')!.lastFailedAt).toBe(latest)
    } finally {
      await postgres.query('rollback')
    }
  })
})
