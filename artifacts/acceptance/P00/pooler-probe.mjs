#!/usr/bin/env node
/**
 * P00 evidence: Supabase connection-path probe.
 *
 * Records what the deployed runtime will actually meet:
 *  - the transaction pooler endpoint (the Hyperdrive origin) versus the
 *    session endpoint that D26 reserves for migration DDL,
 *  - whether named prepared statements survive the pooler,
 *  - observed behaviour when many connections are opened at once,
 *  - transaction rollback and read-after-write across pooled connections.
 *
 * Secrets never leave the process: the script reads DATABASE_URL from the
 * environment, prints no URL, user, host or password, and redacts those strings
 * out of any driver error before writing them.
 *
 * Usage:  set -a; . ./.env; set +a; node artifacts/acceptance/P00/pooler-probe.mjs
 */
import pg from 'pg'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const parsed = new URL(raw)
const SECRETS = [parsed.hostname, parsed.username, decodeURIComponent(parsed.password ?? '')].filter(
  (value) => typeof value === 'string' && value.length > 3,
)

/** Removes host, user and password from any string before it is printed. */
function redact(value) {
  let out = String(value)
  for (const secret of SECRETS) {
    out = out.split(secret).join('<redacted>')
  }
  return out
}

function endpoint(port) {
  const url = new URL(raw)
  url.port = String(port)
  return url.toString()
}

const TRANSACTION_POOLER_PORT = parsed.port || '6543'
const SESSION_PORT = '5432'

const results = []
function record(name, value) {
  results.push({ name, value })
  console.log(`${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function main() {
  record('probe_started_utc', new Date().toISOString())
  record('transaction_pooler_port', TRANSACTION_POOLER_PORT)
  record('session_endpoint_port', SESSION_PORT)
  record('hostname_shape', `${parsed.hostname.split('.').slice(1).join('.')} (subdomain redacted)`)
  record('username_shape', parsed.username.includes('.') ? 'postgres.<project-ref>' : 'plain')
  record('sslmode_in_url', parsed.searchParams.get('sslmode') ?? '(not set)')

  // --- transaction pooler ---------------------------------------------------
  await withClient(endpoint(TRANSACTION_POOLER_PORT), async (client) => {
    const version = await client.query('show server_version')
    record('pooler_server_version', version.rows[0].server_version)

    const settings = await client.query(
      "select name, setting from pg_settings where name in ('max_connections','default_transaction_read_only')",
    )
    record(
      'pooler_reported_settings',
      Object.fromEntries(settings.rows.map((r) => [r.name, r.setting])),
    )

    const appName = await client.query('select current_setting($1, true) as v', [
      'application_name',
    ])
    record('pooler_application_name', appName.rows[0].v ?? '(unset)')

    // Unnamed extended-query protocol: this is what node-postgres and Drizzle use.
    const parameterised = await client.query('select $1::int + $2::int as sum', [2, 3])
    record('pooler_unnamed_parameterised_query', parameterised.rows[0].sum === 5 ? 'ok' : 'FAILED')

    // Named prepared statements. node-postgres only uses these when a query is
    // given a `name`; Payload and Drizzle never do. The probe checks what would
    // happen if something did, and whether statements from an earlier client
    // are still present on the backend this client was handed.
    const inherited = await client.query(
      "select name from pg_prepared_statements where name like 'p00\\_%'",
    )
    record(
      'pooler_inherited_prepared_statements_from_other_clients',
      inherited.rows.map((r) => r.name),
    )

    const statementName = `p00_stmt_${Date.now().toString(36)}`
    try {
      await client.query({ name: statementName, text: 'select 1 as one' })
      await client.query({ name: statementName, text: 'select 1 as one' })
      record('pooler_named_prepared_statement', 'accepted (statement reused on same backend)')
    } catch (error) {
      record('pooler_named_prepared_statement', `rejected: ${redact(error.message)}`)
    }
    try {
      await client.query('deallocate all')
      record('pooler_deallocate_all', 'ok')
    } catch (error) {
      record('pooler_deallocate_all', redact(error.message))
    }

    // Does one client keep one backend between statements? A transaction-mode
    // pooler may hand each statement to a different PostgreSQL backend.
    const pidA = await client.query('select pg_backend_pid() as pid')
    const pidB = await client.query('select pg_backend_pid() as pid')
    record('pooler_backend_pid_stable_between_statements', pidA.rows[0].pid === pidB.rows[0].pid)

    // Session GUCs set outside a transaction: the plan forbids relying on these
    // for identity, so record whether they survive at all.
    await client.query("set app.p00_probe = 'set-outside-transaction'")
    const gucOutside = await client.query("select current_setting('app.p00_probe', true) as v")
    record('pooler_set_survives_outside_transaction', gucOutside.rows[0].v ?? null)

    await client.query('begin')
    const pidInTxA = await client.query('select pg_backend_pid() as pid')
    await client.query("set local app.p00_probe_local = 'set-inside-transaction'")
    const gucInside = await client.query("select current_setting('app.p00_probe_local', true) as v")
    const pidInTxB = await client.query('select pg_backend_pid() as pid')
    await client.query('commit')
    record('pooler_backend_pid_stable_inside_transaction', pidInTxA.rows[0].pid === pidInTxB.rows[0].pid)
    record('pooler_set_local_inside_transaction', gucInside.rows[0].v ?? null)
    const gucAfterCommit = await client.query(
      "select current_setting('app.p00_probe_local', true) as v",
    )
    record('pooler_set_local_after_commit', gucAfterCommit.rows[0].v ?? null)

    // Transaction rollback across the pooler.
    await client.query('begin')
    await client.query('create temporary table p00_rollback_probe (n int) on commit drop')
    await client.query('insert into p00_rollback_probe values (1)')
    const inTx = await client.query('select count(*)::int as c from p00_rollback_probe')
    await client.query('rollback')
    let survived = null
    try {
      const after = await client.query('select count(*)::int as c from p00_rollback_probe')
      survived = after.rows[0].c
    } catch (error) {
      survived = `relation gone (${redact(error.message).split('\n')[0]})`
    }
    record('pooler_transaction_rollback', {
      rowsInsideTransaction: inTx.rows[0].c,
      afterRollback: survived,
    })
  })

  // --- session endpoint (migration path, D26) --------------------------------
  try {
    await withClient(endpoint(SESSION_PORT), async (client) => {
      const version = await client.query('show server_version')
      record('session_endpoint_server_version', version.rows[0].server_version)
      try {
        await client.query({ name: 'p00_session_stmt', text: 'select 1 as one' })
        await client.query({ name: 'p00_session_stmt', text: 'select 1 as one' })
        record('session_named_prepared_statement', 'accepted')
      } catch (error) {
        record('session_named_prepared_statement', `rejected: ${redact(error.message)}`)
      }
      const advisory = await client.query('select pg_backend_pid() as pid')
      record('session_backend_pid_visible', typeof advisory.rows[0].pid === 'number')
    })
  } catch (error) {
    record('session_endpoint_error', redact(error.message))
  }

  // --- concurrent connection behaviour ---------------------------------------
  const ATTEMPTS = 20
  const clients = []
  let opened = 0
  let firstFailure = null
  for (let i = 0; i < ATTEMPTS; i++) {
    const client = new pg.Client({
      connectionString: endpoint(TRANSACTION_POOLER_PORT),
      ssl: { rejectUnauthorized: false },
    })
    try {
      await client.connect()
      await client.query('select 1')
      clients.push(client)
      opened += 1
    } catch (error) {
      firstFailure = { atConnection: i + 1, message: redact(error.message) }
      break
    }
  }
  record('pooler_concurrent_connections_opened', opened)
  record('pooler_concurrent_first_failure', firstFailure ?? `none within ${ATTEMPTS} attempts`)
  await Promise.all(clients.map((client) => client.end().catch(() => {})))

  // --- read-after-write across two pooled connections -------------------------
  const writer = new pg.Client({
    connectionString: endpoint(TRANSACTION_POOLER_PORT),
    ssl: { rejectUnauthorized: false },
  })
  const reader = new pg.Client({
    connectionString: endpoint(TRANSACTION_POOLER_PORT),
    ssl: { rejectUnauthorized: false },
  })
  const table = `p00_read_after_write_${Date.now().toString(36)}`
  try {
    await writer.connect()
    await reader.connect()
    await writer.query(`create table if not exists public.${table} (id int primary key, v text)`)
    const marker = `synthetic-${Date.now()}`
    await writer.query(`insert into public.${table} (id, v) values (1, $1)`, [marker])
    const readBack = await reader.query(`select v from public.${table} where id = 1`)
    record(
      'pooler_read_after_write_across_connections',
      readBack.rows[0]?.v === marker ? 'visible immediately' : 'NOT VISIBLE',
    )
  } catch (error) {
    record('pooler_read_after_write_error', redact(error.message))
  } finally {
    try {
      await writer.query(`drop table if exists public.${table}`)
      record('pooler_probe_table_dropped', table)
    } catch (error) {
      record('pooler_probe_table_drop_error', redact(error.message))
    }
    await writer.end().catch(() => {})
    await reader.end().catch(() => {})
  }

  record('probe_finished_utc', new Date().toISOString())
}

main().catch((error) => {
  console.error('probe failed:', redact(error.stack ?? error.message))
  process.exit(1)
})
