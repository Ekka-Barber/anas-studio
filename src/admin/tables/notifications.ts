import type { TableConfig } from './index'

/**
 * The availability sign-ups, «أخبرني عند توفره» (P08 round 11c): a read-only list for owner and operations. The
 * `notify` function writes the rows through its own SQL functions and nobody writes through the API
 * (`public.notifications` grants `select` alone, to those two roles by RLS), so there is no form, no «جديد» and
 * no link on a row (`edit: false`). Newest first; the SKU is the row's variant, read as an embedded `product_variants(sku)`.
 */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكَّد',
  unsubscribed: 'ألغى الاشتراك',
}

export const notificationsConfig: TableConfig = {
  table: 'notifications',
  label: 'طلبات الإشعار',
  read: 'staff',
  insert: false,
  edit: false,
  listColumns: [
    { key: 'email', label: 'البريد الإلكتروني', dir: 'ltr' },
    {
      key: 'product_variants(sku)',
      label: 'رمز SKU',
      dir: 'ltr',
      text: (row) => {
        const variant = row.product_variants
        const sku = typeof variant === 'object' && variant !== null ? (variant as { sku?: unknown }).sku : undefined
        return typeof sku === 'string' ? sku : 'لا يوجد'
      },
    },
    {
      key: 'status',
      label: 'الحالة',
      text: (row) => (typeof row.status === 'string' && Object.hasOwn(STATUS_LABELS, row.status) ? STATUS_LABELS[row.status]! : String(row.status)),
    },
    // The privacy policy's revision the visitor's page showed; none while no policy was published.
    { key: 'consent_revision', label: 'نسخة الموافقة', text: (row) => (row.consent_revision === null ? 'بلا' : String(row.consent_revision)) },
    { key: 'created_at', label: 'تاريخ الطلب' },
    { key: 'confirmed_at', label: 'تاريخ التأكيد' },
  ],
  // No form: the list is all there is.
  fields: [],
  order: [{ column: 'created_at', ascending: false }],
  uniqueMessage: '',
  toRow: () => ({}),
}
