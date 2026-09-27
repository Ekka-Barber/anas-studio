'use client'

/**
 * Lexical rich-text editor (P04 part 2, D14). Only the nodes allowlisted by
 * `src/admin/richtext.ts` are registered, so nothing the editor can produce
 * falls outside the schema publishing checks. Client-only: Lexical must not
 * load on public pages.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode, REMOVE_LIST_COMMAND } from '@lexical/list'
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type EditorState,
  type ElementNode,
  type LexicalEditor,
} from 'lexical'

import type { RichTextDocument } from '@/admin/richtext'

import styles from './admin.module.css'

type BlockType = 'paragraph' | 'h2' | 'h3' | 'quote' | 'bullet' | 'number'

function toggleBlock(editor: LexicalEditor, create: () => ElementNode) {
  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const targets = new Set<ElementNode>()
    for (const node of selection.getNodes()) {
      const top = node.getTopLevelElementOrThrow()
      if ($isElementNode(top)) targets.add(top)
    }
    for (const node of targets) {
      const next = create()
      for (const child of node.getChildren()) next.append(child)
      node.replace(next)
    }
  })
}

function Toolbar(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [blockType, setBlockType] = useState<BlockType>('paragraph')
  const [linkUrl, setLinkUrl] = useState('')

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        setBold(selection.hasFormat('bold'))
        setItalic(selection.hasFormat('italic'))
        const anchorNode = selection.anchor.getNode()
        const element = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow()
        if ($isHeadingNode(element)) setBlockType(element.getTag() === 'h3' ? 'h3' : 'h2')
        else if ($isQuoteNode(element)) setBlockType('quote')
        else if ($isListNode(element)) setBlockType(element.getListType() === 'number' ? 'number' : 'bullet')
        else setBlockType('paragraph')

        const linkNode = [anchorNode, ...anchorNode.getParents()].find($isLinkNode)
        setLinkUrl(linkNode ? linkNode.getURL() : '')
      })
    })
  }, [editor])

  function applyLink() {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl.startsWith('https://') ? linkUrl : null)
  }

  function toggleList(type: 'bullet' | 'number') {
    if (blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
    } else {
      editor.dispatchCommand(type === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined)
    }
  }

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'paragraph'}
        onClick={() => toggleBlock(editor, () => $createParagraphNode())}
      >
        فقرة
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'h2'}
        onClick={() => toggleBlock(editor, () => $createHeadingNode('h2'))}
      >
        عنوان 2
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'h3'}
        onClick={() => toggleBlock(editor, () => $createHeadingNode('h3'))}
      >
        عنوان 3
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={bold}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        غامق
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={italic}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        مائل
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'bullet'}
        onClick={() => toggleList('bullet')}
      >
        قائمة نقطية
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'number'}
        onClick={() => toggleList('number')}
      >
        قائمة مرقمة
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-pressed={blockType === 'quote'}
        onClick={() => toggleBlock(editor, () => $createQuoteNode())}
      >
        اقتباس
      </button>
      <input
        className={styles.input}
        type="text"
        dir="ltr"
        aria-label="رابط https"
        placeholder="https://"
        value={linkUrl}
        onChange={(event) => setLinkUrl(event.target.value)}
      />
      <button type="button" className={styles.toolbarButton} onClick={applyLink}>
        تطبيق الرابط
      </button>
    </div>
  )
}

const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode]

export function RichTextEditor({
  value,
  onChange,
}: {
  value: RichTextDocument
  onChange: (value: RichTextDocument) => void
}) {
  const hasContent = value.root.children.length > 0
  // Lexical only reads `initialConfig` at mount; recreating this object on
  // later renders is harmless. Parents force a remount (via `key`) when the
  // document is reloaded (restore, conflict reload, initial load).
  const initialConfig = {
    namespace: 'anasaq-admin-richtext',
    nodes: NODES,
    editorState: hasContent ? JSON.stringify(value) : undefined,
    onError(error: Error) {
      throw error
    },
  }

  const handleChange = useCallback(
    (editorState: EditorState) => {
      onChange(editorState.toJSON() as unknown as RichTextDocument)
    },
    [onChange],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Toolbar />
      <RichTextPlugin
        contentEditable={
          <ContentEditable className={styles.editor} dir="rtl" aria-label="محرر النص المنسق" />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin />
      <LinkPlugin />
      <HistoryPlugin />
      <OnChangePlugin onChange={handleChange} />
    </LexicalComposer>
  )
}
