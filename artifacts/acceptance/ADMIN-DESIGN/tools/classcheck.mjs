// Every styles.X / styles['X'] used by a file that imports admin.module.css must be a class the stylesheet defines.
// Usage, from the repository: grep -rl admin.module.css src --include=*.tsx > <list>; node <this file> . <list>
import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2]
const files = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n')
const css = fs.readFileSync(path.join(root, 'src/components/admin/admin.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))
const used = new Map()
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8')
  for (const m of src.matchAll(/styles(?:\.([A-Za-z_]\w*)|\[['"]([\w-]+)['"]\])/g)) {
    const name = m[1] ?? m[2]
    if (!used.has(name)) used.set(name, new Set())
    used.get(name).add(f)
  }
  if (/styles\[(?!['"])/.test(src)) console.log('DYNAMIC styles[...] in', f)
}
const missing = [...used.keys()].filter((n) => !defined.has(n))
console.log('used', used.size, 'defined', defined.size)
for (const n of missing) console.log('MISSING', n, [...used.get(n)].join(', '))
const unused = [...defined].filter((n) => !used.has(n))
console.log('defined but unused by these files:', unused.join(' '))
