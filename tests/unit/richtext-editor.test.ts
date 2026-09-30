import { $createLinkNode, LinkNode } from '@lexical/link'
import { $createHeadingNode, HeadingNode } from '@lexical/rich-text'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { describe, expect, it } from 'vitest'

import { richTextSchema } from '../../src/admin/richtext'
import { registerAllowlistTransforms } from '../../src/components/admin/RichTextEditor'

describe('the editor keeps pasted HTML inside the rich-text allowlist', () => {
  it('maps h1 to h2 and h4-h6 to h3, and unwraps a link that is not https', () => {
    const editor = createEditor({
      nodes: [HeadingNode, LinkNode],
      onError: (error) => {
        throw error
      },
    })
    registerAllowlistTransforms(editor)
    editor.update(
      () => {
        $getRoot().append(
          $createHeadingNode('h1').append($createTextNode('a')),
          $createHeadingNode('h5').append($createTextNode('b')),
          $createHeadingNode('h2').append($createTextNode('c')),
          $createParagraphNode().append(
            $createLinkNode('http://plain.test').append($createTextNode('d')),
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
    expect(JSON.stringify(json)).not.toContain('http://plain.test')
    expect(richTextSchema.safeParse(json).success).toBe(true)
  })
})
