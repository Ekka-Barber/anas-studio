import { beforeEach, describe, expect, it, vi } from 'vitest'

const { destroy, getDocument } = vi.hoisted(() => ({ destroy: vi.fn(), getDocument: vi.fn() }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  VerbosityLevel: { ERRORS: 0 },
  getDocument,
}))

// The unit config has no `@/` alias; pdf.ts reaches book-preview through it.
vi.mock('@/lib/book-preview', () => ({ fixLigatures: (items: string[]) => items, PAGE_RATIO: 1.25 }))

import { openPreview } from '../../src/components/book/pdf'

describe('openPreview', () => {
  beforeEach(() => destroy.mockClear())

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
})
