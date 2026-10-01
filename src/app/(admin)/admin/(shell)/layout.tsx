import type { ReactNode } from 'react'

import { AdminShell } from '@/components/admin/AdminShell'

/**
 * One shell for every signed-in admin screen: the nav, the session gate and
 * the role are resolved once and survive navigation. The sign-in page and the
 * full-width preview sit beside this group, outside the gate.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
