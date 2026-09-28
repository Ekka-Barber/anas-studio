import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

import pageText from '../../../content/book-preview-text.json'
import { fixLigatures, PAGE_RATIO } from '@/lib/book-preview'

/**
 * pdf.js for the book preview (D10): loaded only when a visitor opens the
 * book, with its worker from the same version of the package. Version 6 has no
 * `eval` path left to switch off (the font-compilation path behind
 * CVE-2024-4367 is gone), so no option is needed for it.
 */
export type Pdfjs = typeof import('pdfjs-dist')

let loading: Promise<Pdfjs> | null = null

export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= import('pdfjs-dist')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      return pdfjs
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

/**
 * Word's export stores Anas's Arabic as already-joined glyphs in font
 * subsets. Handed to the browser as font faces, those glyphs are drawn as
 * separate, unjoined letters (seen in Chrome on 2026-09-28), so pdf.js draws
 * each glyph from its outline instead (`disableFontFace`): the page looks
 * exactly as the PDF does.
 */
export async function openPreview(url: string): Promise<{ pdfjs: Pdfjs; doc: PDFDocumentProxy; frame: Frame }> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ url, enableXfa: false, disableFontFace: true, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise
  return { pdfjs, doc, frame: await measureFrame(doc) }
}

/** The part of every page a leaf shows, in PDF points from the page's top left. */
export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The book is 4:5 and Anas's pages are A4 Word pages. Every page is shown
 * through one 4:5 frame around the text of all the pages together, with a
 * margin, so the words keep their places and sizes from page to page and
 * nothing of them is cut; where the frame runs past the A4 sheet, the paper
 * simply continues (the canvas is filled with it). A PDF with no text is
 * framed on its middle.
 */
export async function measureFrame(doc: PDFDocumentProxy): Promise<Frame> {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  let [pageW, pageH] = [0, 0]
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    pageW = Math.max(pageW, viewport.width)
    pageH = Math.max(pageH, viewport.height)
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [, , c = 0, d = 0, e = 0, f = 0] = item.transform as number[]
      const size = item.height || Math.hypot(c, d)
      for (const [x, y] of [viewport.convertToViewportPoint(e, f + size), viewport.convertToViewportPoint(e + item.width, f - size * 0.3)]) {
        x0 = Math.min(x0, x!)
        x1 = Math.max(x1, x!)
        y0 = Math.min(y0, y!)
        y1 = Math.max(y1, y!)
      }
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: (pageH - pageW * PAGE_RATIO) / 2, w: pageW, h: pageW * PAGE_RATIO }
  const margin = pageW * 0.06
  let w = x1 - x0 + 2 * margin
  let h = y1 - y0 + 2 * margin
  if (h > w * PAGE_RATIO) w = h / PAGE_RATIO
  else h = w * PAGE_RATIO
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }
}

/** The paper the pages are printed on (`--paper-page` in tokens.css). */
function paper(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--paper-page').trim() || '#f7f0e5'
}

/**
 * The page's text as pypdf reads it, in reading order, when `doc` is the
 * published preview (the same page count as the export; a test fixture is
 * not). pdf.js's own text keeps the words' places for selection, but it
 * reverses lam-alef ligatures and, where a tanween splits a run, orders some
 * fragments of a line differently, so screen readers get this text instead.
 */
export function referenceText(doc: PDFDocumentProxy, pageNumber: number): string | undefined {
  return doc.numPages === pageText.pages.length ? pageText.pages[pageNumber - 1] : undefined
}

/**
 * A page drawn into one leaf: a canvas for the ink on the book's paper, a
 * transparent text layer over it to select the words, and the page's text for
 * screen readers. `draw` renders the frame at the given width in CSS pixels
 * (a leaf page-flip keeps hidden measures 0, so the book passes its page
 * width), with device pixels capped at `maxDpr`, and cancels its own previous
 * render; `clear` frees the canvas.
 */
export class PageSurface {
  readonly canvas: HTMLCanvasElement
  readonly text: HTMLDivElement
  private task: RenderTask | null = null
  private layer: TextLayer | null = null
  private drawn = ''

  constructor(
    readonly host: HTMLElement,
    readonly pageNumber: number,
    readonly reference?: string,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('aria-hidden', 'true')
    this.text = document.createElement('div')
    this.text.className = 'textLayer'
    this.text.lang = 'ar'
    this.text.dir = 'rtl'
    host.append(this.canvas, this.text)
    if (reference) {
      this.text.setAttribute('aria-hidden', 'true')
      const spoken = document.createElement('div')
      spoken.className = 'visually-hidden'
      spoken.lang = 'ar'
      spoken.dir = 'rtl'
      spoken.textContent = reference.replace(/\s+/g, ' ').trim()
      host.append(spoken)
    }
  }

  async draw(pdfjs: Pdfjs, doc: PDFDocumentProxy, frame: Frame, width = this.host.clientWidth, maxDpr = 2): Promise<void> {
    if (width <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
    const key = `${width}@${dpr}`
    if (key === this.drawn) return
    this.cancel()
    this.drawn = key
    const page = await doc.getPage(this.pageNumber)
    const scale = width / frame.w
    const at = (s: number) => page.getViewport({ scale: s, offsetX: -frame.x * s, offsetY: -frame.y * s })
    const viewport = at(scale * dpr)
    this.canvas.width = Math.round(frame.w * scale * dpr)
    this.canvas.height = Math.round(frame.h * scale * dpr)
    const task = page.render({ canvas: this.canvas, viewport, background: paper() })
    this.task = task
    try {
      await task.promise
    } catch (error) {
      if (error instanceof pdfjs.RenderingCancelledException) return
      this.drawn = ''
      throw error
    } finally {
      if (this.task === task) this.task = null
    }
    this.text.replaceChildren()
    this.text.style.setProperty('--total-scale-factor', String(scale))
    this.text.style.setProperty('--scale-round-x', '1px')
    this.text.style.setProperty('--scale-round-y', '1px')
    const content = await page.getTextContent()
    const reference = this.reference
    if (reference) {
      const items = content.items.filter((item): item is TextItem => 'str' in item)
      fixLigatures(
        items.map((item) => item.str),
        reference,
      ).forEach((str, i) => {
        items[i]!.str = str
      })
    }
    this.layer = new pdfjs.TextLayer({ textContentSource: content, container: this.text, viewport: at(scale) })
    await this.layer.render().catch(() => {})
  }

  cancel(): void {
    this.task?.cancel()
    this.task = null
    this.layer?.cancel()
    this.layer = null
  }

  clear(): void {
    this.cancel()
    this.canvas.width = 0
    this.canvas.height = 0
    this.text.replaceChildren()
    this.drawn = ''
  }
}
