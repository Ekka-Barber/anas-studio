import type { Metadata } from 'next'

import PublicLayout from './(public)/layout'
import NotFound from './(public)/not-found'

export const metadata: Metadata = {
  title: 'الصفحة غير موجودة — أنس',
  robots: { index: false, follow: false },
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
