import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// The site's base layer: brand fonts, tokens, box-sizing reset and visible
// focus, shared with the public layout.
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'لوحة أنس',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e0c6ad',
}

/**
 * Admin's own root layout (P03): plain and functional, main theme tokens
 * only, no marketing signature. The public and admin route groups each keep
 * their own root layout.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
