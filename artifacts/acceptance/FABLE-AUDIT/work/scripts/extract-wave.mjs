// Collects the finders' full results from a workflow journal into one JSON and a readable markdown digest.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const [journal, outBase] = process.argv.slice(2)
const started = {}
const slices = []
for (const line of readFileSync(journal, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let o; try { o = JSON.parse(line) } catch { continue }
  if (o.type === 'started') started[o.key] = o.label
  if (o.type === 'result' && o.result && Array.isArray(o.result.findings)) slices.push({ key: (started[o.key] || 'find:?').slice(5), ...o.result })
}
mkdirSync(outBase, { recursive: true })
writeFileSync(`${outBase}/findings.json`, JSON.stringify(slices, null, 1))
const rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
const all = slices.flatMap((s) => s.findings.map((f) => ({ ...f, slice: s.key })))
all.sort((a, b) => rank[b.severity] - rank[a.severity] || a.id.localeCompare(b.id))
let md = `# Wave digest: ${slices.length} slices, ${all.length} findings\n\n`
for (const f of all) {
  md += `### ${f.id} [${f.severity}] ${f.title}\n${f.file}:${f.line}${f.needs_owner ? ' OWNER' : ''}${f.needs_runtime_proof ? ' RUNTIME' : ''} fix:${f.fix_size} conf:${f.confidence}${f.prior_overlap ? ' prior:' + f.prior_overlap : ''}\nEVIDENCE: ${f.evidence}\nIMPACT: ${f.impact}\nFIX: ${f.proposed_fix}\n${f.proof_recipe ? 'PROOF: ' + f.proof_recipe + '\n' : ''}\n`
}
md += `\n# Prior-fix checks not holding\n`
for (const s of slices) for (const c of s.prior_fix_checks || []) if (!c.holds) md += `- [${s.key}] ${c.prior_id}: ${c.claim} — ${c.evidence}\n`
md += `\n# Plan gaps\n`
for (const s of slices) for (const g of s.plan_gaps || []) md += `- [${s.key}] ${g.urgency}${g.owner_decision ? ' OWNER' : ''} | ${g.package} | ${g.title}\n  WHY: ${g.why_needed}\n  TOUCHES: ${g.touches}\n`
md += `\n# Vendor claims false or unverifiable\n`
for (const s of slices) for (const c of s.doc_claims_checked || []) if (c.verdict !== 'true') md += `- [${s.key}] ${c.verdict}: ${c.claim} (${c.where}) — ${c.evidence}\n`
md += `\n# Coverage\n`
for (const s of slices) md += `## ${s.key}\n${s.coverage}\n\n`
writeFileSync(`${outBase}/digest.md`, md)
console.log(slices.map((s) => `${s.key}:${s.findings.length}`).join(' '), '| total', all.length, '| md chars', md.length)
