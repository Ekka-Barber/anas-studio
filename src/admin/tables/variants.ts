import type { TableConfig, TableField } from './index'

/**
 * A product's variants: edited only from the product's page, so the variant
 * key is not in the store list route's `generateStaticParams`. `product_id`
 * is fixed by the page, `digital_asset` is not in the form (paid files arrive
 * with P08), and `sku` is stored upper case.
 */
const fields: readonly TableField[] = [
  // The table's check is upper case; `toRow` upper-cases what is typed.
  { name: 'sku', label: 'رمز SKU', type: 'text', pattern: { regex: /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/, message: 'حروف لاتينية وأرقام وشرطات، من 1 إلى 40، ولا يبدأ بشرطة.' } },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true, maxLength: 120 },
  {
    name: 'fulfillment',
    label: 'نوع التنفيذ',
    type: 'select',
    options: ['digital', 'physical', 'signed'],
    optionLabels: { digital: 'رقمي', physical: 'ورقي', signed: 'موقّع' },
  },
  { name: 'price_halalas', label: 'السعر', type: 'money', nullable: true, nullHint: 'غير مسعّر: لا يُعرض للبيع.' },
  { name: 'enabled', label: 'معروض للبيع', type: 'boolean' },
  // Stock exists only for «ورقي» and «موقّع» (the table's own check); the
  // form requires it there and sends null for «رقمي» in `toRow`.
  { name: 'stock', label: 'المخزون', type: 'number', min: 0, visibleWhen: (values) => values.fulfillment !== 'digital' },
  { name: 'low_stock_threshold', label: 'حد التنبيه للمخزون', type: 'number', min: 0, nullable: true },
  { name: 'sort_order', label: 'الترتيب', type: 'number' },
]

export const variantsConfig: TableConfig = {
  table: 'product_variants',
  label: 'خيارات المنتج',
  read: 'staff',
  insert: true,
  listColumns: [
    { key: 'sku', label: 'رمز SKU' },
    { key: 'title', label: 'العنوان' },
    { key: 'fulfillment', label: 'النوع' },
    { key: 'price_halalas', label: 'السعر' },
    { key: 'stock', label: 'المخزون' },
    { key: 'enabled', label: 'معروض' },
  ],
  fields,
  order: [
    { column: 'sort_order', ascending: true },
    { column: 'sku', ascending: true },
  ],
  uniqueMessage: 'رمز SKU مستخدم من قبل.',
  toRow: (values) => ({
    sku: typeof values.sku === 'string' ? values.sku.trim().toUpperCase() : values.sku,
    title: values.title,
    fulfillment: values.fulfillment,
    price_halalas: values.price_halalas ?? null,
    enabled: values.enabled,
    stock: values.fulfillment === 'digital' ? null : (values.stock ?? 0),
    low_stock_threshold: values.low_stock_threshold ?? null,
    sort_order: values.sort_order,
  }),
  // A digital variant's null stock shows as 0 in the form, the number the
  // field's schema requires, and goes back to null on save.
  fromRow: (row) => ({ ...row, stock: row.stock ?? 0 }),
}
