import type { Metadata, Viewport } from 'next'
import type React from 'react'

import { Footer } from '@/components/site/Footer'
import { Header } from '@/components/site/Header'
import { MotionPreference } from '@/components/site/MotionPreference'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'أنس',
  // Pre-launch: indexing is P10's job, once SEO metadata and the launch gates
  // (E01 domain, E05 rights, E06 font licences) are addressed. Not a P01 call.
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
 * Header/Footer/MotionPreference are the frozen site chrome (P01), transcribed
 * from `deploy/design/` into semantic React — never imported from there.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <MotionPreference />
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  )
}
