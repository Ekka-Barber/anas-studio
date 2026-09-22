import type { Metadata, Viewport } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'أنس',
  // The spike must not be indexed: it carries no approved public content.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * Public root layout. It is a separate root layout from `(payload)/layout.tsx`
 * on purpose: Payload's `RootLayout` emits its own `<html>`, so there must be no
 * `src/app/layout.tsx` wrapping it.
 *
 * P00 keeps this to the language and direction contract only. The frozen design
 * — typography, tokens, the eight room compositions — is P01's work and nothing
 * here is copied from `deploy/design/`.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
