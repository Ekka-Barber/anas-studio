import { normalizeSaudiMobile } from '../../../supabase/functions/_shared/saudi-mobile.ts'

import type { TableConfig, TableField } from './index'

/**
 * Customers are written by checkout (guest buyers, D08); the owner corrects
 * `name` and `phone` only, and there is no insert. `email` is read-only — an
 * order keeps its own contact snapshot, so a profile change never rewrites
 * one. A non-empty phone that `normalizeSaudiMobile` cannot read is sent as
 * typed, and the table's own check refuses it.
 */
const fields: readonly TableField[] = [
  { name: 'email', label: 'البريد الإلكتروني', type: 'text' },
  { name: 'name', label: 'الاسم', type: 'text' },
  { name: 'phone', label: 'الجوال', type: 'text', nullable: true },
]

export const customersConfig: TableConfig = {
  table: 'customers',
  label: 'العملاء',
  read: 'staff',
  insert: false,
  readOnly: ['email'],
  listColumns: [
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'name', label: 'الاسم' },
    { key: 'phone', label: 'الجوال' },
    { key: 'created_at', label: 'التسجيل' },
  ],
  fields,
  order: [{ column: 'created_at', ascending: false }],
  uniqueMessage: 'البريد الإلكتروني مستخدم من قبل.',
  toRow: (values) => ({
    name: values.name,
    phone:
      typeof values.phone === 'string' && values.phone.trim() !== ''
        ? (normalizeSaudiMobile(values.phone) ?? values.phone.trim())
        : null,
  }),
  fromRow: (row) => ({ email: row.email, name: row.name, phone: row.phone ?? null }),
}
