// Converts one harness run's full-page PNGs to WebP for this folder and the review page.
// Usage: node tools/webp.mjs <harness run dir, e.g. ../shots/final of the harness> <before|after>
// Writes shots/<name>/<screen>-<width>.webp (WebP's limit is 16383 px a side: a taller shot is cut in parts,
// <screen>-<width>.1.webp, .2.webp), shots/<name>/manifest.json (the parts of each shot) and a copy of the run's
// report.json. sharp comes from the repository's own node_modules.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const evidence = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const repoRoot = path.resolve(evidence, '../../..')
const sharp = createRequire(path.join(repoRoot, 'package.json'))('sharp')
const [runDir, name] = process.argv.slice(2)
if (!runDir || !['before', 'after'].includes(name)) {
  console.error('usage: node tools/webp.mjs <harness run dir> <before|after>')
  process.exit(2)
}
const out = path.join(evidence, 'shots', name)
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'))
const PART = 16000
const manifest = {}
let inBytes = 0
let outBytes = 0
for (const shot of report.screens) {
  const key = `${shot.screen}-${shot.width}`
  const file = path.join(runDir, `${key}.png`)
  inBytes += fs.statSync(file).size
  const { width, height } = await sharp(file).metadata()
  const parts = Math.ceil(height / PART)
  manifest[key] = []
  for (let i = 0; i < parts; i++) {
    const top = i * PART
    const h = Math.min(PART, height - top)
    const partName = parts === 1 ? `${key}.webp` : `${key}.${i + 1}.webp`
    let image = sharp(file, { limitInputPixels: false })
    if (parts > 1) image = image.extract({ left: 0, top, width, height: h })
    await image.webp({ quality: 82, effort: 5, smartSubsample: true }).toFile(path.join(out, partName))
    outBytes += fs.statSync(path.join(out, partName)).size
    manifest[key].push({ name: partName, width, height: h })
  }
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
// The report without the machine's own paths.
const portable = JSON.parse(JSON.stringify(report, (k, v) => (k === 'site' || k === 'file' ? undefined : v)))
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(portable, null, 1) + '\n')
console.log(`${name}: ${report.screens.length} shots, ${(inBytes / 1e6).toFixed(1)} MB of PNG -> ${(outBytes / 1e6).toFixed(1)} MB of WebP`)
