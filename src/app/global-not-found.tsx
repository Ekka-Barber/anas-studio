import type { Metadata, Viewport } from 'next'

import PublicLayout from './(public)/layout'
import NotFound from './(public)/not-found'

export const metadata: Metadata = {
  title: 'هذا الطريق لم يُبنَ بعد · أنس عبدالله القرني',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e0c6ad',
}

/**
 * 404 for unmatched URLs (I27). Every route group has its own root layout, so
 * Next renders this file outside all of them; it reuses the public layout and
 * the public not-found page rather than a second copy of either.
 */
export default function GlobalNotFound() {
  return (
    <PublicLayout>
      <NotFound />
    </PublicLayout>
  )
}
