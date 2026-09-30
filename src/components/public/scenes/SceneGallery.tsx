'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { enter } from '@/components/weave/motion'
import type { ImageSources } from '@/lib/images'

import styles from './scenes.module.css'

export interface SceneItem {
  key: string
  category: string
  caption: string
  sources: ImageSources
}

const ALL = 'الكل'

/** «صورة واحدة», «صورتان», «n صور», «n صورة» (Arabic dual and plural). */
function photoCount(n: number): string {
  if (n === 1) return 'صورة واحدة'
  if (n === 2) return 'صورتان'
  if (n <= 10) return `${n} صور`
  return `${n} صورة`
}

/**
 * The scenes page: its title band with the category filter, the grid, and
 * the lightbox (one component, as they share the filter). The filter is
 * a group of toggle buttons (aria-pressed) that announces how many photos
 * it left; tiles already shown never replay their entrance. The lightbox is a native modal
 * `<dialog>`: Escape closes it, focus returns to the photo that opened it,
 * the arrow keys and a swipe step through the photos of the current filter
 * (in Arabic order: ← is the next one).
 */
export function SceneGallery({ items, categories }: { items: SceneItem[]; categories: string[] }) {
  const [category, setCategory] = useState(ALL)
  const [index, setIndex] = useState(-1)
  const [direction, setDirection] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const touchX = useRef<number | null>(null)

  const shown = category === ALL ? items : items.filter((item) => item.category === category)
  const current = index >= 0 ? shown[index] : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (current && !dialog.open) dialog.showModal()
    else if (!current && dialog.open) dialog.close()
  }, [current])

  function step(delta: number) {
    if (shown.length === 0) return
    setDirection(delta)
    setIndex((i) => (i + delta + shown.length) % shown.length)
  }

  return (
    <>
      <Band as="header" tone="paper" edge="crenel" pad="hero" padEnd="m">
        <h1 className="t-title" {...enter(80, 'band')}>
          المَشاهد
        </h1>
        <div role="group" aria-label="تصفية المشاهد" className={styles.filters} {...enter(360)}>
        {[ALL, ...categories].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={category === name}
            className={styles.filter}
            onClick={() => {
              setCategory(name)
              setIndex(-1)
            }}
          >
            {name}
          </button>
        ))}
        </div>
        <p role="status" className="visually-hidden">
          {`${category}: ${photoCount(shown.length)}`}
        </p>
      </Band>
      <Edge kind="weave" />

      <ul className={styles.grid} aria-label="الصور">
        {shown.map((item, i) => {
          const wide = item.sources.width / item.sources.height > 1.3
          return (
            // A tile below the first screen rises in as it scrolls into view
            // (motion.ts leaves the ones already on screen to tile-in).
            <li
              key={item.key}
              className={`${styles.tile} ${wide ? styles.wide : ''}`}
              style={{ '--i': Math.min(i, 10) } as CSSProperties}
              data-reveal=""
              data-delay={(i % 4) * 70}
            >
              {/* A link to the photograph itself, so without script it still opens the picture;
                  with script it is the lightbox's button (Space too, which a link does not answer). */}
              <a
                href={item.sources.src}
                role="button"
                className={styles.open}
                aria-label={`تكبير: ${item.caption}`}
                onClick={(event) => {
                  event.preventDefault()
                  setDirection(0)
                  setIndex(i)
                }}
                onKeyDown={(event) => {
                  if (event.key === ' ') {
                    event.preventDefault()
                    event.currentTarget.click()
                  }
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15); the srcset comes from the manifest */}
                <img
                  src={item.sources.src}
                  srcSet={item.sources.srcSet}
                  sizes={wide ? '(min-width: 1024px) 40vw, 100vw' : '(min-width: 1024px) 20vw, 50vw'}
                  width={item.sources.width}
                  height={item.sources.height}
                  alt=""
                  // The first row is in the first screen at every width.
                  loading={i < 5 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              </a>
              <span aria-hidden="true" className={styles.tileTag}>
                {item.category}
              </span>
            </li>
          )
        })}
      </ul>
      <Edge kind="weave" />

      <dialog
        ref={dialogRef}
        data-tone="deep"
        data-lock-scroll=""
        aria-label="عارض الصور"
        className={styles.viewer}
        onClose={() => setIndex(-1)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            step(1)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            step(-1)
          }
        }}
        onTouchStart={(event) => {
          touchX.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const start = touchX.current
          touchX.current = null
          const end = event.changedTouches[0]?.clientX
          if (start === null || end === undefined || Math.abs(end - start) < 40) return
          step(end > start ? 1 : -1)
        }}
      >
        {current && (
          <>
            <div className={styles.viewerBar}>
              <span dir="ltr" aria-live="polite" className="t-label">
                {index + 1} / {shown.length}
              </span>
              <button type="button" data-tone="coral" className={styles.close} onClick={() => setIndex(-1)}>
                إغلاق
              </button>
            </div>
            <div className={styles.stage}>
              {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15); the srcset comes from the manifest */}
              <img
                key={current.key}
                src={current.sources.src}
                srcSet={current.sources.srcSet}
                sizes="100vw"
                width={current.sources.width}
                height={current.sources.height}
                alt={current.caption}
                className={styles.photo}
                data-direction={direction}
              />
              <button type="button" className={`${styles.stepButton} ${styles.prev}`} aria-label="الصورة السابقة" onClick={() => step(-1)}>
                →
              </button>
              <button type="button" className={`${styles.stepButton} ${styles.next}`} aria-label="الصورة التالية" onClick={() => step(1)}>
                ←
              </button>
            </div>
            <div className={styles.viewerFoot}>
              <span className={styles.caption}>{current.caption}</span>
              <span data-tone="saffron" className={styles.category}>
                {current.category}
              </span>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
