// Every pg_cron schedule the migrations create is in the local database's
// cron.job under its name: the same list `pnpm restore-check` requires after a
// restore (scripts/lib/cron-jobs.mjs reads it from the migrations).
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectedCronJobs, missingCronJobs } from '../../scripts/lib/cron-jobs.mjs'

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
