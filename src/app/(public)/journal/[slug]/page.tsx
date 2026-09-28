import type { Metadata } from 'next'
import Link from 'next/link'

import styles from '@/components/public/journal/journal.module.css'
import { Picture } from '@/components/public/Picture'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { enter } from '@/components/weave/motion'
import { RoomNav } from '@/components/weave/RoomNav'
import { Signature } from '@/components/weave/Signature'
import { getPosts, readingTime, wordCount } from '@/lib/journal'
import { RichText } from '@/lib/richtext'

import NotFound from '../../not-found'

/**
 * One post of المجلس (D39): the saffron title band, the cover on paper, the
 * text in a reading column and Anas's signature at its end. A static page per
 * published slug (D32); with no posts yet, the placeholder `_` (never a slug:
 * slugs are lower-case letters, digits and hyphens) builds as the site's
 * not-found page inside the public layout, so it keeps `lang` and `dir`
 * (`notFound()` here would export Next's bare error document).
 */
export const dynamicParams = false
const NO_POSTS = '_'

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = (await getPosts()).map((post) => ({ slug: post.slug }))
  return slugs.length > 0 ? slugs : [{ slug: NO_POSTS }]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = (await getPosts()).find((entry) => entry.slug === slug)
  return post ? { title: post.title, description: post.excerpt || undefined } : { title: 'هذا الطريق لم يُبنَ بعد' }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const posts = await getPosts()
  const index = posts.findIndex((entry) => entry.slug === slug)
  const post = posts[index]
  if (!post) return <NotFound />
  const newer = posts[index - 1]
  const older = posts[index + 1]

  return (
    <>
      <div aria-hidden="true" className={styles.progress} />
      <main id="main">
        <article aria-labelledby="post-title">
          <Band as="header" tone="saffron" edge="crenel" pad="hero" padEnd="l">
            <nav aria-label="مسار" className={styles.crumbs} {...enter(40)}>
              <Link href="/journal" prefetch={false}>
                → المجلس
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
      <RoomNav
        back={older ? { href: `/journal/${older.slug}`, label: older.title } : { href: '/journal', label: 'المجلس' }}
        backLabel={older ? 'تدوينة سابقة' : 'العودة'}
        next={newer ? { href: `/journal/${newer.slug}`, label: newer.title } : undefined}
        nextLabel="تدوينة أحدث"
      />
    </>
  )
}
