import { type Field, schemaFromFields } from '../fields'

/**
 * `policies` (P07 round 2): the store's policy texts as content, exactly the
 * shape the demo seed wrote (D37). Fixed documents like the rooms: editors
 * draft and publish the text; it becomes the store's checkout policy only
 * when the owner approves the published revisions into
 * `finance.commerce_settings` (the `admin` action `commerce-policies-approve`).
 * Policies are never archived: `archive_document` already refuses anything
 * but posts and taxonomies.
 */
export const policyFields = [
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  { name: 'body', label: 'النص', type: 'richtext' },
] as const satisfies Field[]

/** Whether a rich-text node, or anything under it, holds text other than spaces. */
function hasText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const { text, children } = node as { text?: unknown; children?: unknown }
  if (typeof text === 'string' && text.trim() !== '') return true
  return Array.isArray(children) && children.some(hasText)
}

export const POLICY_BODY_ERROR = 'اكتب نص السياسة.'

/**
 * A policy with no title or no text cannot go live: the owner approves the
 * published revisions as the ones the buyer agrees to at checkout, and the
 * page would show an empty heading and body.
 */
export const policySchema = schemaFromFields(policyFields).superRefine((value, ctx) => {
  if (!hasText(value.body.root)) ctx.addIssue({ code: 'custom', path: ['body'], message: POLICY_BODY_ERROR })
})

export const POLICY_DOC_IDS = ['store', 'delivery', 'refund', 'privacy'] as const
export type PolicyDocId = (typeof POLICY_DOC_IDS)[number]

/** Arabic labels for the four fixed policy documents. */
export const POLICY_DOC_LABELS: Record<PolicyDocId, string> = {
  store: 'سياسة المتجر',
  delivery: 'سياسة التوصيل',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية',
}
