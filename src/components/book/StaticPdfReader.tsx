'use client'

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useRef } from 'react'

import { PAGE_LABELS } from '@/lib/book-preview'

import { PageSurface, referenceText, type Frame, type Pdfjs } from './pdf'
import styles from './reader.module.css'

/**
 * «عرض للقراءة»: the preview's pages one under the other, at reading size
 * (up to 880px, about 16px text on a laptop), on the same paper and 4:5
 * frame as the book. It opens at the page that was in view. The view to read
 * at leisure, zoom with two fingers and select text in. A page is drawn as it
 * nears the screen and freed once it is far away.
 */
export function StaticPdfReader({ pdfjs, doc, frame, startPage = 1 }: { pdfjs: Pdfjs; doc: PDFDocumentProxy; frame: Frame; startPage?: number }) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const hosts = Array.from(list.querySelectorAll<HTMLElement>('[data-page]'))
    const surfaces = new Map(
      hosts.map((host) => {
        const page = Number(host.dataset.page)
        return [host, new PageSurface(host, page, referenceText(doc, page))]
      }),
    )
    const near = new Set<HTMLElement>()
    const drawNear = () => near.forEach((host) => surfaces.get(host)?.draw(pdfjs, doc, frame).catch(() => {}))
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const host = entry.target as HTMLElement
          if (entry.isIntersecting) near.add(host)
          else {
            near.delete(host)
            surfaces.get(host)?.clear()
          }
        }
        drawNear()
      },
      { rootMargin: '100% 0px' },
    )
    hosts.forEach((host) => watcher.observe(host))
    const sizes = new ResizeObserver(drawNear)
    sizes.observe(list)
    return () => {
      watcher.disconnect()
      sizes.disconnect()
      surfaces.forEach((surface) => surface.clear())
      hosts.forEach((host) => host.replaceChildren())
    }
  }, [pdfjs, doc, frame])

  // Open at the page the book showed.
  useEffect(() => {
    if (startPage > 1) listRef.current?.querySelector(`[data-page="${startPage}"]`)?.parentElement?.scrollIntoView({ block: 'start' })
  }, [startPage])

  return (
    <ol ref={listRef} className={styles.sheets} aria-label="صفحات من خوص">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <li key={i} className={styles.sheetItem}>
          <div data-page={i + 1} className={styles.sheet} />
          <p className={styles.sheetLabel}>
            <span>{PAGE_LABELS.get(i + 1)}</span> <span dir="ltr">{i + 1}</span>
          </p>
        </li>
      ))}
    </ol>
  )
}
