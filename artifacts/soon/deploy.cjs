// Deploys the soon and maintenance pages to Anas's Cloudflare account. Run
// from the repository:
//   node artifacts/soon/deploy.cjs                      (the mode in wrangler.toml)
//   node artifacts/soon/deploy.cjs --mode=maintenance   (or --mode=soon)
// It reads .env itself and takes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// from there and from nowhere else, and refuses when .env lacks either. A shell
// that holds a different value for either (Node's --env-file never overrides a
// variable the shell already has, so a shell set up for another account used to
// win) gets one line naming the variable, never its value, and .env's is used.
// It hands wrangler those two and nothing else from .env, and deploys from a
// copy outside the repository, whose wrangler cache pins another account.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseEnv } = require('node:util')

const keep = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
const dotenv = parseEnv(fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8'))
for (const name of keep) {
  if (!dotenv[name]) throw new Error(`${name} is not in .env`)
  if (process.env[name] !== undefined && process.env[name] !== dotenv[name]) {
    console.log(`${name} in the shell differs from .env; using .env's.`)
  }
}
if (process.argv.slice(2).some((arg) => !/^--mode=(soon|maintenance)$/.test(arg))) throw new Error('usage: deploy.cjs [--mode=soon|maintenance]')
const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice(7)

const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'anas-soon-'))
fs.cpSync(path.join(__dirname, 'site'), path.join(copy, 'site'), { recursive: true })
fs.copyFileSync(path.join(__dirname, 'worker.js'), path.join(copy, 'worker.js'))
const config = fs.readFileSync(path.join(__dirname, 'wrangler.toml'), 'utf8')
fs.writeFileSync(path.join(copy, 'wrangler.toml'), mode ? config.replace(/^MODE = ".*"$/m, `MODE = "${mode}"`) : config)

// Wrangler gets the two Cloudflare variables from .env and nothing else that .env defines.
const env = { ...process.env }
for (const name of Object.keys(dotenv)) delete env[name]
// Nor any other Cloudflare credential the shell holds (a global API key and its email, the legacy CF_ names): wrangler
// could sign in with one of them as another user.
for (const name of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(name)) delete env[name]
for (const name of keep) env[name] = dotenv[name]
const { status } = spawnSync('npx', ['--yes', 'wrangler@4.114.0', 'deploy'], { cwd: copy, env, stdio: 'inherit', shell: true })
fs.rmSync(copy, { recursive: true, force: true })
process.exit(status ?? 1)
