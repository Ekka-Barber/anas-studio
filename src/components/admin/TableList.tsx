'use client'

/**
 * One catalog table's rows (P07 round 2), in the pattern of
 * `CollectionList`: a back link, an h1, «جديد» for the owner (never for
 * customers), and the responsive card table. The data is a Data API read
 * under the caller's JWT; RLS decides what the role may see — an editor is
 * told there is no access here, and coupons are owner-only even to read.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { tables, type ListColumn, type TableConfig, type TableKey } from '@/admin/tables'
import { formatMoney, formatRiyadh } from '@/lib/format'
import { formatRiyalsInput } from '@/lib/money-input'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'

export type StaffRole = 'owner' | 'editor' | 'operations'

/** The Arabic name of each staff role, shared by the home and team screens. */
export const ROLE_LABEL: Record<StaffRole, string> = { owner: 'مالك', editor: 'محرر', operations: 'تشغيل' }

const LIST_LIMIT = 500

/** One list cell as Arabic text, from the column, the field config and the row. */
export function cellText(config: TableConfig, column: ListColumn, row: Record<string, unknown>): string {
  if (column.text) return column.text(row)
  const value = row[column.key]
  const field = config.fields.find((candidate) => candidate.name === column.key)
  // The same empty text the form shows (`nullHint`), so the two never disagree.
  if (value === null || value === undefined) return field?.type === 'money' && field.nullHint ? field.nullHint : 'لا يوجد'
  if (field?.type === 'select') return field.optionLabels?.[String(value)] ?? String(value)
  if (field?.type === 'money') {
    return field.unit === 'percent' ? `${formatRiyalsInput(value as number)}٪` : formatMoney(value as number)
  }
  if (field?.type === 'datetime' || /_at$/.test(column.key)) return formatRiyadh(String(value))
  if (typeof value === 'boolean') {
    // The catalog's own booleans are all `enabled` flags.
    return column.key === 'enabled' ? (value ? 'مفعّل' : 'موقوف') : value ? 'نعم' : 'لا'
  }
  return String(value)
}

/** The columns a list reads: the row id, the list's own columns, and the demo flag. */
export function listSelect(config: TableConfig): string {
  const keys = config.listColumns.flatMap((column) => [column.key, ...(column.extra ?? [])])
  if (config.listBadge) keys.push('demo')
  return ['id', ...keys].join(',')
}

export function TableList({ table }: { table: TableKey }) {
  const config = tables[table]
  const router = useRouter()
  const role = useStaffRole()
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (role === 'editor') return
    let active = true
    void (async () => {
      let query = getSupabaseBrowserClient().from(config.table).select(listSelect(config))
      for (const order of config.order) query = query.order(order.column, { ascending: order.ascending })
      const { data, error: loadError } = await query.limit(LIST_LIMIT)
      if (!active) return
      if (loadError) {
        setError(true)
        return
      }
      setRows(((data ?? []) as unknown) as Record<string, unknown>[])
    })()
    return () => {
      active = false
    }
  }, [config, role])

  // Editors see nothing of the store; operations cannot read coupons (RLS).
  if (role === 'editor' || (config.read === 'owner' && role !== 'owner')) {
    return <p className={styles.error}>لا تملك صلاحية الوصول</p>
  }

  return (
    <div className={styles.field}>
      <p>
        <Link href="/admin/store">المتجر</Link>
      </p>
      <h1>{config.label}</h1>
      {error && <p className={styles.error}>تعذّر تحميل القائمة.</p>}
      {role === 'owner' && config.insert && (
        <button type="button" className={styles.button} onClick={() => router.push(`/admin/store/${table}/edit?id=new`)}>
          جديد
        </button>
      )}
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.responsive}`}>
          <thead>
            <tr>
              {config.listColumns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {config.rowLink && (
                <th>
                  <span className="visually-hidden">إجراء</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => {
              const badge = config.listBadge?.(row) ?? null
              const link = config.rowLink?.(row) ?? null
              return (
                <tr key={String(row.id)}>
                  {config.listColumns.map((column, index) => (
                    <td key={column.key} data-label={column.label}>
                      {index === 0 ? (
                        <Link href={`/admin/store/${table}/edit?id=${row.id}`}>{cellText(config, column, row)}</Link>
                      ) : (
                        cellText(config, column, row)
                      )}
                      {index === 0 && badge && (
                        <>
                          {' '}
                          <span className={styles.badge}>{badge}</span>
                        </>
                      )}
                    </td>
                  ))}
                  {config.rowLink && (
                    <td data-label="إجراء">
                      {link && (
                        <Link className={styles.target} href={link.href}>
                          {link.label}
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!error && rows !== null && rows.length === 0 && <p className={styles.message}>لا توجد سجلات بعد.</p>}
      {/* ponytail: one page of 500 rows; paging when a table outgrows it. */}
      {rows !== null && rows.length === LIST_LIMIT && (
        <p className={styles.message}>تعرض القائمة أول {LIST_LIMIT} سجل.</p>
      )}
    </div>
  )
}
