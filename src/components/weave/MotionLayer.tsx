'use client'

import { usePathname } from 'next/navigation'
import { useLayoutEffect } from 'react'

import { mountReveals } from './motion'

// Pages already opened in this visit (a full load starts a new visit), and
// the page on screen with what was decided for it: a second run for the same
// page (React's development double run, a remount) keeps that decision.
const opened = new Set<string>()
let current: { path: string; returning: boolean } | null = null

// The money and policy pages stay still apart from their title's short fade
// (the owner, 2026-09-28: serious pages look official, no show). The order
// page and the notification links are P08's money pages.
const CALM = ['/cart', '/checkout', '/policies', '/orders', '/notify']
const isCalm = (path: string) => CALM.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))

/**
 * Mounts the scroll reveals (motion.ts) for the page on screen, again after
 * each client navigation. A page opened before in the same visit comes back
 * without its page-open entrances (`data-seen` on the root, motion.css), but
 * its scroll reveals still play below the fold. It runs before paint, so an
 * entrance never starts and then stops. Renders nothing; the page is
 * complete without it.
 */
export function MotionLayer() {
  const pathname = usePathname()
  useLayoutEffect(() => {
    const root = document.documentElement
    const returning = current?.path === pathname ? current.returning : opened.has(pathname)
    current = { path: pathname, returning }
    opened.add(pathname)
    if (returning) root.dataset.seen = ''
    else delete root.dataset.seen
    if (isCalm(pathname)) return
    return mountReveals(document.body)
  }, [pathname])
  return null
}
