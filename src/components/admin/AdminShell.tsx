'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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

/** One entry of the admin's nav: where it leads and which roles see it. */
interface NavEntry {
  href: string
  label: string
  roles: readonly StaffRole[]
}

const EVERYONE: readonly StaffRole[] = ['owner', 'editor', 'operations']
const OWNER_EDITOR: readonly StaffRole[] = ['owner', 'editor']
const OWNER_OPERATIONS: readonly StaffRole[] = ['owner', 'operations']
const OWNER: readonly StaffRole[] = ['owner']

/**
 * The nav, in its order, in four groups the rail draws apart: the day's work,
 * the words and pictures, the store and its orders, and the house. The order
 * is the one every role has always had («الطلبات» right after «المتجر»); a
 * role sees only its entries, and a group with none is not drawn.
 */
const NAV: readonly (readonly NavEntry[])[] = [
  [
    { href: '/admin', label: 'الرئيسية', roles: EVERYONE },
    { href: '/admin/email', label: 'البريد', roles: OWNER_OPERATIONS },
  ],
  [
    { href: '/admin/content', label: 'المحتوى', roles: OWNER_EDITOR },
    { href: '/admin/media', label: 'المكتبة', roles: OWNER_EDITOR },
  ],
  [
    { href: '/admin/store', label: 'المتجر', roles: OWNER_OPERATIONS },
    { href: '/admin/orders', label: 'الطلبات', roles: OWNER_OPERATIONS },
  ],
  [
    { href: '/admin/stats', label: 'الإحصاءات', roles: OWNER },
    { href: '/admin/settings', label: 'الإعدادات', roles: OWNER },
    { href: '/admin/security', label: 'الأمان', roles: EVERYONE },
    { href: '/admin/team', label: 'الفريق', roles: OWNER },
  ],
]

/** The nav entry a path belongs to: the home only by itself, every other entry with the screens under it. */
export function currentEntry(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/admin') return '/admin'
  for (const group of NAV) {
    for (const entry of group) {
      if (entry.href !== '/admin' && (path === entry.href || path.startsWith(`${entry.href}/`))) return entry.href
    }
  }
  return null
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
  const pathname = usePathname()
  const wide = isWidePath(pathname)
  const current = currentEntry(pathname)
  const [gate, setGate] = useState<Gate>({ status: 'checking' })
  const navRef = useRef<HTMLElement>(null)
  const ready = gate.status === 'ready'
  const navRole = gate.status === 'ready' ? gate.role : null

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

  // On a phone the nav is a strip that scrolls sideways (on a wide screen it is
  // the rail's column and nothing here moves): it fades at an end with more
  // controls past it. The strip's first and last controls are watched as they
  // cross its edges, never on every scroll frame.
  useEffect(() => {
    const nav = navRef.current
    const controls = nav?.querySelectorAll<HTMLElement>('a, button')
    const first = controls?.[0]
    const last = controls?.[controls.length - 1]
    if (!nav || !first || !last) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Only a strip that scrolls has ends to fade: the rail's column does not (its current tab overhangs on purpose).
        const strip = getComputedStyle(nav).overflowX !== 'visible'
        for (const entry of entries) {
          const cut = strip && entry.intersectionRatio < 0.99
          if (entry.target === first) nav.toggleAttribute('data-more-start', cut)
          if (entry.target === last) nav.toggleAttribute('data-more-end', cut)
        }
      },
      { root: nav, threshold: [0.99] },
    )
    observer.observe(first)
    observer.observe(last)
    return () => observer.disconnect()
  }, [ready])

  // The strip keeps whole, clear of its fades, the current page's link (on a
  // route change, when a new role gives the strip other links, once the web
  // font has changed the links' widths, and when the strip changes size, the
  // rail turning into it included) and any control the keyboard focuses in it:
  // the browser leaves a focused control that is partly in view where it is. A
  // press is left alone: it focuses its link on the way down, and a strip moved
  // under the pointer would end the press, and the click, on another link. Only
  // the strip scrolls, never the page, and at once (a state change, not a motion).
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const show = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || getComputedStyle(nav).overflowX === 'visible' || nav.scrollWidth <= nav.clientWidth) return
      const strip = nav.getBoundingClientRect()
      const box = target.getBoundingClientRect()
      const room = 48 // clear of the 40px fade
      const delta = box.left < strip.left + room ? box.left - strip.left - room : box.right > strip.right - room ? box.right - strip.right + room : 0
      if (delta !== 0) nav.scrollBy({ left: delta })
    }
    const showCurrent = () => show(nav.querySelector('[aria-current="page"]'))
    const showFocused = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) show(event.target)
    }
    let live = true
    showCurrent()
    void document.fonts.ready.then(() => {
      if (live) showCurrent()
    })
    const sizes = new ResizeObserver(showCurrent)
    sizes.observe(nav)
    nav.addEventListener('focusin', showFocused)
    return () => {
      live = false
      sizes.disconnect()
      nav.removeEventListener('focusin', showFocused)
    }
  }, [current, navRole])

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

  const role = gate.role
  const groups = NAV.map((group) => group.filter((entry) => entry.roles.includes(role))).filter((group) => group.length > 0)
  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        انتقل إلى المحتوى
      </a>
      {/* The rail (a bar on a phone): the house's mark, then the nav. Its inner edge is the palm weave. */}
      <header className={styles.rail} data-tone="night">
        <div className={styles.railInner}>
          <p className={styles.brand}>
            <span aria-hidden="true" className={styles.mark} />
            <span className={styles.brandName}>أنس</span>
            <span dir="ltr" className={styles.brandDomain}>
              anas.studio
            </span>
          </p>
          <nav ref={navRef} className={styles.nav} aria-label="لوحة التحكم">
            {groups.map((group) => (
              <div key={group[0]!.href} className={styles.navGroup}>
                {group.map((entry) => (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className={styles.navLink}
                    aria-current={entry.href === current ? 'page' : undefined}
                  >
                    {entry.label}
                  </Link>
                ))}
              </div>
            ))}
            <button type="button" className={styles.signOut} onClick={signOut}>
              تسجيل الخروج
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className={wide ? `${styles.page} ${styles.pageWide}` : styles.page}>
        <RoleContext.Provider value={gate.role}>{children}</RoleContext.Provider>
      </main>
    </div>
  )
}
