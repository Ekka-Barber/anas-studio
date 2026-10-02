// Deploys the soon and maintenance pages to Anas's Cloudflare account. Run
// from the repository:
//   node --env-file=.env artifacts/soon/deploy.cjs                      (the mode in wrangler.toml)
//   node --env-file=.env artifacts/soon/deploy.cjs --mode=maintenance   (or --mode=soon)
// It takes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment
// and hands wrangler nothing else from .env. It deploys from a copy outside
// the repository, whose wrangler cache pins another account.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseEnv } = require('node:util')

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) throw new Error(`${name} is not set`)
}
if (process.argv.slice(2).some((arg) => !/^--mode=(soon|maintenance)$/.test(arg))) throw new Error('usage: deploy.cjs [--mode=soon|maintenance]')
const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice(7)

const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'anas-soon-'))
fs.cpSync(path.join(__dirname, 'site'), path.join(copy, 'site'), { recursive: true })
fs.copyFileSync(path.join(__dirname, 'worker.js'), path.join(copy, 'worker.js'))
const config = fs.readFileSync(path.join(__dirname, 'wrangler.toml'), 'utf8')
fs.writeFileSync(path.join(copy, 'wrangler.toml'), mode ? config.replace(/^MODE = ".*"$/m, `MODE = "${mode}"`) : config)

// Wrangler gets the two Cloudflare variables and nothing else that .env defines.
const keep = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])
const env = { ...process.env }
const dotenv = path.join(__dirname, '..', '..', '.env')
for (const name of Object.keys(parseEnv(fs.readFileSync(dotenv, 'utf8')))) {
  if (!keep.has(name)) delete env[name]
}
const { status } = spawnSync('npx', ['--yes', 'wrangler@4.114.0', 'deploy'], { cwd: copy, env, stdio: 'inherit', shell: true })
fs.rmSync(copy, { recursive: true, force: true })
process.exit(status ?? 1)
