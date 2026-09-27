import type { TableConfig, TableField } from './index'

/**
 * City shipping rates (D09): an enabled rate with a configured fee serves
 * its city; a null fee means «غير مسعّر: لا نوصل إليها», never free
 * delivery. A fee of 0 is allowed, so the money field carries `min: 0`.
 */
const fields: readonly TableField[] = [
  { name: 'city_key', label: 'المعرّف', type: 'slug' },
  { name: 'name_ar', label: 'اسم المدينة', type: 'text' },
  { name: 'fee_halalas', label: 'رسوم التوصيل', type: 'money', min: 0, nullable: true, nullHint: 'غير مسعّر: لا نوصل إليها.' },
  { name: 'enabled', label: 'مفعّلة', type: 'boolean' },
  { name: 'sort_order', label: 'الترتيب', type: 'number' },
]

export const shippingRatesConfig: TableConfig = {
  table: 'shipping_rates',
  label: 'التوصيل',
  read: 'staff',
  insert: true,
  listColumns: [
    { key: 'name_ar', label: 'المدينة' },
    { key: 'city_key', label: 'المعرّف' },
    { key: 'fee_halalas', label: 'الرسوم', nullText: 'غير مسعّر: لا نوصل إليها.' },
    { key: 'enabled', label: 'مفعّلة' },
    { key: 'sort_order', label: 'الترتيب' },
  ],
  fields,
  order: [
    { column: 'sort_order', ascending: true },
    { column: 'name_ar', ascending: true },
  ],
  uniqueMessage: 'المعرّف مستخدم من قبل.',
  toRow: (values) => ({
    city_key: values.city_key,
    name_ar: values.name_ar,
    fee_halalas: values.fee_halalas ?? null,
    enabled: values.enabled,
    sort_order: values.sort_order,
  }),
}
