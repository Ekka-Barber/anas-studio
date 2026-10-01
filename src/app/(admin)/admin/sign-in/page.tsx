import type { Metadata } from 'next'

import { SignIn } from '@/components/admin/SignIn'

export const metadata: Metadata = { title: 'تسجيل الدخول' }

// Renders outside the AdminShell gate: it is what an unauthenticated visitor sees.
export default function SignInPage() {
  return <SignIn />
}
