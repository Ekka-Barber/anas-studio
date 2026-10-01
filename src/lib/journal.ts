/**
 * المجلس's build-time loader (P01 journal, D11, D32): the published, visible
 * posts with their category labels, newest first. Read with the publishable
 * key like every other public loader; each post is parsed with the
 * collection's schema, so an invalid published post fails the build and the
 * last good deployment stays live (D32).
 */
import { cache } from 'react'
import { z } from 'zod'

import { postSchema, taxonomySchema } from '../admin/collections'
import type { RichTextDocument } from '../admin/richtext'

import { mediaById, replaceMediaIds, type MediaLookup } from './content'
import { requireEnv } from './env'
import { collectMediaIds, MEDIA_ORIGIN } from './media-ref'

export interface JournalPost {
  id: string
  slug: string
  title: string
  excerpt: string
  body: RichTextDocument
  author: string
  /** Category labels, in the post's order. */
  categories: string[]
  /** A manifest id or a resolved media reference; null when there is none. */
  cover: string | null
  publishedAt: string
}

const rowSchema = z.object({ doc_id: z.string(), data: z.unknown(), first_published_at: z.string() })

async function published(collection: 'posts' | 'taxonomies') {
  const params = new URLSearchParams({ collection: `eq.${collection}`, select: 'doc_id,data,first_published_at' })
  const response = await fetch(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/published_documents?${params}`, {
    headers: { apikey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') },
  })
  if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`)
  return z.array(rowSchema).parse(await response.json())
}

type PostData = z.infer<typeof postSchema>

/**
 * A stored post as the public pages show it: category slugs become their
 * labels, the cover resolves to a media reference. The build (`getPosts`) and
 * the admin's draft preview both shape through here, so they cannot differ.
 */
export function shapePost(
  post: PostData,
  meta: { id: string; publishedAt: string },
  labels: Map<string, string>,
  byId: MediaLookup,
): JournalPost {
  return {
    id: meta.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    author: post.author,
    categories: post.categories.flatMap((slug) => labels.get(slug) ?? []),
    cover: post.cover ? replaceMediaIds(post.cover, byId, MEDIA_ORIGIN) : null,
    publishedAt: meta.publishedAt,
  }
}

export const getPosts = cache(async (): Promise<JournalPost[]> => {
  const [postRows, taxonomyRows] = await Promise.all([published('posts'), published('taxonomies')])
  const labels = new Map<string, string>()
  for (const row of taxonomyRows) {
    const taxonomy = taxonomySchema.parse(row.data)
    if (taxonomy.kind === 'category') labels.set(row.doc_id, taxonomy.label)
  }
  const posts = postRows.map((row) => {
    const parsed = postSchema.safeParse(row.data)
    if (!parsed.success) throw new Error(`Invalid published post ${row.doc_id}: ${parsed.error.message}`)
    return { row, post: parsed.data }
  })
  const visible = posts.filter(({ post }) => post.visible)
  const byId = await mediaById([...new Set(visible.flatMap(({ post }) => (post.cover ? collectMediaIds(post.cover) : [])))])
  return visible
    .map(({ row, post }) => shapePost(post, { id: row.doc_id, publishedAt: row.first_published_at }, labels, byId))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
})

/** Words in a rich-text document, for the reading time. */
export function wordCount(document: RichTextDocument): number {
  let words = 0
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const { text, children } = node as { text?: unknown; children?: unknown }
    if (typeof text === 'string') words += text.split(/\s+/).filter(Boolean).length
    if (Array.isArray(children)) children.forEach(walk)
  }
  walk(document.root)
  return words
}

/** «دقيقة للقراءة», «دقيقتان للقراءة», «n دقائق للقراءة» (Arabic dual and plural). */
export function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 180))
  if (minutes === 1) return 'دقيقة للقراءة'
  if (minutes === 2) return 'دقيقتان للقراءة'
  if (minutes <= 10) return `${minutes} دقائق للقراءة`
  return `${minutes} دقيقة للقراءة`
}
