// A full `node scripts/prepare-media.mjs` run rewrites public/images/manifest.json
// from what it generates. An entry it does not generate is lost on that run,
// unless the script carries it over (HAND_MADE_IMAGES). The script needs sharp,
// ffmpeg and the git-excluded sources, so this reads its source text instead of
// running it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

const script = read('scripts/prepare-media.mjs')
const manifest = JSON.parse(read('public/images/manifest.json')) as Record<string, unknown>

/** The ids the IMAGES, VIDEOS and POSTER_ONLY lists generate (videos also write `<id>-poster`). */
const generated = new Set<string>()
for (const match of script.matchAll(/\bid: '([^']+)'/g)) {
  generated.add(match[1]!)
  generated.add(`${match[1]}-poster`)
}
const handMade = [...(/const HAND_MADE_IMAGES = \[([^\]]*)\]/.exec(script)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]!)

describe('public/images/manifest.json against scripts/prepare-media.mjs', () => {
  it('holds only entries a full run generates or carries over', () => {
    const lost = Object.keys(manifest).filter((id) => !generated.has(id) && !handMade.includes(id))
    expect(lost).toEqual([])
  })

  it('carries over only entries the manifest holds', () => {
    expect(handMade.filter((id) => !(id in manifest))).toEqual([])
    expect(handMade.length).toBeGreaterThan(0)
  })
})
