import { $createLinkNode, LinkNode } from '@lexical/link'
import { $createListItemNode, $createListNode, ListItemNode, ListNode, registerList } from '@lexical/list'
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ElementNode,
  type LexicalEditor,
} from 'lexical'
import { describe, expect, it } from 'vitest'

import { richTextSchema } from '../../src/admin/richtext'
import { registerAllowlistTransforms, toggleBlock } from '../../src/components/admin/RichTextEditor'

describe('the editor keeps pasted HTML inside the rich-text allowlist', () => {
  it('maps h1 to h2 and h4-h6 to h3, and unwraps a link the link rule refuses', () => {
    // The editor's own node set: the transforms include one for lists.
    const editor = headlessEditor()
    registerAllowlistTransforms(editor)
    editor.update(
      () => {
        $getRoot().append(
          $createHeadingNode('h1').append($createTextNode('a')),
          $createHeadingNode('h5').append($createTextNode('b')),
          $createHeadingNode('h2').append($createTextNode('c')),
          $createParagraphNode().append(
            $createLinkNode('HTTPS://plain.test').append($createTextNode('d')),
            $createLinkNode('https://safe.test').append($createTextNode('e')),
          ),
        )
      },
      { discrete: true },
    )
    const json = editor.getEditorState().toJSON()
    const blocks = json.root.children as unknown as Array<{ type: string; tag?: string; children: Array<{ type: string; url?: string; text?: string }> }>

    expect(blocks.slice(0, 3).map((block) => block.tag)).toEqual(['h2', 'h3', 'h2'])
    expect(blocks[3]!.children.map((node) => node.type)).toEqual(['text', 'link'])
    expect(blocks[3]!.children[0]!.text).toBe('d')
    expect(JSON.stringify(json)).not.toContain('HTTPS://plain.test')
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })
})

function headlessEditor() {
  return createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
    onError: (error) => {
      throw error
    },
  })
}

describe('a pasted tab never blocks publishing (ADMIN-publish-1, X-CONTRACT-4)', () => {
  // The path the clipboard takes for plain text: a tab becomes a `tab` node.
  function paste(editor: LexicalEditor, raw: string) {
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        paragraph.select()
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertRawText(raw)
      },
      { discrete: true },
    )
    return editor.getEditorState().toJSON()
  }

  it('without the transform the tab node is something the schema refuses', () => {
    const json = paste(headlessEditor(), 'col1\tcol2\nline2')
    expect(JSON.stringify(json)).toContain('"type":"tab"')
    expect(richTextSchema.safeParse(json).success).toBe(false)
  })

  it('with it the tab is one space and the document is valid', () => {
    const editor = headlessEditor()
    registerAllowlistTransforms(editor)
    const json = paste(editor, 'col1\tcol2\nline2')
    expect(JSON.stringify(json)).not.toContain('"type":"tab"')
    expect(JSON.stringify(json)).toContain('col1 col2')
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })

  it('a node the schema refuses says so in Arabic, not «Invalid input»', () => {
    const result = richTextSchema.safeParse({
      root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'tab', text: '\t' }] }] },
    })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toBe('يحتوي النص عنصرًا غير صالح؛ احذف ما لصقته أو أعد كتابة الفقرة.')
  })
})

describe('the link rule is the schema rule (ADMIN-publish-2)', () => {
  it('unwraps a link the schema would refuse: «https://» alone, or with a space', () => {
    const editor = headlessEditor()
    registerAllowlistTransforms(editor)
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createLinkNode('https://').append($createTextNode('a')),
            $createLinkNode('https://exa mple.com').append($createTextNode('b')),
            $createLinkNode('https://example.com').append($createTextNode('c')),
          ),
        )
      },
      { discrete: true },
    )
    const json = editor.getEditorState().toJSON()
    const children = (json.root.children[0] as unknown as { children: Array<{ type: string }> }).children
    expect(children.map((node) => node.type)).toEqual(['text', 'link'])
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })

  it('keeps an https link, and unwraps http:, mailto:, «HTTPS://» and «https:host», which the site does not link to (CLIENT-SEC-07, F3-11)', () => {
    const editor = headlessEditor()
    registerAllowlistTransforms(editor)
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createLinkNode('HTTPS://example.com').append($createTextNode('a')),
            $createLinkNode('https:example.com').append($createTextNode('b')),
            $createLinkNode('http://example.com').append($createTextNode('c')),
            $createLinkNode('mailto:anas@example.com').append($createTextNode('d')),
            $createLinkNode('https://example.com').append($createTextNode('e')),
          ),
        )
      },
      { discrete: true },
    )
    const json = editor.getEditorState().toJSON()
    const children = (json.root.children[0] as unknown as { children: Array<{ type: string; url?: string; text?: string }> }).children
    expect(children.map((node) => node.url ?? node.text)).toEqual(['abcd', 'https://example.com'])
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })
})

describe('a pasted checklist never blocks publishing (CLIENT-SEC-03)', () => {
  // Lexical reads a Google Docs or GitHub checklist as a `check` list.
  function pasteChecklist(editor: LexicalEditor) {
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(true).append($createTextNode('done')),
            $createListItemNode(false).append($createTextNode('todo')),
          ),
        )
      },
      { discrete: true },
    )
    return editor.getEditorState().toJSON()
  }

  it('without the transform the check list is something the schema refuses', () => {
    expect(richTextSchema.safeParse(pasteChecklist(headlessEditor())).success).toBe(false)
  })

  it('with it the checklist is a bulleted list with the same items, and the document is valid', () => {
    const editor = headlessEditor()
    registerAllowlistTransforms(editor)
    const json = pasteChecklist(editor)
    const list = json.root.children[0] as unknown as { listType: string; children: Array<{ children: Array<{ text: string }> }> }
    expect(list.listType).toBe('bullet')
    expect(list.children.map((item) => item.children[0]!.text)).toEqual(['done', 'todo'])
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })
})

describe('the block buttons work inside a list (ADMIN-publish-6)', () => {
  async function toggleInSecondItem(create: () => ElementNode, emptySecond = false) {
    const editor = headlessEditor()
    registerList(editor)
    editor.update(
      () => {
        const second = $createListItemNode()
        if (!emptySecond) second.append($createTextNode('two'))
        $getRoot().append($createListNode('bullet').append($createListItemNode().append($createTextNode('one')), second))
        second.select()
      },
      { discrete: true },
    )
    toggleBlock(editor, create)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return editor.getEditorState().toJSON().root.children as unknown as Array<{ type: string; tag?: string }>
  }

  it('«فقرة» takes the selection out of its list', async () => {
    const blocks = await toggleInSecondItem(() => $createParagraphNode())
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('«عنوان 2» turns the selected item into a heading', async () => {
    const blocks = await toggleInSecondItem(() => $createHeadingNode('h2'))
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'heading'])
    expect(blocks[1]!.tag).toBe('h2')
  })

  it('also works when the selected item is empty', async () => {
    const blocks = await toggleInSecondItem(() => $createHeadingNode('h3'), true)
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'heading'])
  })
})
