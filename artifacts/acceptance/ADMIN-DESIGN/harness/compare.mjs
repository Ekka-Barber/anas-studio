#!/usr/bin/env node
// Compares two labelled runs screen by screen (the shots are deterministic, so an
// unchanged screen is byte-identical): node harness/compare.mjs --a before --b after [--site <dir>] [--out <dir>]
// Prints a table and writes red-overlay diffs of changed screens to shots/diff-<a>-<b>/.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { a: { type: 'string', default: 'before' }, b: { type: 'string', default: 'after' }, site: { type: 'string' }, out: { type: 'string' }, threshold: { type: 'string', default: '8' } } })
const out = path.resolve(values.out ?? path.join(here, '..'))
const site = path.resolve(values.site ?? path.join(here, '..', 'site'))
const sharp = createRequire(path.join(site, 'package.json'))('sharp')
const dirA = path.join(out, 'shots', values.a)
const dirB = path.join(out, 'shots', values.b)
const diffDir = path.join(out, 'shots', `diff-${values.a}-${values.b}`)
const threshold = Number(values.threshold)

const names = (dir) => readdirSync(dir).filter((name) => name.endsWith('.png')).sort()
const inA = new Set(names(dirA))
const inB = new Set(names(dirB))
const rows = []
mkdirSync(diffDir, { recursive: true })

for (const name of [...new Set([...inA, ...inB])].sort()) {
  if (!inA.has(name)) {
    rows.push([name, 'only in ' + values.b, '', ''])
    continue
  }
  if (!inB.has(name)) {
    rows.push([name, 'only in ' + values.a, '', ''])
    continue
  }
  const bufferA = readFileSync(path.join(dirA, name))
  const bufferB = readFileSync(path.join(dirB, name))
  if (bufferA.equals(bufferB)) {
    rows.push([name, 'same', '', ''])
    continue
  }
  const [rawA, rawB] = await Promise.all([bufferA, bufferB].map((buffer) => sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
  const sizeA = `${rawA.info.width}x${rawA.info.height}`
  const sizeB = `${rawB.info.width}x${rawB.info.height}`
  const width = Math.max(rawA.info.width, rawB.info.width)
  const height = Math.min(rawA.info.height, rawB.info.height)
  // The common top-left area is compared pixel by pixel; the extra height of the taller shot counts as changed.
  let changed = 0
  const overlay = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const inBoth = x < rawA.info.width && x < rawB.info.width
      const ia = (y * rawA.info.width + x) * 4
      const ib = (y * rawB.info.width + x) * 4
      const differs = !inBoth || Math.abs(rawA.data[ia] - rawB.data[ib]) > threshold || Math.abs(rawA.data[ia + 1] - rawB.data[ib + 1]) > threshold || Math.abs(rawA.data[ia + 2] - rawB.data[ib + 2]) > threshold
      if (differs) changed += 1
      const grey = inBoth ? Math.round(0.3 * rawB.data[ib] + 0.59 * rawB.data[ib + 1] + 0.11 * rawB.data[ib + 2]) : 255
      overlay[o] = differs ? 230 : Math.round(grey * 0.35 + 165)
      overlay[o + 1] = differs ? 40 : Math.round(grey * 0.35 + 165)
      overlay[o + 2] = differs ? 40 : Math.round(grey * 0.35 + 165)
      overlay[o + 3] = 255
    }
  }
  const extra = Math.abs(rawA.info.height - rawB.info.height) * width
  const percent = ((changed + extra) / (width * Math.max(rawA.info.height, rawB.info.height))) * 100
  await sharp(overlay, { raw: { width, height, channels: 4 } }).png().toFile(path.join(diffDir, name))
  rows.push([name, sizeA === sizeB ? 'changed' : 'changed (size)', `${percent.toFixed(2)}%`, sizeA === sizeB ? sizeA : `${sizeA} -> ${sizeB}`])
}

const same = rows.filter((row) => row[1] === 'same').length
console.log(['shot', 'status', 'pixels changed', 'size'].join(' | '))
for (const row of rows.filter((r) => r[1] !== 'same')) console.log(row.join(' | '))
console.log(`\n${same} identical, ${rows.length - same} different or missing. Diffs: ${existsSync(diffDir) ? diffDir : '(none)'}`)
