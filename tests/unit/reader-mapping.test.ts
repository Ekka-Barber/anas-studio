import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import manifest from '../../content/book-source-manifest.json'
import pageText from '../../content/book-preview-text.json'
import {
  describe as describeLeaves,
  fixLigatures,
  leafPlan,
  PAGE_LABELS,
  progress,
  renderWindow,
  sections,
  toFlip,
  visibleLeaves,
} from '../../src/lib/book-preview'

describe('the preview manifest', () => {
  it('publishes only the approved fragments, in the book order', () => {
    expect(manifest.output.url).toBe('/book/khous-preview.pdf')
    expect(manifest.inputs.map((input) => input.label)).toEqual(['الإهداء', 'المقدمة', 'من فصل «صورة الروضة»'])
    expect(manifest.output.pages).toBe(manifest.inputs.reduce((sum, input) => sum + input.pages, 0))
    expect(manifest.approval.date).toBe('2026-09-28')
    expect([...PAGE_LABELS.values()]).toEqual(['الإهداء', 'المقدمة', 'المقدمة', 'من فصل «صورة الروضة»', 'من فصل «صورة الروضة»'])
  })
})

describe('leafPlan', () => {
  const kinds = (pages: number) => leafPlan(pages).map((leaf) => (leaf.kind === 'page' ? leaf.page : leaf.kind))

  it('binds the preview as an Arabic hardcover: endpapers, parts on left-hand pages', () => {
    // Spreads: [cover] [endpaper | الإهداء] [blank | المقدمة 2] [3 | 4 «صورة الروضة»] [5 | end] [blank | endpaper] [back]
    expect(kinds(5)).toEqual(['cover', 'endpaper', 1, 'blank', 2, 3, 4, 5, 'end', 'blank', 'endpaper', 'back'])
    const leaves = leafPlan(5)
    // Every part starts on an even (left-hand) leaf.
    for (const page of [1, 2, 4]) expect(leaves.findIndex((leaf) => leaf.kind === 'page' && leaf.page === page) % 2).toBe(0)
  })

  it('keeps every page once, in order, with an even count, for any length', () => {
    for (const pages of [1, 2, 3, 4, 5, 6, 9]) {
      const leaves = leafPlan(pages)
      expect(leaves.length % 2).toBe(0)
      expect(leaves.slice(0, 2).map((leaf) => leaf.kind)).toEqual(['cover', 'endpaper'])
      expect(leaves.slice(-2).map((leaf) => leaf.kind)).toEqual(['endpaper', 'back'])
      // The back endpaper is a left-hand (even) leaf.
      expect((leaves.length - 2) % 2).toBe(0)
      expect(leaves.flatMap((leaf) => (leaf.kind === 'page' ? [leaf.page] : []))).toEqual(Array.from({ length: pages }, (_, i) => i + 1))
    }
    expect(kinds(1)).toEqual(['cover', 'endpaper', 1, 'end', 'endpaper', 'back'])
    expect(kinds(3)).toEqual(['cover', 'endpaper', 1, 'blank', 2, 3, 'end', 'blank', 'endpaper', 'back'])
  })

  it('follows the labels it is given', () => {
    const one = new Map([
      [1, 'أ'],
      [2, 'أ'],
      [3, 'أ'],
    ])
    expect(leafPlan(3, one).map((leaf) => (leaf.kind === 'page' ? leaf.page : leaf.kind))).toEqual(['cover', 'endpaper', 1, 2, 3, 'end', 'endpaper', 'back'])
  })
})

describe('progress', () => {
  it('runs from the cover to the back', () => {
    expect(progress(0, 12)).toBe(0)
    expect(progress(11, 12)).toBe(1)
    expect(progress(99, 12)).toBe(1)
    expect(progress(0, 1)).toBe(0)
  })
})

describe('toFlip', () => {
  it('reverses the order, both ways', () => {
    expect(toFlip(0, 8)).toBe(7)
    expect(toFlip(7, 8)).toBe(0)
    for (let i = 0; i < 8; i++) expect(toFlip(toFlip(i, 8), 8)).toBe(i)
  })
})

describe('visibleLeaves', () => {
  it('shows a cover alone and pairs an odd leaf with the next one', () => {
    expect(visibleLeaves(0, 8, false)).toEqual([0])
    expect(visibleLeaves(1, 8, false)).toEqual([1, 2])
    expect(visibleLeaves(2, 8, false)).toEqual([1, 2])
    expect(visibleLeaves(6, 8, false)).toEqual([5, 6])
    expect(visibleLeaves(7, 8, false)).toEqual([7])
    expect(visibleLeaves(4, 8, true)).toEqual([4])
    expect(visibleLeaves(99, 8, false)).toEqual([7])
  })

  it('matches page-flip spreads once reversed', () => {
    // page-flip's spreads for 8 leaves with covers: [0], [1,2], [3,4], [5,6], [7].
    const flipSpreads = [[0], [1, 2], [3, 4], [5, 6], [7]]
    for (const spread of flipSpreads) {
      const reading = spread.map((i) => toFlip(i, 8)).sort((a, b) => a - b)
      expect(visibleLeaves(reading[0] ?? -1, 8, false)).toEqual(reading)
    }
  })
})

describe('renderWindow', () => {
  it('keeps what is on screen and one spread either side, at most six', () => {
    expect(renderWindow(0, 8, false)).toEqual([0, 1, 2])
    expect(renderWindow(3, 8, false)).toEqual([1, 2, 3, 4, 5, 6])
    expect(renderWindow(7, 8, false)).toEqual([5, 6, 7])
    expect(renderWindow(3, 8, true)).toEqual([2, 3, 4])
    for (let i = 0; i < 8; i++) expect(renderWindow(i, 8, false).length).toBeLessThanOrEqual(6)
  })

  it('one page at a time reaches past the empty leaves a turn skips', () => {
    const leaves = leafPlan(5) // 0 cover, 1 endpaper, 2 page 1, 3 blank, 4 page 2, 5 page 3 ... 8 end, 9 blank, 10 endpaper, 11 back
    expect(renderWindow(2, 12, true, leaves)).toEqual([0, 2, 4])
    expect(renderWindow(4, 12, true, leaves)).toEqual([2, 4, 5])
    expect(renderWindow(8, 12, true, leaves)).toEqual([7, 8, 11])
    // Two pages at a time nothing is skipped.
    expect(renderWindow(3, 12, false, leaves)).toEqual(renderWindow(3, 12, false))
  })
})

describe('describe and sections', () => {
  const leaves = leafPlan(5)

  it('names the part and counts pages in Latin digits', () => {
    expect(describeLeaves(leaves, [0], 5)).toEqual({ label: 'الغلاف', count: '' })
    expect(describeLeaves(leaves, [1, 2], 5)).toEqual({ label: 'الإهداء', count: '1 / 5' })
    expect(describeLeaves(leaves, [3, 4], 5)).toEqual({ label: 'المقدمة', count: '2 / 5' })
    expect(describeLeaves(leaves, [5, 6], 5)).toEqual({ label: 'المقدمة · من فصل «صورة الروضة»', count: '3–4 / 5' })
    expect(describeLeaves(leaves, [7, 8], 5)).toEqual({ label: 'من فصل «صورة الروضة»', count: '5 / 5' })
    expect(describeLeaves(leaves, [9, 10], 5)).toEqual({ label: 'نهاية الصفحات المتاحة', count: '' })
    expect(describeLeaves(leaves, [11], 5)).toEqual({ label: 'نهاية الصفحات المتاحة', count: '' })
    // One leaf at a time (portrait): the front endpaper still belongs to the cover.
    expect(describeLeaves(leaves, [1], 5)).toEqual({ label: 'الغلاف', count: '' })
    expect(describeLeaves(leaves, [3], 5)).toEqual({ label: '', count: '' })
  })

  it('lists where each part starts', () => {
    expect(sections(leaves)).toEqual([
      { label: 'الغلاف', index: 0 },
      { label: 'الإهداء', index: 2 },
      { label: 'المقدمة', index: 4 },
      { label: 'من فصل «صورة الروضة»', index: 6 },
      { label: 'نهاية الصفحات المتاحة', index: 8 },
    ])
  })
})

describe('fixLigatures', () => {
  it('puts a reversed lam-alef back, and nothing else', () => {
    expect(fixLigatures(['اإلهداء :'], 'الإهداء')).toEqual(['الإهداء :'])
    expect(fixLigatures(['إلى األبواب', ' ال نعرف'], 'إلى الأبواب لا نعرف')).toEqual(['إلى الأبواب', ' لا نعرف'])
    // The definite article and «إلى» stay as they are.
    expect(fixLigatures(['إلى البيت'], 'إلى البيت')).toEqual(['إلى البيت'])
  })

  it('keeps its place across marks and colons only one side has', () => {
    expect(fixLigatures(['ور،ًتولد', ' األخيرة'], 'ور،تولد الأخيرة')).toEqual(['ور،ًتولد', ' الأخيرة'])
    expect(fixLigatures(['ثم : ال'], 'ثم لا')).toEqual(['ثم : لا'])
  })

  it('leaves text it cannot match alone', () => {
    expect(fixLigatures(['Fixture page 1 of 3'], 'الإهداء')).toEqual(['Fixture page 1 of 3'])
    expect(fixLigatures(['األبواب'], '')).toEqual(['األبواب'])
  })
})

describe('the real preview, read by pdf.js', () => {
  // Parsing the real PDF takes close to 5 s when the whole suite runs in parallel.
  it('comes out in reading order once the ligatures are put back', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync('public/book/khous-preview.pdf'))
    const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
    let reversedHamzaBelow = false
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      const items = content.items.flatMap((item) => ('str' in item ? [item.str] : []))
      const raw = items.join('')
      const fixed = fixLigatures(items, pageText.pages[n - 1] ?? '').join('')
      // «األ» (a reversed «الأ») is never Arabic; pdf.js alone writes it.
      if (n === 1) expect(raw).toMatch(/األ/)
      // «اإل» (a reversed «الإ», as in «اإلهداء») is never Arabic either, except
      // «ا» then «إلى», which the lookahead leaves alone.
      if (/اإل(?!ى)/.test(raw)) reversedHamzaBelow = true
      expect(fixed).not.toMatch(/األ|اآل|اإل(?!ى)/)
    }
    // The fixture really has the hamza-below case, so the check above can fail.
    expect(reversedHamzaBelow).toBe(true)
    expect((await (await doc.getPage(1)).getTextContent()).items.length).toBeGreaterThan(0)
    await doc.loadingTask.destroy()
  }, 60_000)
})
