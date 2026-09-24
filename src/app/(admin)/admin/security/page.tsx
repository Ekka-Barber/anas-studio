import { AdminShell } from '@/components/admin/AdminShell'
import { MfaEnroll } from '@/components/admin/MfaEnroll'

export default function SecurityPage() {
  return (
    <AdminShell>
      <MfaEnroll />
    </AdminShell>
  )
}
