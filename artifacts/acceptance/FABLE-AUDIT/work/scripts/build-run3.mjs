// Builds the run-3 workflow script from the run-2 one: Opus 5.5 (effort max) finders only,
// lead files from the earlier attempts, no verifier agents (Fable verifies itself).
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'C:/Users/alazi/.claude/projects/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/e4be5ed4-f198-443e-9131-354d6dec169a/workflows/scripts/fable-audit-find-verify-2-wf_2c780fb0-838.js'
const OUT = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/e4be5ed4-f198-443e-9131-354d6dec169a/scratchpad/fable-audit-3.js'

const src = readFileSync(SRC, 'utf8')
let head = src.slice(0, src.indexOf('const rank ='))

const must = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`not found: ${from.slice(0, 60)}`)
  return text.replace(from, to)
}

head = must(head, "name: 'fable-audit-find-verify-2',", "name: 'fable-audit-opus-finders',")
head = must(head, "description: 'FABLE-AUDIT run 2: read-only deep audit of anas.studio in 33 slices with persisted partial results, each finding adversarially verified',", "description: 'FABLE-AUDIT run 3: 33 read-only Opus 5.5 (effort max) auditors, one slice each; Fable, the orchestrator, verifies their findings itself',")
head = head.replace(/phases: \[[\s\S]*?\],\n\}/, "phases: [{ title: 'Find', detail: '33 read-only auditors on Opus 5.5 at effort max, one slice each' }],\n}")
head = must(head, 'Your SCRATCH folder may already hold measurement files (screenshots, JSON, scripts) from the cut-off attempt: reuse them to save time, but re-verify anything before you cite it.', 'Measurement files (screenshots, JSON, scripts) from the earlier attempts are under SCRATCH\\\\prev\\\\<your slice key>\\\\: reuse them to save time, but re-verify anything before you cite it.')
head = head.replace(/const RESUMED = new Set\([^\n]*\n/, '')
head = head.replace(/const RESUME = `CONTINUING A CUT-OFF ATTEMPT[\s\S]*?`\n\n/, '')
head = must(head, "    RESUMED.has(s.key) ? RESUME : '',\n", "    LEADS.has(s.key) ? LEADS_NOTE(s.key) : '',\n")

const leadsNote = `const LEADS = new Set(['DB-POST', 'EF-MONEY', 'DB-PAY', 'DB-OPS', 'DB-CORE', 'EF-ACCESS', 'CONTRACT', 'EF-ADMIN', 'DB-COMMERCE', 'CLIENT-SEC', 'DOCS', 'P08-CKPT', 'SUPPLY', 'TEST-E2E', 'TEST-UNIT'])
const LEADS_NOTE = (key) => \`LEADS FROM AN EARLIER ATTEMPT (another model, unverified)
An earlier auditor of this slice, on a different model, was cut off; what it had written is in \${SCRATCH}\\\\leads\\\\\${key}.json (findings, prior_fix_checks, plan_gaps, doc_claims_checked, coverage). Read it AFTER your own first pass, not before, so it does not anchor you. Then, for every lead: confirm it from the code (include it in your findings with your own evidence, keeping the lead's id in prior_overlap as 'lead:<id>'), or refute it (list it in coverage with the reason, one line each), or extend it. Your own new findings are the point: find what it missed.\`

`
head = must(head, 'function finderPrompt(s) {', leadsNote + 'function finderPrompt(s) {')

// drop the verifier and lens prompt builders: Fable verifies the findings itself
const vp = head.indexOf('function verifyPrompt(')
if (vp === -1) throw new Error('verifyPrompt not found')
head = head.slice(0, vp)

const tail = `
let limitHit = false
let consecutiveNulls = 0
async function guarded(label, call) {
  if (limitHit) { log(\`\${label}: skipped, the quota limit was hit earlier\`); return null }
  try {
    const out = await call()
    if (out === null || out === undefined) {
      consecutiveNulls += 1
      log(\`\${label} returned nothing (\${consecutiveNulls} in a row)\`)
      if (consecutiveNulls >= 2) { limitHit = true; log('two agents in a row returned nothing: treating it as the quota limit, no further agent is dispatched') }
      return null
    }
    consecutiveNulls = 0
    return out
  } catch (error) {
    const message = String(error && error.message || error).slice(0, 300)
    if (/limit|quota/i.test(message)) { limitHit = true; log(\`\${label} FAILED on the quota limit; no further agent is dispatched: \${message}\`) }
    else log(\`\${label} FAILED: \${message}\`)
    return null
  }
}

phase('Find')
const results = await parallel(SLICES.map((s) => async () => {
  const r = await guarded(\`find:\${s.key}\`, () => agent(finderPrompt(s), { label: \`find:\${s.key}\`, phase: 'Find', schema: FINDINGS_SCHEMA, model: 'opus', effort: 'max' }))
  if (r) log(\`find:\${s.key} -> \${r.findings.length} findings (\${r.model_id})\`)
  return r ? { key: s.key, ...r } : { key: s.key, failed: true }
}))

const done = results.filter(Boolean)
const ok = done.filter((x) => !x.failed)
const all = ok.flatMap((x) => x.findings)
const sevs = ['critical', 'high', 'medium', 'low', 'info']
const bySev = Object.fromEntries(sevs.map((sev) => [sev, all.filter((f) => f.severity === sev).length]))
log(\`total \${all.length} findings; \${JSON.stringify(bySev)}; limitHit \${limitHit}\`)
return {
  limitHit,
  failedSlices: done.filter((x) => x.failed).map((x) => x.key),
  missingSlices: SLICES.map((s) => s.key).filter((k) => !done.some((x) => x.key === k)),
  totals: { raw: all.length, bySeverity: bySev },
  slices: ok.map((x) => ({
    key: x.key,
    model_id: x.model_id,
    counts: Object.fromEntries(sevs.map((sev) => [sev, x.findings.filter((f) => f.severity === sev).length])),
    findings: x.findings.map((f) => \`\${f.id} | \${f.severity} | \${f.file}:\${f.line} | \${String(f.title).slice(0, 150)}\${f.needs_owner ? ' | OWNER' : ''}\${f.needs_runtime_proof ? ' | RUNTIME' : ''} | fix:\${f.fix_size}\`),
    priorFixesNotHolding: (x.prior_fix_checks || []).filter((c) => !c.holds).map((c) => \`\${c.prior_id}: \${String(c.claim).slice(0, 160)}\`),
    priorFixesChecked: (x.prior_fix_checks || []).length,
    planGaps: (x.plan_gaps || []).map((g) => \`\${g.urgency}\${g.owner_decision ? ' OWNER' : ''} | \${g.package} | \${String(g.title).slice(0, 160)}\`),
    vendorClaimsFalse: (x.doc_claims_checked || []).filter((c) => c.verdict === 'false').map((c) => String(c.claim).slice(0, 200)),
    vendorClaimsChecked: (x.doc_claims_checked || []).length,
    coverage: String(x.coverage || '').slice(0, 400),
  })),
}
`

const out = head + tail
writeFileSync(OUT, out)
console.log('written', out.length, 'chars')
console.log('opus/max calls:', (out.match(/model: 'opus', effort: 'max'/g) || []).length, '| fable mentions:', (out.match(/'fable'/g) || []).length, '| verifyPrompt left:', out.includes('verifyPrompt'), '| SLICES:', (out.match(/\{ key: '/g) || []).length)
