import type { Metadata } from 'next'

import { PostView } from '@/components/public/journal/PostView'
import { RoomNav } from '@/components/weave/RoomNav'
import { getJournalName } from '@/lib/content'
import { getPosts } from '@/lib/journal'

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
  const [posts, journalName] = await Promise.all([getPosts(), getJournalName()])
  const index = posts.findIndex((entry) => entry.slug === slug)
  const post = posts[index]
  if (!post) return <NotFound />
  const newer = posts[index - 1]
  const older = posts[index + 1]

  return (
    <>
      <PostView post={post} journalName={journalName} />
      <RoomNav
        back={older ? { href: `/journal/${older.slug}`, label: older.title } : { href: '/journal', label: journalName }}
        backLabel={older ? 'تدوينة سابقة' : 'العودة'}
        next={newer ? { href: `/journal/${newer.slug}`, label: newer.title } : undefined}
        nextLabel="تدوينة أحدث"
      />
    </>
  )
}
