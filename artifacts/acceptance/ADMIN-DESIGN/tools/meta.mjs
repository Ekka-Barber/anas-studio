// Writes review/meta.json, the screen list the review page is built from: each screen's id, path, role, heading and
// note (from the harness's own list), and the height of each shot in both sets (from shots/<set>/report.json).
// Usage: node tools/meta.mjs
import fs from 'node:fs'
import path from 'node:path'
import { buildData } from '../harness/lib/data.mjs'
import { buildScreens } from '../harness/lib/screens.mjs'

const evidence = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const repoRoot = path.resolve(evidence, '../../..')
const screens = buildScreens(buildData({ now: Date.parse('2026-10-08T10:30:00+03:00'), siteDir: repoRoot }))
const heights = (set) => {
  const report = JSON.parse(fs.readFileSync(path.join(evidence, 'shots', set, 'report.json'), 'utf8'))
  return new Map(report.screens.map((shot) => [`${shot.screen}-${shot.width}`, shot.pageHeight]))
}
const before = heights('before')
const after = heights('after')
const meta = screens.map((s) => ({
  id: s.id,
  path: s.path,
  role: s.role ?? 'owner',
  signedOut: Boolean(s.signedOut),
  dialog: Boolean(s.viewportOnly),
  h1: s.h1 instanceof RegExp ? s.h1.source : s.h1,
  note: s.note,
  h: Object.fromEntries([360, 1440].map((w) => [w, { before: before.get(`${s.id}-${w}`) ?? null, after: after.get(`${s.id}-${w}`) ?? null }])),
}))
const missing = meta.flatMap((m) => [360, 1440].flatMap((w) => ['before', 'after'].filter((k) => m.h[w][k] === null).map((k) => `${m.id}-${w} ${k}`)))
if (missing.length > 0) throw new Error(`shots missing from a report: ${missing.join(', ')}`)
fs.writeFileSync(path.join(evidence, 'review', 'meta.json'), JSON.stringify(meta, null, 1) + '\n')
console.log(`review/meta.json: ${meta.length} screens`)
