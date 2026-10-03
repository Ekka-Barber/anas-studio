export const meta = {
  name: 'p08-round',
  description: 'One P08 round: a fresh Sonnet worker builds, an Opus auditor audits the diff, at most two re-fix rounds with fresh workers',
  phases: [
    { title: 'Build', detail: 'one sonnet-worker (Sonnet 5.5, effort max)', model: 'sonnet' },
    { title: 'Audit', detail: 'one auditor (Opus 5.5, effort max) on the round diff', model: 'opus' },
    { title: 'Re-fix', detail: 'a fresh sonnet-worker per fix round, then the auditor again', model: 'sonnet' },
  ],
}

// args: { round, title, brief, files: string[], checks: string[], auditFocus, readFirst?: string[] }
const a = args
if (!a || !a.round || !a.brief || !Array.isArray(a.files) || !Array.isArray(a.checks)) {
  throw new Error('p08-round needs args { round, title, brief, files, checks, auditFocus }')
}

const WORKER = { agentType: 'sonnet-worker', model: 'sonnet', effort: 'max' }
const AUDITOR = { agentType: 'auditor', model: 'opus', effort: 'max' }

const WORKER_REPORT = {
  type: 'object',
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, exitCode: { type: 'integer' }, note: { type: 'string' } },
        required: ['command', 'exitCode'],
      },
    },
    evidence: { type: 'array', items: { type: 'string' } },
    contractGaps: { type: 'array', items: { type: 'string' } },
    openRisks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['filesChanged', 'checks', 'contractGaps', 'openRisks', 'summary'],
}

const AUDIT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'audit_failed'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          correction: { type: 'string' },
          orchestrator: { type: 'boolean' },
        },
        required: ['id', 'severity', 'file', 'problem', 'evidence', 'correction', 'orchestrator'],
      },
    },
    checksRerun: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, exitCode: { type: 'integer' } },
        required: ['command', 'exitCode'],
      },
    },
    pathsOutsideAllowlist: { type: 'array', items: { type: 'string' } },
    uncovered: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings', 'checksRerun', 'pathsOutsideAllowlist', 'uncovered'],
}

const fileList = a.files.map((f) => `- ${f}`).join('\n')
const checkList = a.checks.map((c) => `- ${c}`).join('\n')
const readFirst = (a.readFirst || []).map((f) => `- ${f}`).join('\n')

const RULES = `Ground rules (ANASAQ P08):
- Read PLANS/P08-CONTRACT.md in full before anything else. It is the contract between the layers; build exactly what it says. If it cannot be built as written, or it disagrees with the code P07 left, do NOT improvise: build what is unambiguous, and list the rest under contractGaps.
- Write ONLY the paths listed below. Never touch PLANS/, _archive/, deploy/design/, .env, .anasaq-execution.lock or .claude/. Never commit, never push, never run git commands that change the tree (no checkout, stash, reset, restore).
- No network call to Moyasar (api.moyasar.com, checkout.moyasar.com), ever. Every provider shape is in the contract's section 2; do not add any from memory.
- The local Supabase stack is running. Never stop it. Apply a new migration with: pnpm exec supabase migration up --local. Only when a migration of THIS round was edited after it had been applied (so it cannot be applied again), rebuild the local database, in one foreground command with a timeout: pnpm exec supabase db reset && pnpm db:import && pnpm db:demo-catalog (both imports need DATABASE_URL=<DB_URL from "pnpm exec supabase status -o json">). Do that at most twice in the round, never to hide a failing test. If the functions answer 503 afterwards: docker start supabase_edge_runtime_ANASAQ.ME. Never edit a migration of an earlier round: add to this round's own file.
- Database tests: TEST_ENV=local DATABASE_URL=<DB_URL from "pnpm exec supabase status -o json"> pnpm exec vitest run --mode db <file>. Never print a key or a secret. Never open, read, grep or print any .env file (the repository's .env, .env.local or supabase/functions/.env), not even to derive a test value: values reach the tests through process.env and the scripts that already load them.
- Money is integer halalas. Arabic user-facing text, ASCII codes, Latin digits. No em dashes in Arabic copy (pnpm check:copy enforces the house rules).
- Token discipline: read each file once, batch edits, run each long command once in the foreground with a timeout, no sleep or polling loops, no background process left running. After two failed attempts at the same problem, stop and report.
- Match the surrounding code's style, comment density and naming. The smallest change that fully does the job; no speculative options, no new dependency.`

const brief = `You are the single writer for ANASAQ package P08, round ${a.round}: ${a.title}.

${RULES}

Read first (besides the contract):
${readFirst || '- (the files named in the task)'}

TASK
${a.brief}

PATHS YOU MAY WRITE (and no others)
${fileList}

CHECKS TO RUN (each once; report every one as command and exit code; a failing check you could not fix is reported as it is, never hidden)
${checkList}

Return the structured report: filesChanged, checks, evidence (paths of anything you produced as proof), contractGaps (anything in the contract you could not build as written, or that the code contradicts), openRisks, and a summary of at most 25 lines.`

function auditPrompt(reports, previous) {
  return `Audit round ${a.round} of ANASAQ package P08 ("${a.title}") before the orchestrator accepts it. You never fix and never write a file. Read PLANS/P08-CONTRACT.md in full first: the round is judged against it.

What the round was asked to build:
${a.brief}

Paths the round may write:
${fileList}

The worker report(s), which are claims, not evidence:
${JSON.stringify(reports)}

${previous ? `Your previous findings on this round (check each is truly fixed at its cause, not hidden by a loosened assertion, a retry, a skipped test or a comment; then look for new defects the fix introduced):\n${JSON.stringify(previous)}\n` : ''}
Procedure:
1. git status --short and git diff (and read every new file whole). Any changed path outside the allowlist goes in pathsOutsideAllowlist (ignore .claude/, PLANS/P08-CONTRACT.md, artifacts/acceptance/P08/ and the round-0 files the orchestrator wrote: supabase/config.toml, scripts/local-env.mjs, scripts/check-export.mjs, .env.example, package.json's emulator script, and the placeholder index.ts of payments, orders, download, notify unless this round rewrites them).
2. Compare what was built with the contract field by field: SQL signatures, argument and reply names, grants and revokes, state transitions, codes, Edge Function requests and replies, emulator routes, environment names. A mismatch between two layers is a finding even when the tests pass.
3. Read every SQL function and every money, token and file path line by line. Look for: a lock taken in another order than the contract's; a check outside the lock; a path that settles twice; a refusal that leaks whether something exists; a secret, token, address or provider payload stored, logged or put in an outbox payload; a function executable by a role that must not have it; SQL that is not schema-qualified under search_path ''.
4. Re-run the round's checks that are cheap and decisive and record them in checksRerun with their exit codes: ${a.checks.join(' ; ')}. Database tests need TEST_ENV=local and DATABASE_URL from "pnpm exec supabase status -o json". Never stop or reset the stack; never print a key.
5. Judge the tests: does each one fail if the behaviour it names breaks? Name the negative, duplicate, out-of-order, retry, race and crash cases the contract's section 11 demands for this round that have no test.
6. No invented price, payment, approval or closed gate; no network call to Moyasar; Arabic copy, Latin digits.

Focus for this round: ${a.auditFocus || 'the contract, as above'}

Set orchestrator: true on a finding whose correction lies outside the round's allowlist (another round's file, PLANS/, a contract ruling); a worker cannot fix those, the orchestrator does. Verdict: audit_failed if any critical, high or medium finding stands; pass otherwise (low findings are listed for the orchestrator). Every finding names file and line, the problem in plain words, the evidence, and the concrete correction. No hedged verdicts, no style notes.`
}

function fixPrompt(audit, n) {
  const blocking = audit.findings.filter((f) => f.severity !== 'low' && !f.orchestrator)
  return `You are a fresh single writer for ANASAQ package P08, round ${a.round} ("${a.title}"), fix pass ${n}. An Opus auditor found defects in this round's work. Fix each one at its cause.

${RULES}

What the round builds:
${a.brief}

PATHS YOU MAY WRITE (and no others)
${fileList}

FINDINGS TO FIX (all of them; a finding you believe is wrong is reported under contractGaps with your evidence, and left alone)
${JSON.stringify(blocking)}

Also fix these low findings where the fix is a few lines and safe:
${JSON.stringify(audit.findings.filter((f) => f.severity === 'low' && !f.orchestrator))}

Paths changed outside the allowlist that must be put back exactly as they were (edit them back by hand; do not use git to revert): ${JSON.stringify(audit.pathsOutsideAllowlist)}

Rules for a fix: remove the cause. Never loosen an assertion, add a retry, skip a test or widen a type to make a check pass. Add or correct the test that would have caught the defect.

CHECKS TO RUN (each once; report command and exit code)
${checkList}

Return the structured report as before.`
}

phase('Build')
const reports = []
const first = await agent(brief, { label: `r${a.round}:worker`, phase: 'Build', schema: WORKER_REPORT, ...WORKER })
if (!first) return { round: a.round, status: 'worker_died', reports, audits: [] }
reports.push(first)

phase('Audit')
const audits = []
let audit = await agent(auditPrompt(reports, null), { label: `r${a.round}:audit`, phase: 'Audit', schema: AUDIT, ...AUDITOR })
if (!audit) return { round: a.round, status: 'auditor_died', reports, audits }
audits.push(audit)

let pass = 0
const workerCanFix = (x) => x.findings.some((f) => f.severity !== 'low' && !f.orchestrator)
while (audit.verdict === 'audit_failed' && workerCanFix(audit) && pass < 2) {
  pass += 1
  phase('Re-fix')
  log(`round ${a.round}: audit failed with ${audit.findings.filter((f) => f.severity !== 'low').length} blocking finding(s); fix pass ${pass}`)
  const fix = await agent(fixPrompt(audit, pass), { label: `r${a.round}:fix${pass}`, phase: 'Re-fix', schema: WORKER_REPORT, ...WORKER })
  if (!fix) return { round: a.round, status: 'fix_worker_died', reports, audits }
  reports.push(fix)
  const again = await agent(auditPrompt(reports, audit), { label: `r${a.round}:reaudit${pass}`, phase: 'Re-fix', schema: AUDIT, ...AUDITOR })
  if (!again) return { round: a.round, status: 'auditor_died', reports, audits }
  audit = again
  audits.push(audit)
}

return { round: a.round, status: audit.verdict === 'pass' ? 'audit_pass' : workerCanFix(audit) ? 'audit_failed_after_two_fixes' : 'needs_orchestrator', fixPasses: pass, reports, audits }
