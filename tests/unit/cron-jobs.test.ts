// D35: a restore marks the migrations applied without running them, so the
// pg_cron schedules (created only by `cron.schedule` calls inside migrations)
// are re-run from their statements and checked by name against the restored
// `cron.job`. This is the list and the statement extraction.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cronScheduleStatements, expectedCronJobs, missingCronJobs } from '../../scripts/lib/cron-jobs.mjs'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'anasaq-cron-jobs-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('expectedCronJobs', () => {
  it('finds the schedules of the real migrations, the multi-line ones, the AUDIT-2 purge and the P08 jobs included', () => {
    expect(expectedCronJobs(MIGRATIONS)).toEqual(
      expect.arrayContaining([
        'content-publish-due',
        'rate-limits-purge',
        'job-runs-purge',
        'site-build-trigger',
        'email-outbox',
        'media-sweep',
        'contacts-purge',
        'checkout-expire',
        'buyer-retention',
        'cron-run-details-purge',
        'payments-reconcile',
        'availability-sweep',
        'notifications-purge',
        'notify-confirm-backlog',
        'payment-events-purge',
      ]),
    )
  })

  it('reads a multi-line call, counts a name scheduled twice once, and ignores a commented-out call and a non-SQL file', () => {
    const dir = join(root, 'fixture')
    mkdirSync(dir)
    writeFileSync(join(dir, 'notes.txt'), "select cron.schedule('ignored-file', '* * * * *', 'x');")
    writeFileSync(
      join(dir, 'a.sql'),
      `select cron.schedule('one', '* * * * *', 'select 1');
-- select cron.schedule('commented', '* * * * *', 'x');
`,
    )
    writeFileSync(
      join(dir, 'b.sql'),
      `select cron.schedule(
  'two', '1 * * * *',
  $$select 2$$
);
select cron.schedule('one', '2 * * * *', 'select 1');
`,
    )
    expect(expectedCronJobs(dir).sort()).toEqual(['one', 'two'])
  })

  it('refuses a folder without a schedule: an empty list would make every check pass', () => {
    const empty = mkdtempSync(join(tmpdir(), 'anasaq-cron-empty-'))
    try {
      expect(() => expectedCronJobs(empty)).toThrow(/No cron.schedule call found/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('cronScheduleStatements', () => {
  it('keeps a real migration statement whole: the multi-line call with its $$ body and the closing parenthesis', () => {
    const statements = cronScheduleStatements(MIGRATIONS)
    expect([...statements.keys()]).toHaveLength(15)
    expect(statements.get('payments-reconcile')).toBe("select cron.schedule('payments-reconcile', '* * * * *', 'select public.payments_kick()');")
    expect(statements.get('content-publish-due')).toBe("select cron.schedule('content-publish-due', '* * * * *', 'select public.publish_due()');")
    expect(statements.get('cron-run-details-purge')).toBe(
      "select cron.schedule(\n  'cron-run-details-purge', '31 3 * * *',\n  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$\n);",
    )
    for (const statement of statements.values()) expect(statement).toMatch(/^select cron\.schedule\(.*\);$/s)
  })

  it('cuts a call at its own closing parenthesis: $$ and $tag$ bodies and quoted strings may hold ) ; and quotes, comment lines are dropped', () => {
    const dir = join(root, 'statements')
    mkdirSync(dir)
    writeFileSync(
      join(dir, '1.sql'),
      `-- select cron.schedule('commented', '* * * * *', 'x');
select cron.schedule(
  'dollar', '1 * * * *',
  $$delete from t where a in (select b from u) and c = ');'; select 1$$
);
select cron.schedule('tagged', '2 * * * *', $fn$select f(')')$fn$);
select cron.schedule('quoted', '3 * * * *', 'select ''it''s ) here''') ;
select 'not a schedule';
`,
    )
    const statements = cronScheduleStatements(dir)
    expect([...statements.keys()]).toEqual(['dollar', 'tagged', 'quoted'])
    expect(statements.get('dollar')).toBe(
      "select cron.schedule(\n  'dollar', '1 * * * *',\n  $$delete from t where a in (select b from u) and c = ');'; select 1$$\n);",
    )
    expect(statements.get('tagged')).toBe("select cron.schedule('tagged', '2 * * * *', $fn$select f(')')$fn$);")
    expect(statements.get('quoted')).toBe("select cron.schedule('quoted', '3 * * * *', 'select ''it''s ) here''');")
  })

  it('takes the latest definition of a name scheduled twice, across files (by file name) and inside one file', () => {
    const dir = join(root, 'latest')
    mkdirSync(dir)
    writeFileSync(join(dir, '2_later.sql'), "select cron.schedule('job', '2 * * * *', 'select 2');\n")
    writeFileSync(join(dir, '1_first.sql'), "select cron.schedule('job', '1 * * * *', 'select 1');\nselect cron.schedule('twice', '1 * * * *', 'select 1');\nselect cron.schedule('twice', '9 * * * *', 'select 9');\n")
    const statements = cronScheduleStatements(dir)
    expect(statements.get('job')).toBe("select cron.schedule('job', '2 * * * *', 'select 2');")
    expect(statements.get('twice')).toBe("select cron.schedule('twice', '9 * * * *', 'select 9');")
  })

  it('refuses a call that never closes and a folder without a schedule', () => {
    const open = join(root, 'unclosed')
    mkdirSync(open)
    writeFileSync(join(open, 'a.sql'), "select cron.schedule('broken', '* * * * *', 'select 1';\n")
    expect(() => cronScheduleStatements(open)).toThrow(/'broken' in a.sql never closes/)
    const none = join(root, 'none')
    mkdirSync(none)
    expect(() => cronScheduleStatements(none)).toThrow(/No cron.schedule call found/)
  })
})

describe('missingCronJobs', () => {
  it('names every expected job that is not present', () => {
    expect(missingCronJobs(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
    expect(missingCronJobs(['a', 'b'], ['b', 'a', 'extra'])).toEqual([])
    expect(missingCronJobs(['a'], [])).toEqual(['a'])
  })
})
