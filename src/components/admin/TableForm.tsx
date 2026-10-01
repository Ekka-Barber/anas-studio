'use client'

/**
 * One catalog row's form (P07 round 2), in the pattern of `CollectionForm`:
 * a back link, an h1, the fields from the table config, a save button for
 * the owner — and no delete button anywhere, because orders reference rows:
 * a product is retired with `status = archived`, everything else with
 * `enabled = false`.
 *
 * A save is a Data API write under the caller's JWT. An update carries
 * `.eq('version', <read>)` — the catalog's touch trigger bumps it — so a row
 * another session changed first updates zero rows: the form says so, keeps
 * the typed values, and the owner reloads. Read-only viewers (operations)
 * see the values without inputs; editors are told there is no access.
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { schemaFromFields } from '@/admin/fields'
import { tables, type TableField, type TableKey } from '@/admin/tables'
import { formatRiyadh } from '@/lib/format'
import { formatRiyalsInput } from '@/lib/money-input'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { defaultsForFields, FieldInput } from './FieldInput'
import { useStaffRole } from './AdminShell'
import { cellText } from './TableList'
import styles from './admin.module.css'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const CONFLICT_MESSAGE = 'تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.'
const CHECK_MESSAGE = 'تحقق من القيم.'
const COVER_MESSAGE = 'صورة الغلاف لم تعد في المكتبة؛ اختر صورة أخرى.'
const NO_ACCESS_MESSAGE = 'لا تملك صلاحية الوصول'

interface ProductOption {
  id: string
  title: string
  status: string
}

/** The coupon's product scope: none checked means every product. */
function ProductIdsField({
  products,
  selected,
  onChange,
  id,
  failed,
}: {
  products: ProductOption[]
  selected: string[]
  onChange: (value: string[]) => void
  id: string
  failed: boolean
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>المنتجات المشمولة</legend>
      <p className={styles.message}>لا اختيار يعني كل المنتجات.</p>
      {/* A failed load must not read as an empty list: no choice would then look like «كل المنتجات». */}
      {failed && (
        <p role="alert" className={styles.error}>
          تعذّر تحميل المنتجات.
        </p>
      )}
      {!failed && products.length === 0 && <p className={styles.message}>لا توجد منتجات بعد.</p>}
      {/* An archived product is offered only while this coupon still names it. */}
      {products
        .filter((product) => product.status !== 'archived' || selected.includes(product.id))
        .map((product) => (
        <div key={product.id} className={styles.row}>
          <input
            id={`${id}-${product.id}`}
            type="checkbox"
            checked={selected.includes(product.id)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...selected, product.id] : selected.filter((candidate) => candidate !== product.id),
              )
            }
          />
          <label htmlFor={`${id}-${product.id}`}>{product.title}</label>
        </div>
      ))}
    </fieldset>
  )
}

/** A field's value as plain Arabic text, for read-only fields and viewers. */
function readOnlyText(field: TableField, value: unknown): string {
  if (value === null || value === undefined) return field.type === 'money' && field.nullHint ? field.nullHint : 'لا يوجد'
  if (field.type === 'select') return field.optionLabels?.[String(value)] ?? String(value)
  if (field.type === 'money') {
    return field.unit === 'percent' ? `${formatRiyalsInput(value as number)}٪` : `${formatRiyalsInput(value as number)} ر.س`
  }
  if (field.type === 'boolean') return value ? 'نعم' : 'لا'
  if (field.type === 'datetime') return formatRiyadh(String(value))
  return String(value)
}

export function TableForm({ table }: { table: TableKey }) {
  const config = tables[table]
  const params = useSearchParams()
  const idParam = params.get('id') ?? ''
  const productParam = params.get('product') ?? ''

  const role = useStaffRole()
  const [values, setValues] = useState<Record<string, unknown> | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [variants, setVariants] = useState<Record<string, unknown>[] | null>(null)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [variantsError, setVariantsError] = useState(false)
  const [productsError, setProductsError] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()

      const isNew = idParam === 'new'
      if (isNew) {
        // A table without an insert (customers) has no «new» page.
        if (!config.insert) {
          setNotFound(true)
          return
        }
        if (table === 'variants') {
          if (!UUID_PATTERN.test(productParam)) {
            setNotFound(true)
            return
          }
          setProductId(productParam)
        }
        setValues(defaultsForFields(config.fields))
        setRowId(null)
        setVersion(null)
        return
      }
      if (!UUID_PATTERN.test(idParam)) {
        setNotFound(true)
        return
      }
      const { data: row, error } = await supabase.from(config.table).select('*').eq('id', idParam).maybeSingle()
      if (!active) return
      if (error || !row) {
        setLoadError(true)
        return
      }
      setValues(config.fromRow ? config.fromRow(row as Record<string, unknown>) : (row as Record<string, unknown>))
      setRowId(idParam)
      setVersion(typeof row.version === 'number' ? row.version : null)
      if (table === 'variants') setProductId(typeof row.product_id === 'string' ? row.product_id : null)
    })()
    return () => {
      active = false
    }
  }, [config, idParam, productParam, table])

  // A product's page lists its variants below the form; a coupon's form
  // offers the products as checkboxes.
  useEffect(() => {
    if (role === 'editor') return
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      if (table === 'products' && rowId) {
        let query = supabase.from('product_variants').select('*').eq('product_id', rowId)
        for (const order of tables.variants.order) query = query.order(order.column, { ascending: order.ascending })
        const { data, error } = await query
        if (!active) return
        // On a failure `variants` stays null, so «لا توجد خيارات بعد.» is not claimed.
        if (error) setVariantsError(true)
        else setVariants((data as Record<string, unknown>[]) ?? [])
      }
      if (table === 'coupons') {
        const { data, error } = await supabase.from('products').select('id,title,status').order('sort_order').order('title')
        if (!active) return
        if (error) setProductsError(true)
        else setProducts((data as ProductOption[]) ?? [])
      }
    })()
    return () => {
      active = false
    }
  }, [role, table, rowId])

  async function save() {
    if (!values) return
    setSaving(true)
    setMessage(null)
    const supabase = getSupabaseBrowserClient()
    const payload = config.toRow(values)
    let savedRows: Array<{ id: string; version: number }> = []
    let failure: { code?: string } | null = null
    if (rowId === null) {
      const insertPayload =
        table === 'variants' && productId ? { ...payload, product_id: productId } : payload
      const { data, error } = await supabase.from(config.table).insert(insertPayload).select('id, version')
      if (error) failure = error
      else savedRows = (data as Array<{ id: string; version: number }>) ?? []
    } else {
      const { data, error } = await supabase
        .from(config.table)
        .update(payload)
        .eq('id', rowId)
        .eq('version', version ?? 0)
        .select('id, version')
      if (error) failure = error
      else savedRows = (data as Array<{ id: string; version: number }>) ?? []
    }
    setSaving(false)

    if (failure) {
      if (failure.code === '23505') setMessage(config.uniqueMessage)
      else if (failure.code === '23514') setMessage(CHECK_MESSAGE)
      else if (failure.code === '23503' && table === 'products') setMessage(COVER_MESSAGE)
      else setMessage('تعذّر الحفظ.')
      return
    }
    if (savedRows.length === 0) {
      // Another session changed the row first, or RLS filtered the update out
      // because the caller is no longer the owner; the typed values stay.
      const { data: current, error: roleError } = await supabase.rpc('current_staff_role')
      setMessage(!roleError && current !== 'owner' ? NO_ACCESS_MESSAGE : CONFLICT_MESSAGE)
      return
    }
    const saved = savedRows[0]!
    setRowId(saved.id)
    setVersion(saved.version)
    if (idParam !== saved.id) {
      const search = table === 'variants' && productId ? `?id=${saved.id}&product=${productId}` : `?id=${saved.id}`
      window.history.replaceState(null, '', `/admin/store/${table}/edit${search}`)
    }
    setMessage('تم الحفظ.')
  }

  // Mirrors TableList: editors see nothing of the store, operations cannot read coupons (RLS).
  if (role === 'editor' || (config.read === 'owner' && role !== 'owner')) {
    return <p className={styles.error}>{NO_ACCESS_MESSAGE}</p>
  }
  if (notFound) return <p className={styles.error}>السجل غير موجود.</p>
  if (loadError) return <p className={styles.error}>تعذّر تحميل السجل.</p>
  if (!values) return <p className={styles.message}>يحمّل...</p>

  const owner = role === 'owner'
  const visibleFields = config.fields.filter((field) => field.visibleWhen?.(values) ?? true)
  // Only what the form shows is checked: a hidden field's stale value is not sent (`toRow`).
  const schema = schemaFromFields(visibleFields)
  const parsed = schema.safeParse(values)
  const fieldLabel = (name: PropertyKey | undefined) => config.fields.find((field) => field.name === name)?.label
  const problems = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({ label: fieldLabel(issue.path[0]) ?? issue.path.join('.'), message: issue.message }))),
    // What a field's own schema cannot state (the customer's phone spellings).
    ...(config.validate?.(values) ?? []).map((issue) => ({ label: fieldLabel(issue.field) ?? issue.field, message: issue.message })),
  ]
  // The record's own name: a product or variant title, a city, a code or a customer.
  const named = [values.title, values.name_ar, values.code, values.name].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate !== '',
  )
  const title = named ?? config.label
  const backHref =
    table === 'variants' && productId
      ? `/admin/store/products/edit?id=${productId}`
      : `/admin/store/${table}`
  const backLabel = table === 'variants' ? 'المنتج' : config.label

  return (
    <div className={styles.field}>
      <p>
        <Link href={backHref}>{backLabel}</Link>
      </p>
      <h1>{title}</h1>

      <div className={styles.field}>
        {visibleFields.map((field) => {
          const readOnly = !owner || (config.readOnly?.includes(field.name) ?? false)
          const value = values[field.name]
          if (field.type === 'richtext') {
            // A rich-text body has no read-only rendering here; the editor
            // writes it and viewers see it on the public page.
            return owner ? (
              <FieldInput
                key={field.name}
                field={field}
                value={value}
                onChange={(next) => setValues((prev) => ({ ...(prev ?? {}), [field.name]: next }))}
                id={`${table}-${field.name}`}
              />
            ) : null
          }
          if (readOnly) {
            return (
              <div className={styles.field} key={field.name}>
                <span className={styles.label}>{field.label}</span>
                <p className={styles.message}>
                  <span dir={field.type === 'text' || field.type === 'slug' ? 'auto' : undefined}>{readOnlyText(field, value)}</span>
                </p>
              </div>
            )
          }
          if (field.type === 'relation') {
            const selected = Array.isArray(value) ? (value as string[]) : []
            return (
              <ProductIdsField
                key={field.name}
                products={products}
                selected={selected}
                onChange={(next) => setValues((prev) => ({ ...(prev ?? {}), [field.name]: next }))}
                id={`${table}-${field.name}`}
                failed={productsError}
              />
            )
          }
          return (
            <FieldInput
              key={field.name}
              field={field}
              value={value}
              onChange={(next) => setValues((prev) => ({ ...(prev ?? {}), [field.name]: next }))}
              id={`${table}-${field.name}`}
            />
          )
        })}
      </div>

      {/* Always mounted, so the reasons are announced as they appear and change. */}
      {owner && (
        <div id="table-form-problems" role="status" tabIndex={-1}>
          {problems.length > 0 && (
            <>
              <p className={styles.error}>هناك مشاكل في البيانات:</p>
              <ul>
                {problems.map((problem, index) => (
                  <li key={index} className={styles.error}>
                    {problem.label}: {problem.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {owner && (
        <div className={styles.row}>
          {/* No drafts here: a save is live, so it waits for valid values. While the
              values are invalid the button is aria-disabled, not disabled: a keyboard
              can still reach it, and pressing it moves focus to the reasons. */}
          <button
            type="button"
            className={styles.button}
            disabled={saving}
            aria-disabled={problems.length > 0 || undefined}
            aria-describedby={problems.length > 0 ? 'table-form-problems' : undefined}
            onClick={() => {
              if (problems.length > 0) {
                document.getElementById('table-form-problems')?.focus()
                return
              }
              void save()
            }}
          >
            حفظ
          </button>
          <p role="status" className={styles.message}>
            {message}
          </p>
        </div>
      )}
      {!owner && message === null && <p className={styles.message}>هذه الصفحة للقراءة فقط.</p>}

      {table === 'products' && rowId !== null && (
        <div className={styles.field}>
          <h2>الخيارات</h2>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.responsive}`}>
              <thead>
                <tr>
                  {tables.variants.listColumns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(variants ?? []).map((variant) => (
                  <tr key={String(variant.id)}>
                    {tables.variants.listColumns.map((column, index) => (
                      <td key={column.key} data-label={column.label}>
                        {index === 0 ? (
                          <Link href={`/admin/store/variants/edit?id=${variant.id}`}>{cellText(tables.variants, column, variant)}</Link>
                        ) : (
                          cellText(tables.variants, column, variant)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {variantsError && (
            <p role="alert" className={styles.error}>
              تعذّر تحميل الخيارات.
            </p>
          )}
          {variants !== null && variants.length === 0 && <p className={styles.message}>لا توجد خيارات بعد.</p>}
          {owner && (
            <Link className={styles.buttonSecondary} href={`/admin/store/variants/edit?id=new&product=${rowId}`}>
              إضافة خيار
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
