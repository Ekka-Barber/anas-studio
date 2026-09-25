/**
 * Rich-text allowlist (D14). Lexical's serialized JSON may only contain these
 * nodes; publishing rejects anything else, and `src/lib/richtext.tsx` draws
 * only these. Lexical adds bookkeeping keys (direction, format, indent,
 * version, ...), so objects are loose, but every node type and every value
 * the renderer uses is checked here.
 */
import { z } from 'zod'

export interface RichTextNode {
  type: string
  [key: string]: unknown
}

const children = z.lazy(() => z.array(inlineOrBlock).max(2000))

const text = z.looseObject({
  type: z.literal('text'),
  text: z.string().max(20000),
  /** Lexical format bitmask; the renderer honours bold (1) and italic (2). */
  format: z.number().int().min(0).max(2047).default(0),
})
const linebreak = z.looseObject({ type: z.literal('linebreak') })
const link = z.looseObject({
  type: z.literal('link'),
  url: z.url({ protocol: /^https$/ }).max(2000),
  children,
})
const paragraph = z.looseObject({ type: z.literal('paragraph'), children })
const heading = z.looseObject({ type: z.literal('heading'), tag: z.enum(['h2', 'h3']), children })
const quote = z.looseObject({ type: z.literal('quote'), children })
const listitem = z.looseObject({ type: z.literal('listitem'), children })
const list = z.looseObject({
  type: z.literal('list'),
  listType: z.enum(['bullet', 'number']),
  children: z.array(listitem).max(500),
})

const inlineOrBlock: z.ZodType<RichTextNode> = z.union([
  text,
  linebreak,
  link,
  paragraph,
  heading,
  quote,
  list,
  listitem,
])

export const richTextSchema = z.looseObject({
  root: z.looseObject({
    type: z.literal('root'),
    children: z.array(z.union([paragraph, heading, quote, list])).max(1000),
  }),
})

export type RichTextDocument = z.infer<typeof richTextSchema>

export const TEXT_FORMAT_BOLD = 1
export const TEXT_FORMAT_ITALIC = 2
