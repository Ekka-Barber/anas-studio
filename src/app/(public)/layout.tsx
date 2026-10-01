import type { Metadata, Viewport } from 'next'
import type React from 'react'

import { Footer } from '@/components/site/Footer'
import { Header } from '@/components/site/Header'
import { MotionLayer } from '@/components/weave/MotionLayer'

import '@/styles/globals.css'
import '@/styles/motion.css'

export const metadata: Metadata = {
  title: { default: 'أنس عبدالله القرني', template: '%s · أنس عبدالله القرني' },
  // Pre-launch: indexing is P10's job, once SEO metadata and the launch gates
  // (E01 domain, E05 rights, E06 font licences) are addressed.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e0c6ad',
}

/**
 * Public root layout (D39, direction B «أنساق»): the sand page, the sticky
 * header, the page, the woven footer. Every page is visible without
 * JavaScript; `MotionLayer` only adds the scroll reveals.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth">
      <head>
        {/* The two faces every page's first screen is set in. */}
        <link
          rel="preload"
          href="/fonts/thmanyah/thmanyahserifdisplay-Medium.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        <link rel="preload" href="/fonts/thmanyah/thmanyahsans-Bold.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body data-tone="sand" data-surface="site">
        <a href="#main" className="skip-link">
          انتقل إلى المحتوى
        </a>
        <Header />
        {children}
        <Footer />
        <MotionLayer />
      </body>
    </html>
  )
}
