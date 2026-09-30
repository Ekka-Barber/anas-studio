import { describe, expect, it, vi } from 'vitest'

const { destroy } = vi.hoisted(() => ({ destroy: vi.fn() }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  VerbosityLevel: { ERRORS: 0 },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.reject(new Error('range request failed')),
      loadingTask: { destroy },
    }),
  }),
}))

// The unit config has no `@/` alias; pdf.ts reaches book-preview through it.
vi.mock('@/lib/book-preview', () => ({ fixLigatures: (items: string[]) => items, PAGE_RATIO: 1.25 }))

import { openPreview } from '../../src/components/book/pdf'

describe('openPreview', () => {
  it('destroys the document, and so its worker, when measuring its frame fails', async () => {
    await expect(openPreview('/book/khous-preview.pdf')).rejects.toThrow('range request failed')
    expect(destroy).toHaveBeenCalledOnce()
  })
})
