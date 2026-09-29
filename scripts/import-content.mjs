// Imports `content/initial-content.json` into the local database (P04): one
// `content_versions` row per document, `content_go_live()`, and an
// `audit_events` row (`content.import`) — so local dev and CI have real
// published content instead of relying on the JSON fallback (there is none;
// see `src/lib/content.ts`). Local only: refuses unless DATABASE_URL points
// at a loopback host. Skips documents that are already published unless
// `--force` is given.
//
// Usage: node scripts/import-content.mjs [--force]
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } })

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('Refusing: DATABASE_URL is not set.')
  process.exit(1)
}
let parsed
try {
  parsed = new URL(dbUrl)
} catch {
  parsed = null
}
if (!parsed || (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') || !LOCAL_HOSTS.has(parsed.hostname)) {
  console.error('Refusing: DATABASE_URL does not point at a local PostgreSQL host.')
  process.exit(1)
}

const contentPath = fileURLToPath(new URL('../content/initial-content.json', import.meta.url))
const content = JSON.parse(readFileSync(contentPath, 'utf8'))

const documents = [
  {
    collection: 'site_settings',
    doc_id: 'site',
    data: { nav: content.nav, footer: content.footer, home: content.home, social: content.social },
  },
  { collection: 'rooms', doc_id: 'started', data: content.rooms.started },
  { collection: 'rooms', doc_id: 'built', data: content.rooms.built },
  { collection: 'rooms', doc_id: 'passed', data: content.rooms.passed },
  { collection: 'rooms', doc_id: 'shelf', data: content.rooms.shelf },
  { collection: 'scenes', doc_id: 'gallery', data: { items: content.scenes } },
]

const client = new Client({ connectionString: dbUrl })
await client.connect()

let imported = 0
let skipped = 0
try {
  for (const doc of documents) {
    const existing = await client.query(
      'select 1 from public.published_documents where collection = $1 and doc_id = $2',
      [doc.collection, doc.doc_id],
    )
    if (existing.rowCount > 0 && !values.force) {
      skipped += 1
      continue
    }
    await client.query('begin')
    try {
      const next = await client.query(
        'select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = $1 and doc_id = $2',
        [doc.collection, doc.doc_id],
      )
      const seq = next.rows[0].seq
      await client.query(
        'insert into public.content_versions (collection, doc_id, seq, data) values ($1, $2, $3, $4)',
        [doc.collection, doc.doc_id, seq, JSON.stringify(doc.data)],
      )
      await client.query('select public.content_go_live($1, $2, $3)', [doc.collection, doc.doc_id, seq])
      await client.query(
        "insert into public.audit_events (action, entity, entity_id, summary) values ('content.import', $1, $2, $3)",
        [doc.collection, doc.doc_id, JSON.stringify({ seq })],
      )
      await client.query('commit')
      imported += 1
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
} finally {
  await client.end()
}

console.log(`Imported ${imported} document(s), skipped ${skipped} already published.`)
