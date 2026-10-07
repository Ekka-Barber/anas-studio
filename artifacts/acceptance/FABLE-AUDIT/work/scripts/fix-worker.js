export const meta = {
  name: 'fable-audit-fix-round',
  description: 'FABLE-AUDIT fix round: one Opus 5.5 (effort max) worker writes a bounded set of fixes under the lock; Fable audits the diff',
  phases: [{ title: 'Fix', detail: 'one worker, one bounded brief' }],
}

const REPORT = {
  type: 'object',
  properties: {
    model_id: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['done', 'partly', 'skipped'] },
          what: { type: 'string' },
          tests: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id', 'status', 'what', 'tests'],
      },
    },
    commands: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exit: { type: 'integer' }, summary: { type: 'string' } }, required: ['command', 'exit', 'summary'] } },
    deviations: { type: 'string' },
    risks: { type: 'string' },
  },
  required: ['model_id', 'files_changed', 'items', 'commands', 'deviations', 'risks'],
}

const { group, brief } = args
phase('Fix')
log(`fix round ${group}`)
const out = await agent(brief, { label: `fix:${group}`, phase: 'Fix', schema: REPORT, model: 'opus', effort: 'max' })
return out ? { group, ...out } : { group, failed: true }
