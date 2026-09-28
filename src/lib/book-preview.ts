import manifest from '../../content/book-source-manifest.json'

/**
 * The book's public preview (P02): the pages of «خوص» Anas approved for
 * reading before buying (E04 range, owner 2026-09-28), exported by
 * `scripts/prepare-preview.py` into one sanitized PDF. Only this file is ever
 * fetched; the whole book is never on the site.
 *
 * The reader shows it as a physical Arabic hardcover, bound on the right, at
 * 4:5 (8×10 in, the shape of cover B; owner 2026-09-28: "find the best suit
 * our own design"). Everything below is in reading order (index 0 is the
 * cover). page-flip only turns left-to-right books, so the reader hands it the
 * leaves reversed; `toFlip` converts between the two orders.
 */
export const PREVIEW_URL = manifest.output.url

/** Height over width of a leaf: 4:5, the cover's own shape. */
export const PAGE_RATIO = 1.25

/** The label of each preview page, by its 1-based page number. */
export const PAGE_LABELS: ReadonlyMap<number, string> = new Map(manifest.pages.map((entry) => [entry.page, entry.label]))

export type Leaf =
  | { kind: 'cover' }
  | { kind: 'endpaper' }
  | { kind: 'page'; page: number }
  | { kind: 'blank' }
  | { kind: 'end' }
  | { kind: 'back' }

/**
 * The leaves of the book, as a bound Arabic book has them. A spread is an odd
 * leaf on the right (read first) and the even leaf after it on the left.
 * - The inside of each cover is an endpaper, turned with its board.
 * - Each part (a new label) starts on a left-hand page, the way a chapter
 *   starts on a recto; a blank leaf fills the page before it when needed.
 * - The closing leaf follows the last page; a blank then brings the back
 *   endpaper onto a left-hand page, and the back cover stands alone.
 * The count is always even, as page-flip's covers need.
 */
export function leafPlan(pages: number, labels: ReadonlyMap<number, string> = PAGE_LABELS): Leaf[] {
  const leaves: Leaf[] = [{ kind: 'cover' }, { kind: 'endpaper' }]
  let previous: string | undefined
  for (let page = 1; page <= pages; page++) {
    const label = labels.get(page) ?? ''
    if ((page === 1 || label !== previous) && leaves.length % 2 === 1) leaves.push({ kind: 'blank' })
    leaves.push({ kind: 'page', page })
    previous = label
  }
  leaves.push({ kind: 'end' })
  if (leaves.length % 2 === 1) leaves.push({ kind: 'blank' })
  leaves.push({ kind: 'endpaper' }, { kind: 'back' })
  return leaves
}

/** Reading index ↔ page-flip index: the same list, reversed. */
export function toFlip(index: number, total: number): number {
  return total - 1 - index
}

/**
 * The leaves on screen for a reading index. A cover stands alone; inside the
 * book a spread is an odd leaf (the right-hand page, read first) and the leaf
 * after it. In portrait one leaf shows at a time.
 */
export function visibleLeaves(index: number, total: number, portrait: boolean): number[] {
  const at = Math.min(Math.max(index, 0), total - 1)
  if (portrait || at === 0 || at === total - 1) return [at]
  const right = at % 2 === 1 ? at : at - 1
  return [right, right + 1]
}

/**
 * The leaves worth a canvas: what is on screen and the spread on either side,
 * so a turn never shows a blank page. At most six (two per spread).
 */
export function renderWindow(index: number, total: number, portrait: boolean): number[] {
  const shown = visibleLeaves(index, total, portrait)
  const first = shown[0] ?? 0
  const last = shown[shown.length - 1] ?? first
  const wanted = new Set<number>()
  for (const around of [first - 1, first, last + 1]) {
    if (around < 0 || around >= total) continue
    for (const leaf of visibleLeaves(around, total, portrait)) wanted.add(leaf)
  }
  return [...wanted].sort((a, b) => a - b)
}

/**
 * What the reader says about the leaves on screen: «الإهداء» and «1 / 5».
 * Leaves with no page say where you are: the cover and its endpaper before
 * the pages, the end after them.
 */
export function describe(leaves: readonly Leaf[], shown: readonly number[], pages: number): { label: string; count: string } {
  const numbers = shown.flatMap((i) => {
    const leaf = leaves[i]
    return leaf?.kind === 'page' ? [leaf.page] : []
  })
  if (numbers.length === 0) {
    const at = shown[0] ?? 0
    const firstPage = leaves.findIndex((leaf) => leaf.kind === 'page')
    const lastPage = leaves.findLastIndex((leaf) => leaf.kind === 'page')
    const label = at < firstPage ? 'الغلاف' : at > lastPage ? 'نهاية الصفحات المتاحة' : ''
    return { label, count: '' }
  }
  const labels = [...new Set(numbers.map((n) => PAGE_LABELS.get(n)).filter(Boolean))]
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  return { label: labels.join(' · '), count: first === last ? `${first} / ${pages}` : `${first}–${last} / ${pages}` }
}

/** Where each labelled part of the preview starts: the page jump's choices. */
export function sections(leaves: readonly Leaf[]): { label: string; index: number }[] {
  const out: { label: string; index: number }[] = [{ label: 'الغلاف', index: 0 }]
  let previous: string | undefined
  leaves.forEach((leaf, index) => {
    if (leaf.kind !== 'page') return
    const label = PAGE_LABELS.get(leaf.page) ?? `صفحة ${leaf.page}`
    if (label !== previous) out.push({ label, index })
    previous = label
  })
  out.push({ label: 'نهاية الصفحات المتاحة', index: leaves.findIndex((leaf) => leaf.kind === 'end') })
  return out
}

/**
 * How far into the book a reading index is, 0 at the cover and 1 at the back:
 * the page edges on each side follow it.
 */
export function progress(index: number, total: number): number {
  return total > 1 ? Math.min(Math.max(index / (total - 1), 0), 1) : 0
}

const ALEFS = new Set(['ا', 'أ', 'إ', 'آ'])
const LAM = 'ل'

/**
 * Puts Arabic lam-alef ligatures back in reading order in pdf.js's text.
 * Word stores «لا», «لأ», «لإ» and «لآ» as one glyph whose text is two
 * letters; pdf.js reverses the letters of a right-to-left line and so turns
 * «الإهداء» into «اإلهداء». `reference` is the same page's text as pypdf reads
 * it, in the right order (`scripts/prepare-preview.py` stores it). An alef
 * followed by lam is swapped only when the swapped letters, with the letters
 * around them, appear in the reference and the unswapped ones do not, so a
 * real «إلى» or a line break that runs «موائدها» into «إلى» is left alone.
 * Text the reference does not hold (another PDF) is returned unchanged.
 */
export function fixLigatures(items: readonly string[], reference: string): string[] {
  // Compared on letters only: spaces, punctuation, harakat and tatweel are
  // where the two readings of a page differ (a colon one of them drops, a
  // tanween placed a letter away).
  const ignored = /[\s\p{P}ً-ٰٟـ]/u
  const out = items.map((item) => [...item])
  const where: [number, number][] = []
  out.forEach((chars, item) =>
    chars.forEach((char, index) => {
      if (!ignored.test(char)) where.push([item, index])
    }),
  )
  const p = where.map(([item, index]) => out[item]![index]!)
  const r = [...reference].filter((char) => !ignored.test(char)).join('')
  const around = (i: number, pair: string) => p.slice(Math.max(0, i - 4), i).join('') + pair + p.slice(i + 2, i + 6).join('')
  for (let i = 0; i + 1 < p.length; i++) {
    const alef = p[i]!
    if (!ALEFS.has(alef) || p[i + 1] !== LAM) continue
    if (!r.includes(around(i, LAM + alef)) || r.includes(around(i, alef + LAM))) continue
    p[i] = LAM
    p[i + 1] = alef
    const [a, b] = [where[i]!, where[i + 1]!]
    out[a[0]]![a[1]] = LAM
    out[b[0]]![b[1]] = alef
    i++
  }
  return out.map((chars) => chars.join(''))
}

/** The first page of each labelled part: the closed book's «ابدأ من» choices. */
export const PARTS: readonly { label: string; page: number }[] = [...PAGE_LABELS].flatMap(([page, label], i, all) =>
  i === 0 || all[i - 1]?.[1] !== label ? [{ label, page }] : [],
)
