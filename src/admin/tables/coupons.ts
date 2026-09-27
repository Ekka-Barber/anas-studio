import { formatMoney } from '../../lib/format'
import { formatRiyalsInput } from '../../lib/money-input'

import type { TableConfig, TableField } from './index'

/**
 * Coupons: owner-only even to read (RLS). The percentage is typed as a
 * percentage with up to two decimals and stored as basis points
 * (10 → 1000, 12.5 → 1250), mapped in `toRow`/`fromRow`; the field the
 * coupon's kind does not use is saved as null, as the table's checks require.
 * `product_ids` is a `relation` field the form renders as product checkboxes
 * (an empty selection means every product).
 */
const fields: readonly TableField[] = [
  { name: 'code', label: 'الكود', type: 'text' },
  {
    name: 'kind',
    label: 'نوع الخصم',
    type: 'select',
    options: ['percent', 'fixed'],
    optionLabels: { percent: 'نسبة', fixed: 'مبلغ ثابت' },
  },
  { name: 'percent', label: 'النسبة المئوية', type: 'money', unit: 'percent', max: 10000, nullable: true, visibleWhen: (values) => values.kind === 'percent' },
  { name: 'amount_halalas', label: 'المبلغ', type: 'money', nullable: true, visibleWhen: (values) => values.kind === 'fixed' },
  { name: 'starts_at', label: 'يبدأ في', type: 'datetime', nullable: true },
  { name: 'ends_at', label: 'ينتهي في', type: 'datetime', nullable: true },
  { name: 'min_subtotal_halalas', label: 'الحد الأدنى للسلة', type: 'money', min: 0 },
  { name: 'usage_limit', label: 'حد الاستخدام', type: 'number', min: 1, nullable: true },
  { name: 'product_ids', label: 'المنتجات المشمولة', type: 'relation' },
  { name: 'enabled', label: 'مفعّل', type: 'boolean' },
]

export const couponsConfig: TableConfig = {
  table: 'coupons',
  label: 'أكواد الخصم',
  read: 'owner',
  insert: true,
  listColumns: [
    { key: 'code', label: 'الكود' },
    { key: 'kind', label: 'النوع' },
    {
      key: 'percent_bp',
      label: 'القيمة',
      text: (row) =>
        row.kind === 'percent'
          ? `${formatRiyalsInput(row.percent_bp as number)}٪`
          : row.amount_halalas === null || row.amount_halalas === undefined
            ? 'لا يوجد'
            : formatMoney(row.amount_halalas as number),
    },
    { key: 'enabled', label: 'مفعّل' },
    { key: 'updated_at', label: 'آخر تغيير' },
  ],
  fields,
  order: [{ column: 'code', ascending: true }],
  uniqueMessage: 'الكود مستخدم من قبل.',
  toRow: (values) => ({
    code: typeof values.code === 'string' ? values.code.trim().toUpperCase() : values.code,
    kind: values.kind,
    percent_bp: values.kind === 'percent' ? (values.percent ?? null) : null,
    amount_halalas: values.kind === 'fixed' ? (values.amount_halalas ?? null) : null,
    starts_at: values.starts_at ?? null,
    ends_at: values.ends_at ?? null,
    min_subtotal_halalas: values.min_subtotal_halalas ?? 0,
    usage_limit: values.usage_limit ?? null,
    product_ids: Array.isArray(values.product_ids) ? values.product_ids : [],
    enabled: values.enabled,
  }),
  fromRow: (row) => ({
    code: row.code,
    kind: row.kind,
    percent: row.percent_bp ?? null,
    amount_halalas: row.amount_halalas ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    min_subtotal_halalas: row.min_subtotal_halalas ?? 0,
    usage_limit: row.usage_limit ?? null,
    product_ids: row.product_ids ?? [],
    enabled: row.enabled,
  }),
}
