'use client'

/**
 * The staff's orders (P08 round 11a): the alerts line, the filters, the search by
 * order number or email, and one page of 50 orders at a time, newest first. The
 * data is `orders_list` and `orders_alerts`, called under the signed-in session:
 * both recheck the role inside (owner or operations), and the screen only shapes
 * itself by it — an editor is told there is no access and nothing is asked. A
 * customer's «طلباته» link (the customers list) arrives as `#q=<email>`: it is
 * read once, taken out of the address bar, and runs that search, so an address
 * never travels in a query string.
 */
import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  alertCounts,
  BAD_QUERY,
  LOAD_FAILED,
  normalizeOrderQuery,
  ORDER_FILTERS,
  ORDER_FILTER_LABELS,
  ORDER_STATUS_LABELS,
  parseOrdersAlerts,
  parseOrdersList,
  RECONCILIATION_PATH,
  TEST_BADGE,
  type OrderFilter,
  type OrderRow,
  type OrdersAlerts,
  type OrdersPage,
} from '@/lib/admin-orders'
import { formatMoney, formatNumber, formatRiyadh } from '@/lib/format'
import { takeFragment } from '@/lib/orders'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'

/** An enum value as its Arabic label; a value the table does not know shows as its code, never blank. */
export function Enum({ labels, code }: { labels: Readonly<Record<string, string>>; code: string }) {
  return Object.hasOwn(labels, code) ? <>{labels[code]}</> : <span dir="ltr">{code}</span>
}

/** «تجريبي» on a sandbox order; a live one shows nothing. */
export function TestBadge({ environment }: { environment: string }) {
  return environment === 'test' ? <span className={styles.badge}>{TEST_BADGE}</span> : null
}

export const NONE = 'لا يوجد'

/** A code, a phone or a status of the provider: left to right and plain text, so it can be selected. */
export const ltr = (value: string | null): ReactNode => (value === null || value === '' ? NONE : <span dir="ltr">{value}</span>)

/** The same for what can be long and has no space to break at (an id, an email, a tracking number, a JSON summary): it breaks rather than push the page sideways. */
export const ltrLong = (value: string | null): ReactNode =>
  value === null || value === '' ? (
    NONE
  ) : (
    <span dir="ltr" className={styles.break}>
      {value}
    </span>
  )

/** One «label: value» line of a card's list. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      {label}: {children}
    </li>
  )
}

/** One page of the list, or null when the call or the parser failed. */
async function readPage(filter: OrderFilter, query: string, before: string | null): Promise<OrdersPage | null> {
  try {
    const { data, error } = await getSupabaseBrowserClient().rpc('orders_list', {
      p_filter: filter,
      p_query: query === '' ? null : query,
      p_before: before,
      p_limit: 50,
    })
    return error ? null : parseOrdersList(data)
  } catch {
    return null
  }
}

/** The `q` of the `#q=…` the customers list links with, or null. */
function readFragmentQuery(): string | null {
  return new URLSearchParams(takeFragment()).get('q')
}

export function OrdersView() {
  const role = useStaffRole()
  const allowed = role === 'owner' || role === 'operations'
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [text, setText] = useState('')
  // The search the list shows; null until the address has been read (a `#q=` is taken before the first page is asked).
  const [applied, setApplied] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [rows, setRows] = useState<OrderRow[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [alerts, setAlerts] = useState<OrdersAlerts | 'loading' | 'failed'>('loading')
  const [round, setRound] = useState(0)
  const [alertsRound, setAlertsRound] = useState(0)
  const ticket = useRef(0)
  // «المزيد» pressed twice must not append the same page twice.
  const moreBusy = useRef(false)

  useEffect(() => {
    if (!allowed) return
    // After a tick, like the email screen: the state is set from the address, not while the effect runs.
    void Promise.resolve().then(() => {
      const fragment = readFragmentQuery()
      const typed = fragment === null ? '' : normalizeOrderQuery(fragment)
      if (fragment !== null) {
        setText(fragment)
        setInvalid(typed === null)
      }
      // The second run of a development double mount finds the address already clean: the first run's search stays.
      setApplied((current) => current ?? typed ?? '')
    })
  }, [allowed])

  useEffect(() => {
    if (!allowed || applied === null) return
    const mine = (ticket.current += 1)
    void (async () => {
      const page = await readPage(filter, applied, null)
      // A newer search or filter has started since: this answer is for a list no one is looking at.
      if (mine !== ticket.current) return
      if (page === null) {
        setFailed(true)
        return
      }
      setRows(page.rows)
      setNext(page.next)
    })()
  }, [allowed, applied, filter, round])

  useEffect(() => {
    if (!allowed) return
    let active = true
    void (async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient().rpc('orders_alerts')
        if (active) setAlerts(error ? 'failed' : parseOrdersAlerts(data))
      } catch {
        if (active) setAlerts('failed')
      }
    })()
    return () => {
      active = false
    }
  }, [allowed, alertsRound])

  /** A new filter, a new search or a refresh: the list starts over from its first page. */
  function restart(change: { filter?: OrderFilter; applied?: string } = {}) {
    if (change.filter !== undefined) setFilter(change.filter)
    if (change.applied !== undefined) setApplied(change.applied)
    setRows(null)
    setNext(null)
    setFailed(false)
    setMoreFailed(false)
    setRound((value) => value + 1)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    const query = normalizeOrderQuery(text)
    setInvalid(query === null)
    if (query !== null) restart({ applied: query })
  }

  function clear() {
    setText('')
    setInvalid(false)
    restart({ applied: '' })
  }

  function refresh() {
    setAlerts('loading')
    setAlertsRound((value) => value + 1)
    restart()
  }

  async function more() {
    if (next === null || moreBusy.current) return
    moreBusy.current = true
    const mine = ticket.current
    setLoadingMore(true)
    setMoreFailed(false)
    const page = await readPage(filter, applied ?? '', next)
    moreBusy.current = false
    setLoadingMore(false)
    // The list was restarted while this page was on its way.
    if (mine !== ticket.current) return
    if (page === null) {
      setMoreFailed(true)
      return
    }
    setRows((current) => [...(current ?? []), ...page.rows])
    setNext(page.next)
  }

  if (!allowed) {
    return (
      <div>
        <h1>الطلبات</h1>
        <p className={styles.error}>لا تملك صلاحية الوصول</p>
      </div>
    )
  }

  const problem = failed || moreFailed ? LOAD_FAILED : invalid ? BAD_QUERY : ''

  return (
    <div>
      <h1>الطلبات</h1>
      {alerts === 'loading' && <p className={styles.message}>يحمّل...</p>}
      {alerts === 'failed' && <p className={styles.error}>{LOAD_FAILED}</p>}
      {typeof alerts === 'object' && (
        <p>
          {alertCounts(alerts, role === 'owner').map((count, index) => {
            const text = `${count.label}: ${formatNumber(count.value)}`
            return (
              <Fragment key={count.label}>
                {index > 0 && ' · '}
                {count.href === undefined ? (
                  text
                ) : (
                  <Link className={styles.target} href={count.href}>
                    {text}
                  </Link>
                )}
              </Fragment>
            )
          })}
        </p>
      )}
      {role === 'owner' && (
        <p>
          <Link className={styles.target} href={RECONCILIATION_PATH}>
            المطابقة
          </Link>
        </p>
      )}

      <div className={styles.row} role="group" aria-label="تصفية الطلبات">
        {ORDER_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === filter ? styles.button : styles.buttonSecondary}
            aria-pressed={option === filter}
            onClick={() => restart({ filter: option })}
          >
            {ORDER_FILTER_LABELS[option]}
          </button>
        ))}
      </div>

      <form className={styles.form} onSubmit={search} role="search">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="orders-query">
            بحث برقم الطلب أو البريد
          </label>
          <input
            id="orders-query"
            className={styles.input}
            type="text"
            dir="ltr"
            autoComplete="off"
            maxLength={254}
            value={text}
            aria-describedby="orders-problem"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.button}>
            بحث
          </button>
          {applied !== null && applied !== '' && (
            <button type="button" className={styles.buttonSecondary} onClick={clear}>
              مسح
            </button>
          )}
        </div>
      </form>
      {/* Always mounted, so a refusal is announced when it is filled. */}
      <p id="orders-problem" role="alert" className={styles.error}>
        {problem}
      </p>
      {(failed || alerts === 'failed') && (
        <button type="button" className={styles.buttonSecondary} onClick={refresh}>
          تحديث
        </button>
      )}

      {rows === null && !failed && <p className={styles.message}>يحمّل...</p>}
      {rows !== null && rows.length === 0 && <p className={styles.message}>لا توجد طلبات.</p>}
      {rows !== null && rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.responsive}`}>
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>الإجمالي</th>
                <th>الاسم</th>
                <th>البريد</th>
                <th>العناصر</th>
                <th>للشحن</th>
                <th>المُعاد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="رقم الطلب" className={styles.cellNowrap}>
                    <Link className={styles.target} dir="ltr" href={`/admin/orders/view?id=${row.id}`}>
                      {row.orderNumber}
                    </Link>{' '}
                    <TestBadge environment={row.environment} />
                    {row.review && <span className={styles.badge}>{ORDER_FILTER_LABELS.review}</span>}
                  </td>
                  <td data-label="التاريخ" className={styles.cellNowrap}>
                    {formatRiyadh(row.createdAt)}
                  </td>
                  <td data-label="الحالة" className={styles.cellNowrap}>
                    <Enum labels={ORDER_STATUS_LABELS} code={row.status} />
                  </td>
                  <td data-label="الإجمالي" className={styles.cellNowrap}>
                    {formatMoney(row.total)}
                  </td>
                  <td data-label="الاسم">
                    <bdi>{row.name}</bdi>
                  </td>
                  <td dir="ltr" data-label="البريد" className={styles.cellEllipsis} title={row.email}>
                    {row.email}
                  </td>
                  <td data-label="العناصر">{formatNumber(row.items)}</td>
                  <td data-label="للشحن">{formatNumber(row.toShip)}</td>
                  <td data-label="المُعاد" className={styles.cellNowrap}>
                    {row.refunded > 0 && formatMoney(row.refunded)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next !== null && (
        <button type="button" className={styles.buttonSecondary} disabled={loadingMore} onClick={() => void more()}>
          المزيد
        </button>
      )}
    </div>
  )
}
