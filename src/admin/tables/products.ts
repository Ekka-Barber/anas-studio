import type { TableConfig, TableField } from './index'

/** The catalog's products: granted columns are exactly `toRow`'s output. */
const fields: readonly TableField[] = [
  {
    name: 'slug',
    label: 'المعرّف',
    type: 'slug',
    pattern: { regex: /^[a-z0-9][a-z0-9-]{0,79}$/, message: 'حروف لاتينية صغيرة وأرقام وشرطات، حتى 80، ولا يبدأ بشرطة.' },
  },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true, maxLength: 200 },
  { name: 'summary', label: 'الملخص', type: 'textarea', maxLength: 500 },
  { name: 'body', label: 'الوصف', type: 'richtext' },
  { name: 'cover_image', label: 'صورة الغلاف', type: 'image', nullable: true },
  {
    name: 'status',
    label: 'الحالة',
    type: 'select',
    options: ['draft', 'published', 'archived'],
    optionLabels: { draft: 'مسودة', published: 'منشور', archived: 'مؤرشف' },
  },
  { name: 'sort_order', label: 'الترتيب', type: 'number' },
]

export const productsConfig: TableConfig = {
  table: 'products',
  label: 'المنتجات',
  read: 'staff',
  insert: true,
  listColumns: [
    { key: 'title', label: 'العنوان' },
    { key: 'slug', label: 'المعرّف' },
    { key: 'status', label: 'الحالة' },
    { key: 'sort_order', label: 'الترتيب' },
    { key: 'updated_at', label: 'آخر تغيير' },
  ],
  fields,
  order: [
    { column: 'sort_order', ascending: true },
    { column: 'title', ascending: true },
  ],
  uniqueMessage: 'المعرّف مستخدم من قبل.',
  toRow: (values) => ({
    slug: values.slug,
    title: values.title,
    summary: values.summary,
    body: values.body,
    cover_image: values.cover_image ?? null,
    status: values.status,
    sort_order: values.sort_order,
  }),
  // D37: demo rows carry «تجريبي» so Anas sees what he must replace.
  listBadge: (row) => (row.demo === true ? 'تجريبي' : null),
}
