// Small helpers shared by the harness modules: deterministic ids, a fixed
// clock, and the two timestamp spellings the app meets (the browser's ISO
// string and PostgREST's timestamptz with microseconds).
import { createHash } from 'node:crypto'

/** The instant every screen believes it is (Riyadh morning). Override with --now. */
export const NOW_DEFAULT = '2026-10-08T10:30:00+03:00'

/** A deterministic, valid-looking v4 uuid for a seed string. */
export function uid(seed) {
  const h = createHash('md5').update(String(seed)).digest('hex')
  const variant = '89ab'[parseInt(h[16], 16) % 4]
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** A short deterministic hex string (provider ids, tokens). */
export function hex(seed, length = 24) {
  let out = ''
  let round = 0
  while (out.length < length) out += createHash('sha1').update(`${seed}:${round++}`).digest('hex')
  return out.slice(0, length)
}

/** Mulberry32: a tiny seeded generator for decorative randomness (the QR placeholder). */
export function rng(seed) {
  let a = parseInt(createHash('md5').update(String(seed)).digest('hex').slice(0, 8), 16) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Time helpers anchored at `now` (ms since the epoch). */
export function clockOf(now) {
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  return {
    now,
    MIN,
    HOUR,
    DAY,
    /** `n` minutes before now, as ms. */
    ago: (minutes) => now - minutes * MIN,
    /** `n` minutes after now, as ms. */
    ahead: (minutes) => now + minutes * MIN,
    /** The browser's ISO spelling (`...Z`). */
    iso: (ms) => new Date(ms).toISOString(),
    /** PostgREST's timestamptz spelling (`...123456+00:00`), as the database writes it. */
    pg: (ms) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1417+00:00'),
    /** The Riyadh calendar day, `YYYY-MM-DD`. */
    day: (ms) => new Date(ms + 3 * HOUR).toISOString().slice(0, 10),
  }
}

/** A deep copy that keeps plain JSON data (fixtures never hold functions). */
export const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** A Lexical rich-text root with the given blocks (the editor's node shapes). */
export function lexical(blocks) {
  const text = (value, format = 0) => ({ type: 'text', text: value, format, detail: 0, mode: 'normal', style: '', version: 1 })
  const block = (b) => {
    const base = { direction: 'rtl', format: '', indent: 0, version: 1 }
    if (b.h) return { ...base, type: 'heading', tag: b.h, children: [text(b.text)] }
    if (b.quote) return { ...base, type: 'quote', children: [text(b.quote)] }
    if (b.bullets) {
      return {
        ...base,
        type: 'list',
        listType: 'bullet',
        start: 1,
        tag: 'ul',
        children: b.bullets.map((item, i) => ({ ...base, type: 'listitem', value: i + 1, children: [text(item)] })),
      }
    }
    return { ...base, type: 'paragraph', children: (Array.isArray(b.p) ? b.p : [b.p]).map((part) => (typeof part === 'string' ? text(part) : text(part.text, part.format))) }
  }
  return { root: { type: 'root', direction: 'rtl', format: '', indent: 0, version: 1, children: blocks.map(block) } }
}
