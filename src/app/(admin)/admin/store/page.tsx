import { AdminShell } from '@/components/admin/AdminShell'

import { StoreHome } from './StoreHome'

/** `/admin/store`: the store's tables and the policies link (P07 round 2). */
export default function StorePage() {
  return (
    <AdminShell>
      <StoreHome />
    </AdminShell>
  )
}
