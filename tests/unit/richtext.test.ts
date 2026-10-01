import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { richTextSchema } from '../../src/admin/richtext'
import { RichText } from '../../src/lib/richtext'

describe('richTextSchema: accepts the allowlisted nodes', () => {
  it('accepts a document with every allowlisted node type', () => {
    const doc = {
      root: {
        type: 'root',
        children: [
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'عنوان', format: 1 }] },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'نص مائل', format: 2 },
              { type: 'linebreak' },
              { type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'رابط', format: 0 }] },
            ],
          },
          { type: 'quote', children: [{ type: 'text', text: 'اقتباس', format: 0 }] },
          {
            type: 'list',
            listType: 'bullet',
            children: [{ type: 'listitem', children: [{ type: 'text', text: 'عنصر', format: 0 }] }],
          },
        ],
      },
    }
    expect(richTextSchema.safeParse(doc).success).toBe(true)
  })

  it('accepts an empty document', () => {
    expect(richTextSchema.safeParse({ root: { type: 'root', children: [] } }).success).toBe(true)
  })
})

describe('richTextSchema: rejects what is not allowlisted', () => {
  it('rejects a non-https link', () => {
    const doc = {
      root: {
        type: 'root',
        // Inside a paragraph, where a link is allowed: only its URL is wrong.
        children: [{ type: 'paragraph', children: [{ type: 'link', url: 'javascript:alert(1)', children: [] }] }],
      },
    }
    expect(richTextSchema.safeParse(doc).success).toBe(false)
  })

  it('rejects a top-level list item type not in the root union', () => {
    const doc = { root: { type: 'root', children: [{ type: 'not-a-real-node' }] } }
    expect(richTextSchema.safeParse(doc).success).toBe(false)
  })
})

describe('RichText renderer', () => {
  it('renders bold and italic text, links, headings, quotes and lists', () => {
    const doc = richTextSchema.parse({
      root: {
        type: 'root',
        children: [
          { type: 'heading', tag: 'h3', children: [{ type: 'text', text: 'عنوان فرعي', format: 0 }] },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'غامق', format: 1 },
              { type: 'text', text: 'مائل', format: 2 },
              { type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'رابط', format: 0 }] },
            ],
          },
          { type: 'quote', children: [{ type: 'text', text: 'اقتباس', format: 0 }] },
          {
            type: 'list',
            listType: 'number',
            children: [{ type: 'listitem', children: [{ type: 'text', text: 'عنصر', format: 0 }] }],
          },
        ],
      },
    })
    const html = renderToStaticMarkup(RichText({ document: doc }))
    expect(html).toContain('<h3><span>عنوان فرعي</span></h3>')
    expect(html).toContain('<strong>غامق</strong>')
    expect(html).toContain('<em>مائل</em>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<blockquote><span>اقتباس</span></blockquote>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li><span>عنصر</span></li>')
  })

  it('drops a non-https link but keeps its text', () => {
    const doc = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'link', url: 'http://example.com', children: [{ type: 'text', text: 'نص', format: 0 }] }],
          },
        ],
      },
    }
    const html = renderToStaticMarkup(RichText({ document: doc as never }))
    expect(html).not.toContain('<a ')
    expect(html).toContain('نص')
  })

  it('draws a nested list inside the item before it, with no wrapper bullet (ADMIN-publish-10)', () => {
    const item = (text: string) => ({ type: 'listitem', children: [{ type: 'text', text, format: 0 }] })
    const doc = {
      root: {
        type: 'root',
        children: [
          {
            type: 'list',
            listType: 'bullet',
            // Lexical's shape: the nested list sits in a listitem of its own.
            children: [item('one'), { type: 'listitem', children: [{ type: 'list', listType: 'number', children: [item('a')] }] }, item('two')],
          },
        ],
      },
    }
    const html = renderToStaticMarkup(RichText({ document: doc as never }))
    expect(html).toBe(
      '<ul><li><span>one</span><ol><li><span>a</span></li></ol></li><li><span>two</span></li></ul>',
    )
  })
})
