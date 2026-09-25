/**
 * Safe public renderer for rich text (D14). Draws only the allowlisted nodes
 * from `src/admin/richtext.ts`; anything else renders nothing. No HTML
 * strings, no inline styles, https links only.
 */
import type { ReactNode } from 'react'

import { TEXT_FORMAT_BOLD, TEXT_FORMAT_ITALIC, type RichTextDocument, type RichTextNode } from '../admin/richtext'

function childrenOf(node: RichTextNode): RichTextNode[] {
  return Array.isArray(node.children) ? (node.children as RichTextNode[]) : []
}

function renderNodes(nodes: RichTextNode[]): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index))
}

function renderNode(node: RichTextNode, key: number): ReactNode {
  switch (node.type) {
    case 'text': {
      const value = typeof node.text === 'string' ? node.text : ''
      const format = typeof node.format === 'number' ? node.format : 0
      let out: ReactNode = value
      if (format & TEXT_FORMAT_ITALIC) out = <em>{out}</em>
      if (format & TEXT_FORMAT_BOLD) out = <strong>{out}</strong>
      return <span key={key}>{out}</span>
    }
    case 'linebreak':
      return <br key={key} />
    case 'link': {
      const url = typeof node.url === 'string' && node.url.startsWith('https://') ? node.url : null
      if (!url) return <span key={key}>{renderNodes(childrenOf(node))}</span>
      return (
        <a key={key} href={url} rel="noopener noreferrer">
          {renderNodes(childrenOf(node))}
        </a>
      )
    }
    case 'paragraph':
      return <p key={key}>{renderNodes(childrenOf(node))}</p>
    case 'heading':
      return node.tag === 'h3' ? (
        <h3 key={key}>{renderNodes(childrenOf(node))}</h3>
      ) : (
        <h2 key={key}>{renderNodes(childrenOf(node))}</h2>
      )
    case 'quote':
      return <blockquote key={key}>{renderNodes(childrenOf(node))}</blockquote>
    case 'list': {
      const items = childrenOf(node).filter((child) => child.type === 'listitem')
      const rendered = items.map((item, index) => <li key={index}>{renderNodes(childrenOf(item))}</li>)
      return node.listType === 'number' ? <ol key={key}>{rendered}</ol> : <ul key={key}>{rendered}</ul>
    }
    default:
      return null
  }
}

export function RichText({ document }: { document: RichTextDocument }) {
  return <>{renderNodes(document.root.children as RichTextNode[])}</>
}
