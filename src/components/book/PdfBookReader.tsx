'use client'

import type { PageFlip } from 'page-flip'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { describe, empty, leafPlan, PREVIEW_URL, progress, renderWindow, sections, toFlip, visibleLeaves, type Leaf } from '@/lib/book-preview'
import type { ImageSources } from '@/lib/images'

import { ClosedBook, Opening } from './ClosedBook'
import { openPreview, PageSurface, referenceText, type Frame, type Pdfjs } from './pdf'
import { StaticPdfReader } from './StaticPdfReader'
import styles from './reader.module.css'

type Loaded = { pdfjs: Pdfjs; doc: PDFDocumentProxy; frame: Frame }

// CSS module names, for elements built outside React.
const cls = (name: string) => styles[name] ?? ''

// The book's canvases stop at 1.5 device pixels: the turn stays smooth, and
// the reading view (2x) is where the words are read closely.
const BOOK_DPR = 1.5
const FADE_MS = 150

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}

/** The three-triangle mark, for the endpapers and the back cover. */
function mark(): HTMLElement {
  const el = document.createElement('span')
  el.className = cls('leafMark')
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** Going to the editions leaves full screen first, or the page cannot scroll. */
function toEditions(event: { preventDefault: () => void }) {
  if (!document.fullscreenElement) return
  event.preventDefault()
  void document.exitFullscreen().then(() => {
    // The same fragment again would not scroll.
    if (window.location.hash === '#editions') document.getElementById('editions')?.scrollIntoView()
    else window.location.hash = 'editions'
  })
}

/** One leaf of the book, built outside React: page-flip moves and styles it. */
function makeLeaf(leaf: Leaf, cover: ImageSources): HTMLElement {
  const el = document.createElement('div')
  el.className = cls('leaf')
  el.dataset.kind = leaf.kind
  if (leaf.kind === 'cover' || leaf.kind === 'endpaper' || leaf.kind === 'back') el.dataset.density = 'hard'
  if (leaf.kind === 'page') el.dataset.page = String(leaf.page)
  // The way back, at the other bottom corner (shown by the state effect).
  if (leaf.kind === 'page' || leaf.kind === 'blank' || leaf.kind === 'end') {
    const back = document.createElement('span')
    back.className = cls('cornerBack')
    back.setAttribute('aria-hidden', 'true')
    el.append(back)
  }
  if (leaf.kind === 'cover') {
    const img = document.createElement('img')
    img.src = cover.src
    img.srcset = cover.srcSet
    img.sizes = '(min-width: 1024px) 560px, 80vw'
    img.alt = 'غلاف خوص'
    el.append(img)
  } else if (leaf.kind === 'endpaper' || leaf.kind === 'back') {
    el.append(mark())
  } else if (leaf.kind === 'end') {
    const first = document.createElement('p')
    first.textContent = 'هنا تنتهي الصفحات المتاحة للقراءة.'
    const second = document.createElement('p')
    second.className = cls('endLine')
    second.textContent = 'بقية الحكاية في الكتاب.'
    // A bare link, text only: page-flip lets a click through only when its
    // target is the <a> itself.
    const link = document.createElement('a')
    link.href = '#editions'
    link.className = cls('endLink')
    link.textContent = 'النسخ ←'
    // The arrow is a glyph, not a word; a child span would swallow the click.
    link.setAttribute('aria-label', 'النسخ')
    link.addEventListener('click', toEditions)
    el.append(first, second, link)
  }
  return el
}

/**
 * The book preview as a physical Arabic hardcover (D10), at 4:5 like cover B:
 * boards of cover linen around the page block, endpapers inside the covers,
 * each part starting on a left-hand page, page edges that move from the left
 * to the right as you read, and the spine's shadow. pdf.js draws the approved
 * pages on warm paper on page-flip leaves, bound on the right: the next page
 * is the left one, turned to the right, and ← is the next page.
 *
 * - Closed, the book stands in the middle of the stage, exactly where the
 *   closed book of `BookPreview` stood; it slides to one side as it opens.
 * - Only the leaves on screen and the spreads beside them hold a canvas, and
 *   the text layers hide while a page turns.
 * - Without motion a turn is a short fade, never a 3D rotation.
 * - «عرض للقراءة» shows the same pages one under the other, at reading size,
 *   from the page in view: the place to read closely, zoom and select.
 */
export default function PdfBookReader({ cover, url = PREVIEW_URL, startPage }: { cover: ImageSources; url?: string; startPage?: number }) {
  const readerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const blockRef = useRef<HTMLDivElement | null>(null)
  const flipRef = useRef<PageFlip | null>(null)
  const surfacesRef = useRef(new Map<number, PageSurface>())
  const leafRef = useRef<HTMLElement[]>([])
  const indexRef = useRef(0)
  const portraitRef = useRef(false)
  const openedRef = useRef(false)
  // Where a press on the book began, and which way a click there turns two
  // pages at a time (1 next, -1 previous); a turn by hand that stopped on an
  // empty leaf goes on to `skipRef`.
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  const pressTurnRef = useRef<0 | 1 | -1>(0)
  const skipRef = useRef<number | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const refocusToggleRef = useRef(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'book' | 'pages'>('book')
  const [index, setIndex] = useState(0)
  const [portrait, setPortrait] = useState(false)
  const [sizeTick, setSizeTick] = useState(0)
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null && document.fullscreenElement === readerRef.current,
    () => false,
  )
  const canFullscreen = useSyncExternalStore(
    () => () => {},
    () => document.fullscreenEnabled,
    () => false,
  )

  const leaves = useMemo(() => (loaded ? leafPlan(loaded.doc.numPages) : []), [loaded])
  const total = leaves.length
  const firstPage = leaves.findIndex((leaf) => leaf.kind === 'page')
  const endLeaf = leaves.findIndex((leaf) => leaf.kind === 'end')
  const opening = startPage ? leaves.findIndex((leaf) => leaf.kind === 'page' && leaf.page === startPage) : firstPage

  // Load pdf.js and the preview; a retry starts again.
  useEffect(() => {
    let live = true
    openPreview(url).then(
      (result) => (live ? setLoaded(result) : void result.doc.loadingTask.destroy()),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [url, attempt])

  useEffect(() => () => void loaded?.doc.loadingTask.destroy(), [loaded])

  // A retry replaces the focused «إعادة المحاولة» with the loading status: focus follows it.
  useEffect(() => {
    if (attempt > 0 && !loaded && !failed) statusRef.current?.focus()
  }, [attempt, loaded, failed])

  /** Where the book is for a reading index: closed on either cover, or open. */
  const atFor = useCallback(
    (at: number) => (portraitRef.current ? 'open' : at <= 0 ? 'front' : at >= total - 1 ? 'back' : 'open'),
    [total],
  )

  /** Without motion, a turn fades out and in instead of rotating. */
  const fade = useCallback((action: () => void) => {
    const block = blockRef.current
    if (!block) return action()
    block.dataset.fading = ''
    window.setTimeout(() => {
      action()
      requestAnimationFrame(() => delete block.dataset.fading)
    }, FADE_MS)
  }, [])

  const go = useCallback(
    (target: number) => {
      const flip = flipRef.current
      const block = blockRef.current
      if (!flip || !block || total === 0) return
      const at = Math.min(Math.max(target, 0), total - 1)
      pressTurnRef.current = 0
      // The stage moves with the turn: the book slides to the middle as it closes.
      block.dataset.at = atFor(at)
      if (reducedMotion()) fade(() => flip.turnToPage(toFlip(at, total)))
      else flip.flip(toFlip(at, total), 'bottom')
    },
    [total, atFor, fade],
  )

  const turn = useCallback(
    (direction: 1 | -1) => {
      const flip = flipRef.current
      const block = blockRef.current
      if (!flip || !block) return
      const shown = visibleLeaves(indexRef.current, total, portraitRef.current)
      let target = direction === 1 ? (shown[shown.length - 1] ?? 0) + 1 : (shown[0] ?? 0) - 1
      // One page at a time, a blank back or an endpaper would be an empty
      // step: the turn goes on to the next leaf with something on it.
      if (portraitRef.current) {
        while (target > 0 && target < total - 1 && empty(leaves[target])) target += direction
        if (target !== (direction === 1 ? (shown[shown.length - 1] ?? 0) + 1 : (shown[0] ?? 0) - 1)) return go(target)
      }
      if (target < 0 || target >= total) return
      pressTurnRef.current = 0
      block.dataset.at = atFor(target)
      // page-flip counts left to right: the reading order's next is its previous.
      if (reducedMotion()) fade(() => (direction === 1 ? flip.turnToPrevPage() : flip.turnToNextPage()))
      else if (direction === 1) flip.flipPrev('bottom')
      else flip.flipNext('bottom')
    },
    [total, atFor, fade, leaves, go],
  )

  // Build the book once the pages are in: page-flip gets the leaves reversed.
  useEffect(() => {
    const host = hostRef.current
    if (!loaded || mode !== 'book' || !host) return
    let cancelled = false
    const plan = leafPlan(loaded.doc.numPages)
    const block = document.createElement('div')
    block.className = cls('flip')
    // The back cover is the same linen as the front: a plain stretch of cover
    // B beside the emblem (reader.module.css places it). Set on the root,
    // since page-flip rewrites each leaf's own style.
    block.style.setProperty('--linen', `url("${cover.src}")`)
    host.append(block)
    const elements = plan.map((leaf) => makeLeaf(leaf, cover))
    leafRef.current = elements
    const surfaces = surfacesRef.current
    elements.forEach((element, i) => {
      const leaf = plan[i]
      if (leaf?.kind === 'page') surfaces.set(i, new PageSurface(element, leaf.page, referenceText(loaded.doc, leaf.page)))
    })
    // A rebuild after the reading view keeps the reader's place.
    const begin = openedRef.current ? indexRef.current : 0
    let flip: PageFlip | null = null
    let sizes: ResizeObserver | null = null
    let frame = 0
    let releaseListeners = () => {}
    void import('page-flip').then(({ PageFlip }) => {
      if (cancelled) return
      const still = reducedMotion()
      flip = new PageFlip(block, {
        width: 400,
        height: 500,
        size: 'stretch',
        // One page at a time below 800px (minWidth × 2): the page is larger.
        minWidth: 400,
        maxWidth: 900,
        minHeight: 100,
        maxHeight: 2000,
        // The stage (reader.module.css) sets the height; page-flip's autoSize
        // would size it from the width alone and overflow the screen.
        autoSize: false,
        showCover: true,
        usePortrait: true,
        drawShadow: true,
        maxShadowOpacity: 0.6,
        flippingTime: still ? 1 : 900,
        showPageCorners: !still,
        mobileScrollSupport: true,
        startPage: toFlip(begin, plan.length),
      })
      flip.loadFromHTML([...elements].reverse())
      // Loading pins the block's minimum to minWidth (400px, wider than a
      // phone); the stage decides the size.
      block.style.minWidth = '0'
      block.style.minHeight = '0'
      // The boards and the page edges sit behind the leaves (z-index -1).
      const boards = document.createElement('div')
      boards.className = cls('case')
      boards.setAttribute('aria-hidden', 'true')
      block.append(boards)
      blockRef.current = block
      flipRef.current = flip
      // One page at a time the reader takes a click on the page itself (the
      // left half is the next page, the right half the previous one), and the
      // corners do not peel on hover: page-flip's own split is 40/60 and it
      // peels only its outer edge, the right one. Two pages at a time, both
      // outer corners peel and a click turns the page it is on.
      const settings = flip.getSettings()
      const place = (portrait: boolean) => {
        portraitRef.current = portrait
        settings.showPageCorners = !still && !portrait
        setPortrait(portrait)
      }
      flip.on('flip', (event) => {
        const at = toFlip(event.data, plan.length)
        const from = indexRef.current
        indexRef.current = at
        // One page at a time, a drag or a swipe can stop on a blank back or an
        // endpaper: the turn goes on, the same way, to a page with something on it.
        if (portraitRef.current && at > 0 && at < plan.length - 1 && empty(plan[at])) {
          let target = at
          while (target > 0 && target < plan.length - 1 && empty(plan[target])) target += at > from ? 1 : -1
          skipRef.current = target
          return
        }
        setIndex(at)
      })
      flip.on('changeOrientation', (event) => place(event.data === 'portrait'))
      flip.on('changeState', (event) => {
        if (event.data === 'read') {
          pressTurnRef.current = 0
          const skip = skipRef.current
          skipRef.current = null
          if (skip !== null) {
            // Still on its way to a page with words, so still turning. The next
            // turn starts after page-flip's own end of turn, which resets its
            // state once this event returns: one started inside it never ends.
            // Without motion it is a fade, with no end of turn to wait for.
            requestAnimationFrame(() => {
              if (cancelled) return
              go(skip)
              if (reducedMotion()) delete block.dataset.turning
            })
            return
          }
          delete block.dataset.turning
          block.dataset.at = atFor(indexRef.current)
          return
        }
        block.dataset.turning = ''
        // A click on a corner that closes or opens the book: the slide to the
        // middle runs with the board, as it does for the arrows.
        if (event.data === 'flipping' && pressTurnRef.current !== 0) {
          const shown = visibleLeaves(indexRef.current, plan.length, false)
          block.dataset.at = atFor(pressTurnRef.current === 1 ? (shown[shown.length - 1] ?? 0) + 1 : (shown[0] ?? 0) - 1)
        }
      })
      place(flip.getOrientation() === 'portrait')
      // A press on the book, remembered to tell a click from a drag.
      const onPress = (event: MouseEvent) => {
        pressRef.current = { x: event.clientX, y: event.clientY }
        const r = block.getBoundingClientRect()
        pressTurnRef.current = portraitRef.current ? 0 : event.clientX < r.left + r.width / 2 ? 1 : -1
      }
      // One page at a time, a click (not a drag) turns by the half it is on.
      // It is caught before page-flip's own handler, which is told to forget
      // the press; the end leaf's link keeps its click.
      const onRelease = (event: MouseEvent) => {
        const press = pressRef.current
        pressRef.current = null
        if (!press || !portraitRef.current || event.button !== 0) return
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return
        if (event.target instanceof Element && event.target.closest('a')) return
        event.stopPropagation()
        flip?.userStop({ x: 0, y: 0 }, true)
        const r = block.getBoundingClientRect()
        turn(event.clientX < r.left + r.width / 2 ? 1 : -1)
      }
      block.addEventListener('mousedown', onPress)
      window.addEventListener('mouseup', onRelease, true)
      releaseListeners = () => {
        block.removeEventListener('mousedown', onPress)
        window.removeEventListener('mouseup', onRelease, true)
      }
      indexRef.current = begin
      setIndex(begin)
      block.dataset.at = portraitRef.current ? 'open' : begin <= 0 ? 'front' : begin >= plan.length - 1 ? 'back' : 'open'
      sizes = new ResizeObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          flip?.update()
          setSizeTick((tick) => tick + 1)
        })
      })
      sizes.observe(host)
      host.focus({ preventScroll: true })
      if (!openedRef.current) {
        openedRef.current = true
        // Closed first, then it opens itself: at the first page, or the part asked for.
        window.setTimeout(() => {
          if (!cancelled) go(opening)
        }, 500)
      }
    }, () => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      sizes?.disconnect()
      releaseListeners()
      surfaces.forEach((surface) => surface.clear())
      surfaces.clear()
      flipRef.current = null
      blockRef.current = null
      if (flip) flip.destroy()
      else block.remove()
    }
    // `go` and `opening` are read once, when the book first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode, cover])

  // The state of the book on screen: where it stands, its page edges, the
  // corner that invites a turn, and which leaves hold a canvas.
  useEffect(() => {
    const block = blockRef.current
    const flip = flipRef.current
    if (!loaded || mode !== 'book' || !block || !flip || total === 0) return
    block.dataset.at = atFor(index)
    block.toggleAttribute('data-portrait', portrait)
    const read = progress(index, total)
    block.style.setProperty('--edge-unread', `${((1 - read) * 6).toFixed(1)}px`)
    block.style.setProperty('--edge-read', `${(read * 6).toFixed(1)}px`)
    const shown = visibleLeaves(index, total, portrait)
    const next = shown[shown.length - 1] ?? 0
    // Past the first page, the other corner of the page that turns back shows the way back.
    const back = shown[0] ?? 0
    leafRef.current.forEach((leaf, i) => {
      leaf.toggleAttribute('data-corner', i === next && i >= firstPage && i < endLeaf)
      leaf.toggleAttribute('data-corner-back', i === back && i > firstPage)
    })
    const width = Math.round(flip.getBoundsRect().pageWidth)
    const wanted = new Set(renderWindow(index, total, portrait, leaves))
    surfacesRef.current.forEach((surface, leaf) => {
      if (wanted.has(leaf)) surface.draw(loaded.pdfjs, loaded.doc, loaded.frame, width, BOOK_DPR).catch(() => {})
      else surface.clear()
    })
  }, [loaded, mode, index, portrait, total, sizeTick, atFor, firstPage, endLeaf, leaves])

  // Entering the reading view unmounts the toggle that was pressed and mounts
  // its twin; focus follows it. The book view focuses its own host (above).
  useEffect(() => {
    if (mode === 'pages' && refocusToggleRef.current) toggleRef.current?.focus()
    refocusToggleRef.current = false
  }, [mode])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => turn(1),
      ArrowRight: () => turn(-1),
      Home: () => go(0),
      End: () => go(endLeaf),
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  function toggleFullscreen() {
    const reader = readerRef.current
    if (!reader) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void reader.requestFullscreen().catch(() => {})
  }

  if (failed) {
    return (
      <div className={styles.reader}>
        <ClosedBook cover={cover} />
        <div className={styles.controls} role="alert">
          <p className={styles.status}>تعذّر فتح الصفحات.</p>
          <p className={styles.messageActions}>
            <button
              type="button"
              className={styles.control}
              onClick={() => {
                setFailed(false)
                setLoaded(null)
                setAttempt((n) => n + 1)
              }}
            >
              إعادة المحاولة
            </button>
            <a href={url} className={styles.plainLink}>
              فتح الصفحات ملفاً (PDF)
            </a>
          </p>
        </div>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className={styles.reader}>
        <ClosedBook cover={cover} />
        <div ref={statusRef} tabIndex={-1} className={styles.controls} role="status" aria-label="جارٍ فتح الكتاب">
          <Opening onOpen={() => {}} loading />
        </div>
      </div>
    )
  }

  const shown = visibleLeaves(index, total, portrait)
  const where = describe(leaves, shown, loaded.doc.numPages)
  const parts = sections(leaves)
  const lastShown = shown[shown.length - 1] ?? 0
  const part = [...parts].reverse().find((section) => section.index <= lastShown) ?? { label: '', index: 0 }
  const pageInView = shown.map((i) => leaves[i]).find((leaf) => leaf?.kind === 'page')

  const tools = (
    <div className={styles.tools}>
      {mode === 'book' && (
        <label className={styles.jump}>
          <span>انتقل إلى</span>
          <select value={part.index} onChange={(event) => go(Number(event.target.value))}>
            {parts.map((section) => (
              <option key={section.index} value={section.index}>
                {section.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        ref={toggleRef}
        type="button"
        className={styles.tool}
        onClick={() => {
          refocusToggleRef.current = true
          setMode(mode === 'book' ? 'pages' : 'book')
        }}
      >
        {mode === 'book' ? 'عرض للقراءة' : 'عرض الكتاب'}
      </button>
      {canFullscreen && (
        <button type="button" className={styles.tool} onClick={toggleFullscreen}>
          {fullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
        </button>
      )}
    </div>
  )

  if (mode === 'pages') {
    return (
      <div ref={readerRef} className={styles.reader} data-mode={mode}>
        <div className={styles.readingTools}>{tools}</div>
        <p className={styles.zoomHint}>كبّر الصفحة بإصبعين لقراءة أوضح.</p>
        <StaticPdfReader
          pdfjs={loaded.pdfjs}
          doc={loaded.doc}
          frame={loaded.frame}
          startPage={pageInView?.kind === 'page' ? pageInView.page : 1}
        />
        <div className={styles.closing}>
          <p>هنا تنتهي الصفحات المتاحة للقراءة.</p>
          <p className={styles.endLine}>بقية الحكاية في الكتاب.</p>
          <a href="#editions" className={styles.endLink} onClick={toEditions}>
            النسخ <span aria-hidden="true">←</span>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div ref={readerRef} className={styles.reader} data-mode={mode}>
      <div
        ref={hostRef}
        className={styles.book}
        tabIndex={0}
        role="group"
        aria-roledescription="كتاب"
        aria-label="صفحات من خوص"
        aria-describedby="reader-keys"
        onKeyDown={onKeyDown}
      />
      <p id="reader-keys" className="visually-hidden">
        السهم الأيسر للصفحة التالية، والسهم الأيمن للصفحة السابقة.
      </p>
      <div className={styles.controls}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.control} onClick={() => turn(-1)} disabled={(shown[0] ?? 0) === 0}>
            <span aria-hidden="true">→</span> <span className={styles.controlLabel}>السابقة</span>
          </button>
          <p className={styles.where} aria-live="polite">
            <span>{where.label}</span>
            {where.count && (
              <span dir="ltr" className={styles.count}>
                {where.count}
              </span>
            )}
          </p>
          <button type="button" className={styles.control} onClick={() => turn(1)} disabled={lastShown === total - 1}>
            <span className={styles.controlLabel}>التالية</span> <span aria-hidden="true">←</span>
          </button>
        </div>
        {tools}
      </div>
    </div>
  )
}
