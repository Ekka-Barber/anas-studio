import type { CSSProperties, ReactNode } from 'react'

import { Picture } from '@/components/public/Picture'

import styles from './figure.module.css'

/**
 * A photograph, optionally with B's caption: a solid label in the band's
 * contrast colour, under the image (`below`) or sewn onto its bottom corner
 * (`corner`, for grids of equal tiles). `ratio` crops to a fixed shape with
 * `focus` as the object position; `scrub` adds the slow scroll zoom.
 */
export function Figure({
  id,
  alt,
  sizes,
  caption,
  captionPlacement = 'below',
  ratio,
  focus,
  scrub = false,
  reveal = true,
  loading,
  className,
}: {
  id: string
  alt: string
  sizes: string
  caption?: ReactNode
  captionPlacement?: 'below' | 'corner'
  ratio?: string
  focus?: string
  scrub?: boolean
  reveal?: boolean
  loading?: 'lazy' | 'eager'
  className?: string
}) {
  const frame = [styles.frame, ratio ? styles.cropped : '', scrub ? 'motion-scrub' : ''].filter(Boolean).join(' ')
  return (
    <figure
      className={`${styles.figure} ${className ?? ''}`}
      style={{ ...(ratio ? { '--ratio': ratio } : {}), ...(focus ? { '--focus-point': focus } : {}) } as CSSProperties}
      {...(reveal ? { 'data-reveal': '', 'data-fx': 'media' } : {})}
    >
      <div className={frame}>
        <Picture id={id} alt={alt} sizes={sizes} loading={loading} className={styles.picture} />
        {caption && captionPlacement === 'corner' && <figcaption data-tone="aub" className={styles.corner}>{caption}</figcaption>}
      </div>
      {caption && captionPlacement === 'below' && <figcaption data-tone="aub" className={styles.below}>{caption}</figcaption>}
    </figure>
  )
}
