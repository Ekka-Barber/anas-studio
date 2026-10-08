import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { destroy, getDocument } = vi.hoisted(() => ({ destroy: vi.fn(), getDocument: vi.fn() }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  VerbosityLevel: { ERRORS: 0 },
  getDocument,
}))

// The unit config has no `@/` alias; pdf.ts reaches book-preview through it.
vi.mock('@/lib/book-preview', () => ({ fixLigatures: (items: string[]) => items, PAGE_RATIO: 1.25 }))

import { loadPdfjs, OPEN_TIMEOUT_MS, openPreview, START_TIMEOUT_MS } from '../../src/components/book/pdf'

describe('openPreview', () => {
  beforeEach(() => destroy.mockClear())
  afterEach(() => vi.useRealTimers())

  it('destroys the document, and so its worker, when measuring its frame fails', async () => {
    getDocument.mockImplementationOnce(() => ({
      destroy,
      promise: Promise.resolve({ numPages: 1, getPage: () => Promise.reject(new Error('range request failed')) }),
    }))
    await expect(openPreview('/book/khous-preview.pdf')).rejects.toThrow('range request failed')
    expect(destroy).toHaveBeenCalledOnce()
  })

  // AUDIT-2 BOOK-4: pdf.js starts a worker of its own for every load, failed or not.
  it('destroys the loading task, and so its worker, when the load itself fails', async () => {
    getDocument.mockImplementationOnce(() => ({ destroy, promise: Promise.reject(new Error('network down')) }))
    await expect(openPreview('/book/khous-preview.pdf')).rejects.toThrow('network down')
    expect(destroy).toHaveBeenCalledOnce()
  })

  /** A loading task the test drives: its document arrives when `finish` is called; pdf.js would call `onProgress`. */
  function drivenTask() {
    let finish: (value: unknown) => void = () => {}
    const task: { destroy: typeof destroy; promise: Promise<unknown>; onProgress?: (progress: { loaded: number; total: number }) => void } = {
      destroy,
      promise: new Promise((resolve) => {
        finish = resolve
      }),
    }
    getDocument.mockImplementationOnce(() => task)
    return { task, finish: (value: unknown) => finish(value) }
  }
  // A one-page document with no text: the frame falls back to the middle of the sheet.
  const page = { getViewport: () => ({ width: 100, height: 140, convertToViewportPoint: () => [0, 0] }), getTextContent: async () => ({ items: [] }) }
  const doc = { numPages: 1, getPage: async () => page }

  // READER-09: a download that never answers left the reader on «جارٍ فتح الكتاب…» for good.
  it('gives up when nothing of the PDF has arrived two minutes after the press, and destroys the loading task', async () => {
    expect(START_TIMEOUT_MS).toBe(120_000)
    // The pdf.js chunk is loaded (and remembered) before the clock is faked.
    await loadPdfjs()
    vi.useFakeTimers()
    drivenTask()
    const refused = expect(openPreview('/book/khous-preview.pdf')).rejects.toThrow('did not start within 120000 ms')
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1)
    expect(destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await refused
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('gives up on a download that stops receiving for 30 seconds, and destroys the loading task', async () => {
    expect(OPEN_TIMEOUT_MS).toBe(30_000)
    await loadPdfjs()
    vi.useFakeTimers()
    const { task } = drivenTask()
    const refused = expect(openPreview('/book/khous-preview.pdf')).rejects.toThrow('made no progress for 30000 ms')
    await vi.advanceTimersByTimeAsync(10_000)
    task.onProgress?.({ loaded: 64_000, total: 341_000 })
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS - 1)
    expect(destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await refused
    expect(destroy).toHaveBeenCalledOnce()
  })

  // A4 of the D1 audit and R2 of its re-audit: a slow link was cut off at 30 seconds, worker start-up included.
  it('opens a slow download that keeps receiving, after a start-up longer than 30 seconds', async () => {
    await loadPdfjs()
    vi.useFakeTimers()
    const { task, finish } = drivenTask()
    const opening = openPreview('/book/khous-preview.pdf')
    // The worker takes 45 seconds to arrive, then the PDF trickles in, a few bytes every 20 seconds for two minutes.
    await vi.advanceTimersByTimeAsync(45_000)
    for (let second = 0; second < 120; second += 20) {
      task.onProgress?.({ loaded: second * 1000, total: 341_000 })
      await vi.advanceTimersByTimeAsync(20_000)
    }
    finish(doc)
    await expect(opening).resolves.toMatchObject({ doc })
    expect(destroy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    // A late progress report after the document is in arms no clock.
    task.onProgress?.({ loaded: 341_000, total: 341_000 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind when the preview opens, and keeps its document', async () => {
    await loadPdfjs()
    vi.useFakeTimers()
    getDocument.mockImplementationOnce(() => ({ destroy, promise: Promise.resolve(doc) }))
    const opened = await openPreview('/book/khous-preview.pdf')
    expect(opened.doc).toBe(doc)
    expect(vi.getTimerCount()).toBe(0)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('waits as long as it is told to, before the first bytes and after them', async () => {
    await loadPdfjs()
    vi.useFakeTimers()
    drivenTask()
    const unstarted = expect(openPreview('/book/khous-preview.pdf', { startMs: 5 })).rejects.toThrow('did not start within 5 ms')
    await vi.advanceTimersByTimeAsync(5)
    await unstarted
    const { task } = drivenTask()
    const stopped = expect(openPreview('/book/khous-preview.pdf', { stallMs: 5 })).rejects.toThrow('made no progress for 5 ms')
    await vi.advanceTimersByTimeAsync(1)
    task.onProgress?.({ loaded: 1, total: 2 })
    await vi.advanceTimersByTimeAsync(5)
    await stopped
  })
})
