'use client'

import { usePathname } from 'next/navigation'
import { useLayoutEffect } from 'react'

import { mountReveals } from './motion'

// Pages already opened in this visit (a full load starts a new visit).
const opened = new Set<string>()

/**
 * Mounts the scroll reveals (motion.ts) for the page on screen, again after
 * each client navigation. A page opened before in the same visit comes back
 * still: `data-seen` on the root turns its entrances off (motion.css), and
 * its reveals are not mounted. It runs before paint, so an entrance never
 * starts and then stops. Renders nothing; the page is complete without it.
 */
export function MotionLayer() {
  const pathname = usePathname()
  useLayoutEffect(() => {
    const root = document.documentElement
    if (opened.has(pathname)) {
      root.dataset.seen = ''
      return
    }
    delete root.dataset.seen
    opened.add(pathname)
    return mountReveals(document.body)
  }, [pathname])
  return null
}
