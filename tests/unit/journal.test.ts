import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { postSchema } from '../../src/admin/collections'
import { shapePost } from '../../src/lib/journal'

const post = (extra: Record<string, unknown> = {}) =>
  postSchema.parse({
    slug: 'a-post',
    title: 'عنوان',
    excerpt: 'مقتطف',
    body: { root: { type: 'root', children: [] } },
    author: 'أنس',
    categories: ['cat-a', 'cat-gone', 'cat-b'],
    tags: [],
    visible: true,
    ...extra,
  })

// The build and the admin's draft preview both shape a post through shapePost.
describe('shapePost', () => {
  const meta = { id: 'post-id', publishedAt: '2026-01-01T00:00:00Z' }
  const labels = new Map([
    ['cat-a', 'الأولى'],
    ['cat-b', 'الثانية'],
  ])

  it('turns category slugs into their labels, in order, and drops slugs with none', () => {
    expect(shapePost(post(), meta, labels, new Map()).categories).toEqual(['الأولى', 'الثانية'])
  })

  it('resolves a library cover to a media reference, and gives a post without one a null cover', () => {
    const cover = randomUUID()
    const byId = new Map([[cover, [{ width: 1200, height: 800 }]]])
    expect(shapePost(post({ cover }), meta, labels, byId).cover).toMatch(new RegExp(`/m/${cover}\\|1200x800\\|1200$`))
    expect(shapePost(post(), meta, labels, byId).cover).toBeNull()
  })

  it('keeps the id and date it is given, and the text of the post', () => {
    const shaped = shapePost(post(), { id: 'draft', publishedAt: '' }, labels, new Map())
    expect(shaped).toMatchObject({ id: 'draft', publishedAt: '', slug: 'a-post', title: 'عنوان', author: 'أنس' })
  })
})
