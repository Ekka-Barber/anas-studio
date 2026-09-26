'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'

type StaffRole = 'owner' | 'editor' | 'operations'
type Gate =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'no-role' }
  | { status: 'ready'; role: StaffRole }

/**
 * Gates the admin UI on the session and `current_staff_role()`. RLS and the
 * Edge Function checks are the real enforcement (P03); this only shapes the
 * screen. The sign-in page renders outside this gate.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [gate, setGate] = useState<Gate>({ status: 'checking' })

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let active = true

    async function evaluate(session: Session | null) {
      if (!session) {
        if (active) setGate({ status: 'signed-out' })
        router.replace('/admin/sign-in')
        return
      }
      const { data, error } = await supabase.rpc('current_staff_role')
      if (!active) return
      if (error || !data) {
        setGate({ status: 'no-role' })
        return
      }
      setGate({ status: 'ready', role: data as StaffRole })
    }

    supabase.auth.getSession().then(({ data }) => evaluate(data.session))
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      evaluate(session)
    })
    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [router])

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut()
    router.replace('/admin/sign-in')
  }

  if (gate.status === 'checking' || gate.status === 'signed-out') return null

  if (gate.status === 'no-role') {
    return (
      <div className={styles.shell}>
        <div className={styles.gate}>
          <p>لا تملك صلاحية الوصول</p>
          <button type="button" className={styles.buttonSecondary} onClick={signOut}>
            تسجيل الخروج
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <Link href="/admin">الرئيسية</Link>
        {(gate.role === 'owner' || gate.role === 'editor') && <Link href="/admin/content">المحتوى</Link>}
        {(gate.role === 'owner' || gate.role === 'editor') && <Link href="/admin/media">المكتبة</Link>}
        <Link href="/admin/security">الأمان</Link>
        {gate.role === 'owner' && <Link href="/admin/team">الفريق</Link>}
        <button type="button" className={styles.buttonSecondary} onClick={signOut}>
          تسجيل الخروج
        </button>
      </nav>
      <div className={styles.page}>{children}</div>
    </div>
  )
}
