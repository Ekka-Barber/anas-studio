// For each function a new migration (re)defines, diff its body against the previous final definition across the older migrations.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
const [newFile] = process.argv.slice(2)
const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const re = /create (?:or replace )?function ([a-z_]+\.[a-z_0-9]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$;/g
function bodies(text) { const m = {}; let x; while ((x = re.exec(text))) m[x[1]] = x[0]; return m }
const newText = readFileSync(`${dir}/${newFile}`, 'utf8')
const newBodies = bodies(newText)
const older = {}
for (const f of files) { if (f >= newFile) continue; Object.assign(older, bodies(readFileSync(`${dir}/${f}`, 'utf8'))) }
const tmp = 'C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/e4be5ed4-f198-443e-9131-354d6dec169a/scratchpad/fndiff'
mkdirSync(tmp, { recursive: true })
for (const [name, body] of Object.entries(newBodies)) {
  if (!older[name]) { console.log(`\n##### ${name}: NEW (${body.split('\n').length} lines)`); continue }
  writeFileSync(`${tmp}/a.sql`, older[name] + '\n'); writeFileSync(`${tmp}/b.sql`, body + '\n')
  let out = ''
  try { execSync(`diff -u "${tmp}/a.sql" "${tmp}/b.sql"`, { encoding: 'utf8' }) } catch (e) { out = e.stdout }
  console.log(`\n##### ${name}: ${out.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).length} changed lines`)
  console.log(out.split('\n').slice(2).join('\n'))
}
