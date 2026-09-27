'use client'

/**
 * The store home (P07 round 2): tiles for the catalog tables plus the
 * policies, which are content (their drafts and publishing live under
 * `/admin/content/policies`). Owner and operations only — editors see
 * nothing of the store — and coupons are owner-only even to read, so their
 * tile shows for the owner alone. D37: while any demo row exists, a line
 * says the current store data is demo data Anas edits or replaces.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import type { StaffRole } from '@/components/admin/TableList'
import styles from '@/components/admin/admin.module.css'

export function StoreHome() {
  const [role, setRole] = useState<StaffRole | null>(null)
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const { data: roleData } = await supabase.rpc('current_staff_role')
      if (!active) return
      setRole((roleData as StaffRole | null) ?? null)
      if (roleData === 'editor') return
      // Only products carry the demo flag (D37); any one means demo data.
      const { data: demoRow } = await supabase.from('products').select('id').eq('demo', true).limit(1)
      if (active) setDemo((demoRow ?? []).length > 0)
    })()
    return () => {
      active = false
    }
  }, [])

  if (role === null) return <p className={styles.message}>يحمّل...</p>
  if (role === 'editor') return <p className={styles.error}>لا تملك صلاحية الوصول</p>

  return (
    <div className={styles.field}>
      <h1>المتجر</h1>
      <div className={styles.grid}>
        <Link href="/admin/store/products" className={styles.tile}>
          المنتجات
        </Link>
        <Link href="/admin/store/shipping-rates" className={styles.tile}>
          التوصيل
        </Link>
        {role === 'owner' && (
          <Link href="/admin/store/coupons" className={styles.tile}>
            أكواد الخصم
          </Link>
        )}
        <Link href="/admin/store/customers" className={styles.tile}>
          العملاء
        </Link>
        <Link href="/admin/content/policies" className={styles.tile}>
          السياسات
        </Link>
      </div>
      {demo && (
        <p className={styles.message}>بيانات المتجر الحالية تجريبية، يحرّرها أنس أو يستبدلها قبل الافتتاح.</p>
      )}
    </div>
  )
}
