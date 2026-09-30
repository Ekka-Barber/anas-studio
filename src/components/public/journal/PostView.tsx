import Link from 'next/link'

import { Picture } from '@/components/public/Picture'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { enter } from '@/components/weave/motion'
import { Signature } from '@/components/weave/Signature'
import { formatDate } from '@/lib/format'
import { readingTime, wordCount, type JournalPost } from '@/lib/journal'
import { RichText } from '@/lib/richtext'

import styles from './journal.module.css'

/**
 * One post of المجلس (D39): the saffron title band, the cover on paper, the
 * text in a reading column and Anas's signature at its end. Props only, so
 * the public page and the admin's draft preview draw it the same way; the
 * page adds the newer/older navigation after it. `journalName` is the
 * journal's editable name (D11); the draft preview has no publication date.
 */
export function PostView({ post, journalName = 'المجلس' }: { post: JournalPost; journalName?: string }) {
  return (
    <>
      <div aria-hidden="true" className={styles.progress} />
      <main id="main">
        <article aria-labelledby="post-title">
          <Band as="header" tone="saffron" edge="crenel" pad="hero" padEnd="l">
            <nav aria-label="مسار" className={styles.crumbs} {...enter(40)}>
              <Link href="/journal" prefetch={false}>
                <span aria-hidden="true">→ </span>
                {journalName}
              </Link>
              {post.categories[0] && (
                <span data-tone="aub" className={styles.cardTag}>
                  {post.categories[0]}
                </span>
              )}
            </nav>
            <h1 id="post-title" className={`t-title ${styles.postTitle}`} {...enter(140, 'band')}>
              {post.title}
            </h1>
            <p className={styles.meta} {...enter(420)}>
              {post.author && <span>{post.author}</span>}
              {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
              <span>{readingTime(wordCount(post.body))}</span>
            </p>
          </Band>
          {post.cover && (
            <Band tone="paper" pad="m">
              <figure className={styles.postCover} {...enter(520, 'media')}>
                <Picture id={post.cover} alt="" sizes="(min-width: 1100px) 1000px, 100vw" loading="eager" />
              </figure>
            </Band>
          )}
          <Edge kind="weave" />
          <Band tone="sand" pad="l" padEnd="xl">
            <div className={styles.prose}>
              <RichText document={post.body} />
            </div>
            <Signature width={210} className={styles.postSign} />
          </Band>
        </article>
      </main>
    </>
  )
}
