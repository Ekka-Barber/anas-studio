import { riyadhToday } from '../../lib/admin-commerce'

import type { TableConfig, TableField } from './index'

/**
 * A product's variants: edited only from the product's page, so the variant
 * key is not in the store list route's `generateStaticParams`. `product_id`
 * is fixed by the page, `digital_asset` is not in the form (only
 * `paid_asset_set` writes it: the paid file is uploaded under the form, by
 * `VariantCommerce`), and `sku` is stored upper case.
 *
 * P08 round 11c: a variant is a preorder only when the owner switches it on and
 * gives its capacity, delivery date and note (the table's check); the three
 * show only while it is on, are required then, and are sent as null otherwise.
 */
const onlyPreorder = (values: Record<string, unknown>): boolean => values.preorder === true

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
  { name: 'preorder', label: 'طلب مسبق', type: 'boolean' },
  // Nullable so the stored nulls of a variant that is not a preorder load; `validate` requires them while it is one.
  { name: 'preorder_capacity', label: 'سعة الطلب المسبق', type: 'number', min: 1, nullable: true, visibleWhen: onlyPreorder },
  { name: 'preorder_ships_on', label: 'موعد التسليم', type: 'date', nullable: true, visibleWhen: onlyPreorder },
  {
    name: 'preorder_note',
    label: 'ملاحظة الطلب المسبق',
    type: 'text',
    nonBlank: true,
    maxLength: 300,
    nullable: true,
    hint: 'تظهر للمشتري قبل الدفع.',
    visibleWhen: onlyPreorder,
  },
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
  // A preorder with a delivery date that has passed is not for sale (the checkout refuses it), so the form refuses
  // to save one; it also names what is missing, which a field's own schema cannot say for a nullable field.
  validate: (values) => {
    if (!onlyPreorder(values)) return []
    const issues: Array<{ field: string; message: string }> = []
    if (typeof values.preorder_capacity !== 'number') issues.push({ field: 'preorder_capacity', message: 'أدخل رقمًا.' })
    const day = values.preorder_ships_on
    // A date cleared to an empty text is the date schema's own refusal; a null is the one this adds.
    if (typeof day !== 'string') issues.push({ field: 'preorder_ships_on', message: 'اختر يومًا.' })
    else if (day !== '' && day < riyadhToday()) {
      issues.push({ field: 'preorder_ships_on', message: 'يجب ألا يكون قبل اليوم، وإلا خرج الخيار من البيع.' })
    }
    if (typeof values.preorder_note !== 'string') issues.push({ field: 'preorder_note', message: 'لا يمكن أن يكون فارغًا.' })
    return issues
  },
  toRow: (values) => {
    const preorder = values.preorder === true
    return {
      sku: typeof values.sku === 'string' ? values.sku.trim().toUpperCase() : values.sku,
      title: values.title,
      fulfillment: values.fulfillment,
      price_halalas: values.price_halalas ?? null,
      enabled: values.enabled,
      stock: values.fulfillment === 'digital' ? null : (values.stock ?? 0),
      // The table's check: the three exist exactly while the variant is a preorder.
      preorder,
      preorder_capacity: preorder ? (values.preorder_capacity ?? null) : null,
      preorder_ships_on: preorder && typeof values.preorder_ships_on === 'string' && values.preorder_ships_on !== '' ? values.preorder_ships_on : null,
      preorder_note: preorder && typeof values.preorder_note === 'string' ? values.preorder_note.trim() : null,
      low_stock_threshold: values.low_stock_threshold ?? null,
      sort_order: values.sort_order,
    }
  },
  // A digital variant's null stock shows as 0 in the form, the number the
  // field's schema requires, and goes back to null on save.
  fromRow: (row) => ({ ...row, stock: row.stock ?? 0 }),
}
