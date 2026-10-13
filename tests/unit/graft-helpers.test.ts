import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The two helpers .claude/settings.json runs for graft, the session hooks and the status line, run @nanonets/graft only
// at the version .mcp.json pins, and only from the places they name (FABLE-AUDIT SUPPLY-02, FIX-A1-05). graft's own
// installer can regenerate them (PLANS/HANDOFF.md), so this is what notices when a regenerated helper undoes the pin.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const helpersDir = join(repoRoot, '.claude', 'helpers')
const HELPERS = { hooks: 'graft-hooks.cjs', statusline: 'graft-statusline.cjs' } as const
type Helper = keyof typeof HELPERS
const helperSource = (helper: Helper) => readFileSync(join(helpersDir, HELPERS[helper]), 'utf8')
const mcpPin = /@nanonets\/graft@(\d+\.\d+\.\d+)/.exec(readFileSync(join(repoRoot, '.mcp.json'), 'utf8'))?.[1]

describe('the graft helpers', () => {
  it('pin the version of graft that .mcp.json runs, both of them', () => {
    expect(mcpPin).toMatch(/^\d+\.\d+\.\d+$/)
    for (const helper of Object.keys(HELPERS) as Helper[]) {
      expect(/^const PINNED = '([^']+)';$/m.exec(helperSource(helper))?.[1], helper).toBe(mcpPin)
    }
  })

  it('find the package the same way: everything from the requires to the entry point is the same in both', () => {
    const resolution = (helper: Helper) => {
      const source = helperSource(helper)
      return source.slice(source.indexOf("const path = require('path');"), source.search(/^const (hooks|statusline) = entry\(/m))
    }
    expect(resolution('hooks')).toContain('function entry(name)')
    expect(resolution('statusline')).toBe(resolution('hooks'))
  })
})

// The helpers run against stand-in packages that only write down that they ran, in a throwaway project, with a stand-in
// npm first on PATH that logs where it ran and names a throwaway global root. POSIX only (the stand-in npm is a shell
// script). Skipped where a real graft sits in the node install's own node_modules, the one place the helpers look that
// a test cannot point elsewhere: the helpers would run it.
const CAN_STUB = process.platform !== 'win32'
const REAL_GRAFT_BESIDE_NODE = existsSync(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@nanonets', 'graft'))

describe.skipIf(!CAN_STUB || REAL_GRAFT_BESIDE_NODE)('the graft helpers, run', { timeout: 60_000 }, () => {
  let root: string
  let bin: string

  beforeAll(() => {
    // The real path: an imported module's URL is its real path (macOS's temp folder is behind a link).
    root = realpathSync(mkdtempSync(join(tmpdir(), 'anasaq-graft-helpers-')))
    bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\npwd -P >> "$NPM_LOG"\nprintf \'%s\\n\' "$FAKE_GLOBAL_ROOT"\n')
    chmodSync(join(bin, 'npm'), 0o755)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** A module that writes down that it ran, which entry point it was and from where. */
  const recorder = (entry: string) =>
    `import { appendFileSync } from 'node:fs'\nexport function main(arg) { appendFileSync(process.env.GRAFT_RAN, ${JSON.stringify(entry)} + ' ' + String(arg) + ' ' + import.meta.url + '\\n') }\n`

  /** A stand-in @nanonets/graft inside `modulesDir`, a node_modules folder. */
  function standIn(modulesDir: string, pkg: { name?: string; version?: string } = {}) {
    const dir = join(modulesDir, '@nanonets', 'graft')
    mkdirSync(join(dir, 'dist', 'claude'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name ?? '@nanonets/graft', version: pkg.version ?? mcpPin, type: 'module' }))
    for (const entry of ['hooks', 'statusline']) writeFileSync(join(dir, 'dist', 'claude', `${entry}.js`), recorder(entry))
    return dir
  }

  /** A fresh case: `outer` holds the project, an empty global root and the logs; `setup` places the stand-ins. */
  function place(setup: (paths: { outer: string; project: string; globalRoot: string }) => void) {
    const outer = mkdtempSync(join(root, 'case-'))
    const paths = { outer, project: join(outer, 'project'), globalRoot: join(outer, 'global', 'node_modules') }
    mkdirSync(paths.project)
    mkdirSync(paths.globalRoot, { recursive: true })
    setup(paths)
    return paths
  }

  function run(helper: Helper, paths: { outer: string; project: string; globalRoot: string }) {
    const ranLog = join(paths.outer, `${helper}-ran.txt`)
    const npmLog = join(paths.outer, `${helper}-npm.txt`)
    const result = spawnSync(process.execPath, [join(helpersDir, HELPERS[helper]), ...(helper === 'hooks' ? ['session-start'] : [])], {
      cwd: paths.project,
      encoding: 'utf8',
      input: helper === 'statusline' ? '{}' : '',
      // Nothing of the caller's environment: PATH holds the stand-in npm and nothing else.
      env: { NODE_ENV: 'test', PATH: bin, HOME: paths.outer, CLAUDE_PROJECT_DIR: paths.project, GRAFT_RAN: ranLog, NPM_LOG: npmLog, FAKE_GLOBAL_ROOT: paths.globalRoot },
    })
    const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [])
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, ran: lines(ranLog), npmCwds: lines(npmLog) }
  }

  const BOTH: Helper[] = ['hooks', 'statusline']
  const nodeDir = () => realpathSync(dirname(process.execPath))
  /** What the stand-in in `pkg` writes when `helper` runs it: the hooks get the hook's name, the status line nothing. */
  const ranLine = (helper: Helper, pkg: string) =>
    `${helper} ${helper === 'hooks' ? 'session-start' : 'undefined'} ${pathToFileURL(join(pkg, 'dist', 'claude', `${helper}.js`)).href}`

  it.each(BOTH)('%s: runs the pinned package from the project\'s node_modules, without asking npm', (helper) => {
    let pkg = ''
    const paths = place(({ project }) => {
      pkg = standIn(join(project, 'node_modules'))
    })
    const { status, stderr, ran, npmCwds } = run(helper, paths)
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
    expect(ran).toEqual([ranLine(helper, pkg)])
    expect(npmCwds).toEqual([])
  })

  it.each(BOTH)('%s: runs the pinned package from the global root npm names, and asks npm from the node binary\'s folder, never the project', (helper) => {
    let pkg = ''
    const paths = place(({ globalRoot }) => {
      pkg = standIn(globalRoot)
    })
    const { status, stderr, ran, npmCwds } = run(helper, paths)
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
    expect(ran).toEqual([ranLine(helper, pkg)])
    expect(npmCwds).toEqual([nodeDir()])
  })

  it.each([
    ['another version in the project and in the global root', ({ project, globalRoot }: { project: string; globalRoot: string }) => {
      standIn(join(project, 'node_modules'), { version: '0.0.1-other' })
      standIn(globalRoot, { version: '999.0.0' })
    }],
    ['a package of another name in graft\'s place', ({ project }: { project: string }) => {
      standIn(join(project, 'node_modules'), { name: '@nanonets/graft-other' })
    }],
    ['the pinned package in a node_modules above the project', ({ outer }: { outer: string }) => {
      standIn(join(outer, 'node_modules'))
    }],
    ['a build committed in the project\'s dist folder', ({ project }: { project: string }) => {
      mkdirSync(join(project, 'dist', 'claude'), { recursive: true })
      for (const entry of ['hooks', 'statusline']) writeFileSync(join(project, 'dist', 'claude', `${entry}.js`), recorder(entry))
      writeFileSync(join(project, 'package.json'), JSON.stringify({ name: '@nanonets/graft', version: mcpPin, type: 'module' }))
    }],
  ] as [string, (paths: { outer: string; project: string; globalRoot: string }) => void][])('runs nothing, quietly, for %s', (_name, setup) => {
    for (const helper of BOTH) {
      const paths = place(setup)
      const { status, stderr, stdout, ran, npmCwds } = run(helper, paths)
      expect({ helper, status, stderr, stdout, ran }).toEqual({ helper, status: 0, stderr: '', stdout: '', ran: [] })
      // Every cheap place missed, so npm was asked, from the node binary's folder.
      expect(npmCwds).toEqual([nodeDir()])
    }
  })
})
