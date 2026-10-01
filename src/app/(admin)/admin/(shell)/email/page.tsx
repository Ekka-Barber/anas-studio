import type { Metadata } from 'next'

import { EmailView } from '@/components/admin/EmailView'

export const metadata: Metadata = { title: 'البريد' }

export default function EmailPage() {
  return <EmailView />
}
