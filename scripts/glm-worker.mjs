// Runs one worker task on Z.AI GLM-5.3 (D30) in a separate Claude Code
// process, so the orchestrator's own session stays on the Anthropic
// subscription. Only ZAI_API_KEY is taken from `.env`, and it is never printed.
// Usage, from the repo root: node scripts/glm-worker.mjs <brief-file>
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const briefPath = process.argv[2]
if (!briefPath) {
  console.error('Usage: node scripts/glm-worker.mjs <brief-file>')
  process.exit(2)
}

const key = parseEnv(readFileSync('.env', 'utf8')).ZAI_API_KEY
if (!key) {
  console.error('ZAI_API_KEY is missing from .env.')
  process.exit(1)
}

const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
  ANTHROPIC_AUTH_TOKEN: key,
  API_TIMEOUT_MS: '3000000',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
}
// An inherited API key would win over the Z.AI token, and the nested-session
// marker would stop the child from starting.
delete env.ANTHROPIC_API_KEY
delete env.CLAUDECODE

// The worker contract (no commits, no .env, no new writers) is in the agent
// file. ponytail: prefix deny rules only stop accidents, they are not a
// sandbox; the orchestrator's diff audit is the real control.
const result = spawnSync(
  'claude',
  [
    '-p',
    // User settings are skipped: an `env` block there overrides the process
    // env above, and the owner's routes every session through a local proxy.
    '--setting-sources', 'project,local',
    '--agent', 'glm-worker',
    '--model', 'glm-5.3[1m]',
    '--effort', 'max',
    '--tools', 'Read,Write,Edit,Bash,Grep,Glob',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash',
    '--disallowedTools',
    'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)',
    'Bash(git restore:*)', 'Bash(git clean:*)', 'Bash(git stash:*)',
    'Read(./.env)', 'Edit(./.env)',
    '--strict-mcp-config',
    '--output-format', 'json',
  ],
  { env, input: readFileSync(briefPath, 'utf8'), stdio: ['pipe', 'inherit', 'inherit'] },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
