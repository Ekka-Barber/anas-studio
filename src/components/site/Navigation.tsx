'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import type { NavItem } from '@/lib/content'

import styles from './site.module.css'

/**
 * Desktop inline row plus a dialog-based mobile menu. `<dialog>` gives us a
 * native focus trap, Escape-to-close and focus return to the invoking button
 * for free — no hand-built trap.
 */
export function Navigation({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function isActive(href: string) {
    return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <>
      <nav className={styles.navDesktop} aria-label="التنقل الرئيسي">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={isActive(item.href) ? styles.navLinkActive : styles.navLink}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        className={styles.menuButton}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        القائمة
      </button>

      <dialog
        ref={dialogRef}
        className={styles.menuDialog}
        aria-label="قائمة التنقل"
        onClose={() => setOpen(false)}
      >
        <div className={styles.menuInner}>
          <div className={styles.menuTop}>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="إغلاق القائمة"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <nav className={styles.navMobile} aria-label="التنقل الرئيسي">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={isActive(item.href) ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </dialog>
    </>
  )
}
