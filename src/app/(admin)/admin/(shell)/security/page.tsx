import type { Metadata } from 'next'

import { MfaEnroll } from '@/components/admin/MfaEnroll'

export const metadata: Metadata = { title: 'الأمان' }

export default function SecurityPage() {
  return <MfaEnroll />
}
