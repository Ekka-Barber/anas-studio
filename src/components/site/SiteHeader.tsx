'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { Edge } from '@/components/weave/Edge'
import { Mark } from '@/components/weave/Action'
import type { Tone } from '@/components/weave/tones'
import type { NavItem } from '@/lib/content'

import styles from './site.module.css'

// The menu's links are woven bands, cycling through four of B's surfaces.
const MENU_TONES: Tone[] = ['coral', 'saffron', 'paper', 'night']

function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" prefetch={false} aria-label="أنس، الرئيسية" className={`${styles.brand} ${className ?? ''}`}>
      <Mark />
      <span className={styles.brandName}>أنس</span>
      <span dir="ltr" className={styles.brandDomain}>
        anas.studio
      </span>
    </Link>
  )
}

/**
 * The sticky header: Anas's name, the rooms inline from 1024px, and below
 * that a «القائمة» button that opens the full-screen woven menu. The menu is
 * a native modal `<dialog>`: focus is trapped, Escape closes it and focus
 * returns to the button. Scrolling down tucks the header away to give the
 * text the whole screen; scrolling up, or tabbing into it, brings it back.
 */
export function SiteHeader({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // The menu is for narrow screens; widening past 1024px closes it.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const onChange = () => wide.matches && setOpen(false)
    wide.addEventListener('change', onChange)
    return () => wide.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const root = document.documentElement
    let last = window.scrollY
    let hidden = false
    let frame = 0
    const setHidden = (value: boolean) => {
      hidden = value
      header.dataset.hidden = String(value)
      root.style.setProperty('--header-offset', value ? '0px' : 'var(--header-h)')
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const y = window.scrollY
        if (dialogRef.current?.open) {
          last = y
          return
        }
        if (y > last + 6 && y > 180 && !hidden) setHidden(true)
        else if ((y < last - 6 || y < 90) && hidden) setHidden(false)
        last = y
      })
    }
    const onFocus = () => hidden && setHidden(false)
    window.addEventListener('scroll', onScroll, { passive: true })
    header.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('scroll', onScroll)
      header.removeEventListener('focusin', onFocus)
      cancelAnimationFrame(frame)
      root.style.removeProperty('--header-offset')
    }
  }, [])

  return (
    <header ref={headerRef} data-tone="sand" className={styles.header}>
      <div className={styles.bar}>
        <Brand />
        <nav aria-label="التنقل الرئيسي" className={styles.inline}>
          {items
            .filter((item) => item.href !== '/')
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={styles.link}
              >
                {isActive(item.href) && <span aria-hidden="true" className={styles.here} />}
                {item.label}
              </Link>
            ))}
        </nav>
        <button
          type="button"
          data-tone="aub"
          className={styles.menuButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Mark />
          القائمة
        </button>
      </div>

      <dialog
        ref={dialogRef}
        data-tone="aub"
        data-lock-scroll=""
        className={styles.menu}
        aria-label="قائمة التنقل"
        onClose={() => setOpen(false)}
      >
        <div className={styles.menuBar}>
          <Brand />
          <button type="button" data-tone="paper" className={styles.closeButton} onClick={() => setOpen(false)}>
            إغلاق
          </button>
        </div>
        <nav aria-label="التنقل الرئيسي" className={styles.menuNav}>
          {items.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              data-tone={MENU_TONES[i % MENU_TONES.length]}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={styles.menuLink}
              style={{ '--i': i } as CSSProperties}
              onClick={() => setOpen(false)}
            >
              <span>{item.label}</span>
              {isActive(item.href) && <span aria-hidden="true" className={styles.menuHere} />}
            </Link>
          ))}
        </nav>
        <Edge kind="weave" />
      </dialog>
    </header>
  )
}
