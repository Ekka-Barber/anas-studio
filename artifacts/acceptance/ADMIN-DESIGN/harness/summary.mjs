#!/usr/bin/env node
// Prints a run's report as a Markdown table: node harness/summary.mjs [--label before] [--out <dir>]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { label: { type: 'string', default: 'before' }, out: { type: 'string' } } })
const out = path.resolve(values.out ?? path.join(here, '..'))
const report = JSON.parse(readFileSync(path.join(out, 'shots', values.label, 'report.json'), 'utf8'))

const byScreen = new Map()
for (const entry of report.screens) {
  if (!byScreen.has(entry.screen)) byScreen.set(entry.screen, { role: entry.role, note: entry.note, widths: {} })
  byScreen.get(entry.screen).widths[entry.width] = entry
}
const widths = report.widths
const cell = (entry, pick) => (entry ? pick(entry) : '-')
const lines = []
lines.push(`| screen | role | ${widths.map((w) => `settled ${w}`).join(' | ')} | console errors (app / expected) | page errors | unmocked | ${widths.map((w) => `overflow ${w}`).join(' | ')} | height ${widths[0]} px |`)
lines.push(`|${'---|'.repeat(5 + widths.length * 2 + 1)}`)
for (const [screen, info] of byScreen) {
  const all = widths.map((w) => info.widths[w]).filter(Boolean)
  const app = all.reduce((n, e) => n + e.consoleErrors.filter((c) => c.tag === 'app').length, 0)
  const expected = all.reduce((n, e) => n + e.consoleErrors.filter((c) => c.tag !== 'app').length, 0)
  lines.push(
    `| ${screen} | ${info.role} | ${widths.map((w) => cell(info.widths[w], (e) => (e.settled ? 'yes' : 'NO'))).join(' | ')} | ${app} / ${expected} | ${all.reduce((n, e) => n + e.pageErrors.length, 0)} | ${all.reduce((n, e) => n + e.unmocked.length, 0)} | ${widths.map((w) => cell(info.widths[w], (e) => `${e.overflowPx}px`)).join(' | ')} | ${cell(info.widths[widths[0]], (e) => e.pageHeight)} |`,
  )
}
console.log(lines.join('\n'))
console.log(`\n${report.summary.settled}/${report.summary.shots} shots settled; unmocked calls: ${report.summary.unmockedCalls.length === 0 ? 'none' : report.summary.unmockedCalls.join('; ')}`)
