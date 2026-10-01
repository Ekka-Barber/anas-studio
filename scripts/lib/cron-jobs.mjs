/**
 * The pg_cron schedules the migrations create (outbox, site build, scheduled
 * publishing, media sweep, checkout expiry, the purges, buyer retention). They
 * exist only as `cron.schedule('<name>', ...)` calls inside migrations, and a
 * restore marks those migrations applied without running them (whether the
 * dumps carry `cron.job` depends on the CLI version). `restore-check` re-runs these statements after the restore
 * (the runbook step), then compares the restored `cron.job` with the names.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DOLLAR_TAG = /\$(?:[A-Za-z_]\w*)?\$/y

/** The index just past the `)` that closes the call whose `(` is at `open`; -1 when it never closes. `'...'` and `$tag$...$tag$` strings are skipped, so a `)` inside a command does not end the call. */
function callEnd(sql, open) {
  let depth = 0
  let i = open
  while (i < sql.length) {
    const ch = sql[i]
    let quote = ''
    if (ch === "'") quote = ch
    else if (ch === '$') {
      DOLLAR_TAG.lastIndex = i
      quote = DOLLAR_TAG.exec(sql)?.[0] ?? ''
    }
    if (quote) {
      // A doubled '' inside a string closes it and reopens the next one: same result.
      const close = sql.indexOf(quote, i + quote.length)
      if (close < 0) return -1
      i = close + quote.length
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return -1
}

/**
 * {job name: the runnable `select cron.schedule(...);` statement} of every
 * `cron.schedule('<name>', ...)` call in `migrationsDir`. Files run in name
 * order, so a name scheduled twice keeps its latest definition (as pg_cron
 * does: the name is the key). Whole-line `--` comments are ignored.
 * ponytail: a `cron.unschedule` is not followed; none exists, and a job a
 * later migration removed would then be re-created and expected, which asks
 * for this folder's scan to be updated.
 */
export function cronScheduleStatements(migrationsDir) {
  const statements = new Map()
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8').replace(/^\s*--.*$/gm, '')
    for (const match of sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)) {
      const end = callEnd(sql, match.index + 'cron.schedule'.length)
      if (end < 0) throw new Error(`The cron.schedule call for '${match[1]}' in ${file} never closes`)
      statements.set(match[1], `select ${sql.slice(match.index, end)};`)
    }
  }
  // An empty list would make every check pass: a wrong folder is a failure.
  if (statements.size === 0) throw new Error(`No cron.schedule call found in ${migrationsDir}`)
  return statements
}

/** Every job name a `cron.schedule('<name>'` call in `migrationsDir` creates (a name scheduled twice counts once). */
export function expectedCronJobs(migrationsDir) {
  return [...cronScheduleStatements(migrationsDir).keys()]
}

/** The expected job names that are not among the `present` ones. */
export function missingCronJobs(expected, present) {
  const have = new Set(present)
  return expected.filter((name) => !have.has(name))
}
