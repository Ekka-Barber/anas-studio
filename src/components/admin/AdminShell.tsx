'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { forgetStoredSession, getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'
import type { StaffRole } from './TableList'

type Gate =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'no-role' }
  | { status: 'error' }
  | { status: 'ready'; role: StaffRole }

/** The role the shell resolved, for the screens inside it: they render only
 * once it is known, so none of them asks `current_staff_role()` again. */
const RoleContext = createContext<StaffRole | null>(null)

export function useStaffRole(): StaffRole {
  const role = useContext(RoleContext)
  if (role === null) throw new Error('useStaffRole needs an AdminShell above it.')
  return role
}

/** The screens whose tables do not fit the reading measure (the email
 * problems, the team, each store table's list, the orders and an order's
 * view): the shell is one layout for every page, so the width is read from the
 * path, not passed by the page. */
export function isWidePath(pathname: string): boolean {
  return /^\/admin\/(?:email|team|orders(?:\/view)?|store\/[^/]+)\/?$/.test(pathname)
}

/** The editor's unsaved drafts (`draftKey` in CollectionForm). They hold a
 * person's work, so they do not outlive the person's session. */
const DRAFT_PREFIX = 'anasaq:draft:'

export function hasDrafts(): boolean {
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith(DRAFT_PREFIX))
  } catch {
    return false
  }
}

export function clearDrafts(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(DRAFT_PREFIX)) window.localStorage.removeItem(key)
    }
  } catch {
    // Storage is unavailable: there is nothing stored to clear.
  }
}

/**
 * Gates the admin UI on the session and `current_staff_role()`. RLS and the
 * Edge Function checks are the real enforcement (P03); this only shapes the
 * screen. It is mounted once, by the layout of every signed-in admin screen
 * (`(shell)/layout.tsx`), so moving between screens keeps the nav, the focus
 * and the session state and asks for the role once. The sign-in page and the
 * full-width preview render outside it. Contact messages have no screen here:
 * they reach the owner's own mailbox (D31).
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const wide = isWidePath(usePathname())
  const [gate, setGate] = useState<Gate>({ status: 'checking' })

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let active = true
    let userId: string | null = null

    async function evaluate(session: Session | null) {
      if (!session) {
        if (active) setGate({ status: 'signed-out' })
        router.replace('/admin/sign-in')
        return
      }
      // Another person signed in under this tab: the last one's drafts go.
      if (userId !== null && userId !== session.user.id) clearDrafts()
      userId = session.user.id
      const { data, error } = await supabase.rpc('current_staff_role')
      if (!active) return
      if (error) {
        // A failed call says nothing about the role. An open screen stays as it
        // is: auth-js re-emits SIGNED_IN on every tab refocus, possibly before
        // the network is back, and the children hold unsaved work.
        setGate((prev) => (prev.status === 'ready' ? prev : { status: 'error' }))
        return
      }
      if (!data) {
        setGate({ status: 'no-role' })
        return
      }
      setGate({ status: 'ready', role: data as StaffRole })
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      // A failed read (an expired token whose refresh could not reach the
      // network) is not a sign-out: the refresh token is still stored, and
      // redirecting would cost a new emailed code.
      if (error) {
        setGate((prev) => (prev.status === 'ready' ? prev : { status: 'error' }))
        return
      }
      void evaluate(data.session)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // The session read above is this mount's one initial read; auth-js also
      // emits INITIAL_SESSION to a new subscriber, with a null session after a
      // failed refresh, which would read as a sign-out here.
      if (event === 'INITIAL_SESSION') return
      void evaluate(session)
    })
    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [router])

  async function signOut() {
    // Unsaved local copies go with the session: say so before they are lost.
    if (hasDrafts() && !window.confirm('لديك تعديلات غير محفوظة على هذا الجهاز، وتسجيل الخروج يحذفها. هل تريد الخروج؟')) return
    clearDrafts()
    const auth = getSupabaseBrowserClient().auth
    const { error } = await auth.signOut()
    if (error) {
      // A failed sign-out can leave the session stored (an expired token whose
      // refresh cannot reach Auth), and a local-scope one fails the same way,
      // so the stored copy goes first; the local sign-out then clears the rest
      // and tells the other tabs.
      forgetStoredSession()
      await auth.signOut({ scope: 'local' })
    }
    router.replace('/admin/sign-in')
  }

  if (gate.status === 'checking' || gate.status === 'signed-out') return null

  if (gate.status === 'no-role' || gate.status === 'error') {
    return (
      <div className={styles.shell}>
        <div className={styles.gate}>
          <p>{gate.status === 'error' ? 'تعذّر التحقق من صلاحيتك. أعد تحميل الصفحة.' : 'لا تملك صلاحية الوصول'}</p>
          <button type="button" className={styles.buttonSecondary} onClick={signOut}>
            تسجيل الخروج
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        انتقل إلى المحتوى
      </a>
      <nav className={styles.nav} aria-label="لوحة التحكم">
        <Link href="/admin">الرئيسية</Link>
        {(gate.role === 'owner' || gate.role === 'operations') && <Link href="/admin/email">البريد</Link>}
        {(gate.role === 'owner' || gate.role === 'editor') && <Link href="/admin/content">المحتوى</Link>}
        {(gate.role === 'owner' || gate.role === 'editor') && <Link href="/admin/media">المكتبة</Link>}
        {(gate.role === 'owner' || gate.role === 'operations') && <Link href="/admin/store">المتجر</Link>}
        {(gate.role === 'owner' || gate.role === 'operations') && <Link href="/admin/orders">الطلبات</Link>}
        {gate.role === 'owner' && <Link href="/admin/stats">الإحصاءات</Link>}
        {gate.role === 'owner' && <Link href="/admin/settings">الإعدادات</Link>}
        <Link href="/admin/security">الأمان</Link>
        {gate.role === 'owner' && <Link href="/admin/team">الفريق</Link>}
        <button type="button" className={styles.buttonSecondary} onClick={signOut}>
          تسجيل الخروج
        </button>
      </nav>
      <main id="main" className={wide ? `${styles.page} ${styles.pageWide}` : styles.page}>
        <RoleContext.Provider value={gate.role}>{children}</RoleContext.Provider>
      </main>
    </div>
  )
}
