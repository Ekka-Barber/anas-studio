// usage: node round-report.cjs <journal> <out.md> <title>
const fs = require('fs')
const [journal, outPath, title] = process.argv.slice(2)
// The repository root (this file lives in artifacts/acceptance/P08/tools/), so paths in the report are repository-relative.
const root = require('path').resolve(__dirname, '..', '..', '..', '..') + require('path').sep
const clean = (s) =>
  String(s ?? '')
    .split(root)
    .join('')
    .split('\\')
    .join('/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
const rows = fs
  .readFileSync(journal, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((l) => l.type === 'result')
const out = [`# ${title}`, '']
let w = 0
let a = 0
for (const l of rows) {
  const r = l.result ?? l.value ?? l
  const v = typeof r === 'string' ? JSON.parse(r) : r
  if (!v) continue
  if (v.filesChanged) {
    w += 1
    out.push(`## Worker report ${w}`, '', clean(v.summary), '', 'Files: ' + v.filesChanged.map(clean).join(', '), '', 'Checks:')
    for (const c of v.checks) out.push(`- \`${clean(c.command)}\` → ${c.exitCode}${c.note ? ' (' + clean(c.note) + ')' : ''}`)
    if (v.contractGaps?.length) {
      out.push('', 'Contract gaps:')
      v.contractGaps.forEach((g) => out.push('- ' + clean(g)))
    }
    if (v.openRisks?.length) {
      out.push('', 'Open risks:')
      v.openRisks.forEach((g) => out.push('- ' + clean(g)))
    }
    out.push('')
  } else if (v.verdict) {
    a += 1
    out.push(`## Audit ${a}: ${v.verdict}`, '')
    for (const f of v.findings)
      out.push(
        `### ${f.id} [${f.severity}] ${clean(f.file)}${f.line ? ':' + f.line : ''}`,
        `- Problem: ${clean(f.problem)}`,
        `- Evidence: ${clean(f.evidence)}`,
        `- Correction: ${clean(f.correction)}`,
        '',
      )
    out.push('Checks re-run:')
    for (const c of v.checksRerun) out.push(`- \`${clean(c.command)}\` → ${c.exitCode}`)
    if (v.pathsOutsideAllowlist?.length) out.push('', 'Paths outside the allowlist: ' + v.pathsOutsideAllowlist.map(clean).join(', '))
    if (v.uncovered?.length) {
      out.push('', 'Uncovered:')
      v.uncovered.forEach((u) => out.push('- ' + clean(u)))
    }
    out.push('')
  }
}
fs.writeFileSync(outPath, out.join('\n') + '\n')
console.log('workers', w, 'audits', a)
