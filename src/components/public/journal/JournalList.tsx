'use client'

import Link from 'next/link'
import { useState } from 'react'

import type { Tone } from '@/components/weave/tones'
import type { ImageSources } from '@/lib/images'

import styles from './journal.module.css'

export interface JournalCard {
  slug: string
  title: string
  excerpt: string
  categories: string[]
  cover: ImageSources | null
  /** The publication instant, for the machine-readable `<time>`. */
  publishedAt: string
  /** The publication day as the page shows it, formatted where the page is built. */
  date: string
}

const ALL = 'الكل'
// The cards are woven in turn from these surfaces (B's journal).
const CARD_TONES: Tone[] = ['paper', 'aub', 'coral', 'paper', 'night']

/** «تدوينة واحدة», «تدوينتان», «n تدوينات», «n تدوينة» (Arabic dual and plural). */
function postCount(n: number): string {
  if (n === 1) return 'تدوينة واحدة'
  if (n === 2) return 'تدوينتان'
  if (n <= 10) return `${n} تدوينات`
  return `${n} تدوينة`
}

/**
 * The posts, newest first and largest, with a filter by category (toggle
 * buttons, shown only when there is more than one category to choose; a
 * status line tells a screen reader what the choice left).
 */
export function JournalList({ posts }: { posts: JournalCard[] }) {
  const [category, setCategory] = useState(ALL)
  const categories = [...new Set(posts.flatMap((post) => post.categories))]
  const shown = category === ALL ? posts : posts.filter((post) => post.categories.includes(category))

  return (
    <>
      {categories.length > 1 && (
        <>
          <div role="group" aria-label="التصنيفات" className={styles.filters}>
            {[ALL, ...categories].map((name) => (
              <button key={name} type="button" aria-pressed={category === name} className={styles.filter} onClick={() => setCategory(name)}>
                {name}
              </button>
            ))}
          </div>
          <p role="status" className="visually-hidden">
            {`${category}: ${postCount(shown.length)}`}
          </p>
        </>
      )}
      <ol key={category} className={styles.cards}>
        {shown.map((post, i) => (
          <li key={post.slug} data-tone={CARD_TONES[posts.indexOf(post) % CARD_TONES.length]} className={i === 0 ? styles.lead : styles.card}>
            <Link href={`/journal/${post.slug}`} prefetch={false} className={styles.cardLink}>
              {post.cover && (
                <span className={styles.cardCover}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15); the srcset comes from the manifest */}
                  <img
                    src={post.cover.src}
                    srcSet={post.cover.srcSet}
                    sizes={i === 0 ? '(min-width: 1024px) 50vw, 100vw' : '(min-width: 1024px) 25vw, 100vw'}
                    width={post.cover.width}
                    height={post.cover.height}
                    alt=""
                    // The lead card is on the first screen, and it is the largest thing there.
                    loading={i === 0 ? 'eager' : 'lazy'}
                    fetchPriority={i === 0 ? 'high' : undefined}
                    decoding="async"
                  />
                </span>
              )}
              <span className={styles.cardBody}>
                {post.categories[0] && <span className={styles.cardTag}>{post.categories[0]}</span>}
                <h2 className={i === 0 ? 't-h2' : 't-h3'}>{post.title}</h2>
                {post.excerpt && <span className="t-body">{post.excerpt}</span>}
                <time dateTime={post.publishedAt} className="t-label">
                  {post.date}
                </time>
                <span className="t-label">
                  اقرأ <span aria-hidden="true">←</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
        {shown.length > 1 && (shown.length - 1) % 2 === 1 && <li aria-hidden="true" className={styles.weaveCell} />}
      </ol>
    </>
  )
}
