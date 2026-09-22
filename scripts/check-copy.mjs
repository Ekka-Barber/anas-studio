#!/usr/bin/env node
/**
 * Copy rules for user-facing text.
 *
 * Two settled rules are enforced here because they are easy to break silently:
 *
 * 1. Latin digits only. Arabic text uses `ar-SA-u-nu-latn`, so Arabic-Indic
 *    digits (٠-٩, ۰-۹) must never be typed into source copy. Digits inside
 *    photographed signage and PDF sources are out of scope; this only looks at
 *    application source.
 * 2. No placeholder copy. Lorem ipsum, TODO/FIXME markers and "coming soon"
 *    stand-ins must not reach a user-facing string; an unavailable feature says
 *    so truthfully instead.
 *
 * P01 extends this with the frozen-voice checks once real copy lands.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['src']
const EXTENSIONS = new Set(['.ts', '.tsx'])
const GENERATED = new Set(['src/payload-types.ts', 'src/payload-generated.schema.ts'])

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/
const PLACEHOLDERS = [/lorem ipsum/i, /\bTODO\b/, /\bFIXME\b/, /قريبا[ًا]?\s*\.\.\./, /coming soon/i]

function walk(relativeDir) {
  const entries = readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) files.push(...walk(relative))
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) files.push(relative)
  }
  return files
}

const problems = []
let checked = 0

for (const root of ROOTS) {
  for (const relative of walk(root)) {
    if (GENERATED.has(relative)) continue
    checked += 1
    const lines = readFileSync(path.join(repoRoot, relative), 'utf8').split('\n')
    lines.forEach((line, index) => {
      const where = `${relative}:${index + 1}`
      if (ARABIC_INDIC_DIGITS.test(line)) {
        problems.push(`${where}  Arabic-Indic digit in source copy; use Latin digits.`)
      }
      for (const pattern of PLACEHOLDERS) {
        if (pattern.test(line)) {
          problems.push(`${where}  placeholder copy matched ${pattern}.`)
        }
      }
    })
  }
}

if (problems.length > 0) {
  console.error('check:copy failed:')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(`check:copy OK — ${checked} source files.`)
