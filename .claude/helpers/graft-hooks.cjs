#!/usr/bin/env node
// Runs the session hooks of @nanonets/graft for the one version this repository
// pins and nothing else (FABLE-AUDIT SUPPLY-02 / FIX-A1-05). The pin is the
// version .mcp.json names for the graft MCP server. The package is looked up in
// two kinds of place only, the project's own node_modules and the global npm
// root, and it is imported only when its package.json says exactly that name and
// version. There is no ancestor node_modules search (a package planted further up
// the tree never runs) and no <project>/dist fallback (a committed build never
// runs). When the pinned package is not found the hook does nothing and exits 0.
// graft-statusline.cjs resolves the package the same way. graft's installer can
// regenerate these helpers: after any graft update or MCP reconnect, check
// `git diff .claude/helpers` before committing, and keep PINNED in step with
// `.mcp.json`.
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Keep in step with `@nanonets/graft@<version>` in .mcp.json.
const PINNED = '0.21.1';
const BAKED = "C:\\Users\\alazi\\AppData\\Roaming\\npm\\node_modules\\@nanonets\\graft\\dist\\claude";

// The dist/claude dir of @nanonets/graft inside one node_modules dir (no climbing to its ancestors).
function inModules(modulesDir) {
  return path.join(modulesDir, '@nanonets', 'graft', 'dist', 'claude');
}

// The global node_modules dir per npm (handles Homebrew/Windows/volta). Queried on demand.
function globalRoot() {
  try {
    // Run from the directory of the node binary, never from the project: on Windows `shell: true` hands the line to
    // cmd.exe, which looks in the current directory first, so a committed npm.cmd or npm.bat would run.
    const root = execFileSync('npm', ['root', '-g'], { cwd: path.dirname(process.execPath), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim();
    return root || null;
  } catch { return null; /* npm unavailable */ }
}

// True when the package a dist/claude dir belongs to is exactly the pinned @nanonets/graft.
function isPinned(distClaude) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(distClaude, '..', '..', 'package.json'), 'utf8'));
    return pkg.name === '@nanonets/graft' && pkg.version === PINNED;
  } catch { return false; }
}

// `name` inside a pinned dist/claude dir, or null.
function pinnedEntry(distClaude, name) {
  const file = path.join(distClaude, name);
  return isPinned(distClaude) && fs.existsSync(file) ? file : null;
}

function entry(name) {
  // Cheap candidates first, and only shell out to npm when every one of them misses.
  const cheap = [BAKED, inModules(path.join(dir, 'node_modules')), inModules(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'))];
  for (const distClaude of cheap) {
    const file = pinnedEntry(distClaude, name);
    if (file) return file;
  }
  const gr = globalRoot();
  return gr ? pinnedEntry(inModules(gr), name) : null;
}

const hooks = entry("hooks.js");
if (hooks) import(pathToFileURL(hooks).href).then((m) => m.main(process.argv[2])).catch(() => { /* graft unavailable — no-op */ });
