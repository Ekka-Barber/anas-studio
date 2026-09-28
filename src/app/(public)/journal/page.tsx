import type { Metadata } from 'next'
import Link from 'next/link'

import { type JournalCard, JournalList } from '@/components/public/journal/JournalList'
import styles from '@/components/public/journal/journal.module.css'
import { Picture } from '@/components/public/Picture'
import { RoomHero } from '@/components/public/RoomHero'
import { Band } from '@/components/weave/Band'
import { enter } from '@/components/weave/motion'
import { RoomNav } from '@/components/weave/RoomNav'
import { imageSources } from '@/lib/images'
import { getPosts } from '@/lib/journal'

export const metadata: Metadata = { title: 'المجلس' }

/**
 * المجلس (D11, D39): the journal. Built from the published posts at build
 * time (D32); before the first post it says so plainly, beside the family
 * majlis from his Street No. 4 photos, and points back to the rooms.
 */
export default async function JournalPage() {
  const posts = await getPosts()
  const cards: JournalCard[] = posts.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    categories: post.categories,
    cover: post.cover ? imageSources(post.cover) : null,
  }))

  return (
    <>
      <main id="main">
        <RoomHero tone="aub" title="المجلس" />
        {cards.length > 0 ? (
          <Band tone="sand" pad="m" padEnd="xl" aria-label="التدوينات">
            <JournalList posts={cards} />
          </Band>
        ) : (
          <section aria-label="قبل أول تدوينة" className={styles.empty}>
            <figure className={`${styles.emptyPhoto} motion-scrub`} {...enter(400, 'media')}>
              <Picture
                id="street4-majlis"
                alt="مجلس البيت بكنباته المزهّرة"
                sizes="(min-width: 1024px) 50vw, 100vw"
                loading="eager"
                fetchPriority="high"
              />
            </figure>
            <div data-tone="coral" className={styles.emptyText}>
              <p className="t-h2" {...enter(560, 'band')}>
                لم تُنشر أول تدوينة بعد.
              </p>
              <Link href="/#rooms" prefetch={false} className="t-label" {...enter(700)}>
                إلى الغرف ←
              </Link>
            </div>
          </section>
        )}
      </main>
      <RoomNav back={{ href: '/book', label: 'كتبتُ هنا' }} next={{ href: '/scenes', label: 'المَشاهد' }} />
    </>
  )
}
