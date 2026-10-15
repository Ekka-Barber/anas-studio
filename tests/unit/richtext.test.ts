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

// ADMIN-CMS-12: the form prints a limit's message after the field's label, so each limit says in Arabic what to do.
describe('richTextSchema: each document limit has its own message', () => {
  const doc = (...blocks: unknown[]) => ({ root: { type: 'root', children: blocks } })
  const paragraph = (...inline: unknown[]) => ({ type: 'paragraph', children: inline })
  const words = (value: string) => ({ type: 'text', text: value, format: 0 })
  const item = { type: 'listitem', children: [words('بند')] }
  const issues = (value: unknown) => {
    const result = richTextSchema.safeParse(value)
    return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  }

  it('a text node over 20000 characters', () => {
    expect(issues(doc(paragraph(words('ا'.repeat(20000)))))).toEqual([])
    expect(issues(doc(paragraph(words('ا'.repeat(20001)))))).toEqual([
      { path: 'root.children.0.children.0.text', message: 'الفقرة أطول من 20000 حرف؛ قسّمها.' },
    ])
  })

  it('a block with more than 2000 lines and formats in it', () => {
    const lines = (count: number) => paragraph(...Array.from({ length: count }, () => ({ type: 'linebreak' })))
    expect(issues(doc(lines(2000)))).toEqual([])
    expect(issues(doc(lines(2001)))).toEqual([
      { path: 'root.children.0.children', message: 'الفقرة فيها أسطر أو تنسيقات كثيرة جدًا؛ قسّمها إلى فقرات.' },
    ])
  })

  it('a list over 500 items', () => {
    const list = (count: number) => ({ type: 'list', listType: 'bullet', children: Array.from({ length: count }, () => item) })
    expect(issues(doc(list(500)))).toEqual([])
    expect(issues(doc(list(501)))).toEqual([{ path: 'root.children.0.children', message: 'القائمة أطول من 500 بند؛ قسّمها.' }])
  })

  it('a root over 1000 blocks', () => {
    const blocks = (count: number) => doc(...Array.from({ length: count }, () => paragraph()))
    expect(issues(blocks(1000))).toEqual([])
    expect(issues(blocks(1001))).toEqual([
      { path: 'root.children', message: 'النص أطول من 1000 فقرة؛ قسّمه أو احذف الأسطر الفارغة.' },
    ])
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

  it('drops a link the rule refuses but keeps its text', () => {
    const doc = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'link', url: 'HTTPS://example.com', children: [{ type: 'text', text: 'نص', format: 0 }] }],
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

describe('a link follows one rule in the editor, the schema and the renderer (CLIENT-SEC-07)', () => {
  const linked = (url: string) => ({
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'link', url, children: [{ type: 'text', text: 'نص', format: 0 }] }] }],
    },
  })
  const html = (url: string) => renderToStaticMarkup(RichText({ document: linked(url) as never }))

  it.each(['https://example.com', 'https://example.com/path?q=1#part', 'https://example.com:8443/a_b'])(
    'accepts %s, and the page links to it',
    (url) => {
      expect(richTextSchema.safeParse(linked(url)).success).toBe(true)
      expect(html(url)).toContain(`<a href="${url}" rel="noopener noreferrer">`)
    },
  )

  it.each([
    // Only https: the site links to nothing else (F3-11), whatever F2a let in.
    'http://example.com',
    'http://example.com/path?q=1#part',
    'mailto:anas@example.com',
    'MAILTO:anas@example.com',
    'tel:+966500000000',
    'HTTPS://example.com',
    'Http://example.com',
    'https:example.com',
    'https:/example.com',
    'https://',
    'https://exa mple.com',
    'https://[',
    '//example.com',
    'ftp://example.com',
    'javascript:alert(1)',
  ])('refuses %s, and the page draws its text with no link', (url) => {
    expect(richTextSchema.safeParse(linked(url)).success).toBe(false)
    expect(html(url)).not.toContain('<a ')
    expect(html(url)).toContain('نص')
  })
})
