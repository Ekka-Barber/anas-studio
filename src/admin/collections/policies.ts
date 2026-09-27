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
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'body', label: 'النص', type: 'richtext' },
] as const satisfies Field[]
export const policySchema = schemaFromFields(policyFields)

export const POLICY_DOC_IDS = ['store', 'delivery', 'refund', 'privacy'] as const
export type PolicyDocId = (typeof POLICY_DOC_IDS)[number]

/** Arabic labels for the four fixed policy documents. */
export const POLICY_DOC_LABELS: Record<PolicyDocId, string> = {
  store: 'سياسة المتجر',
  delivery: 'سياسة التوصيل',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية',
}
