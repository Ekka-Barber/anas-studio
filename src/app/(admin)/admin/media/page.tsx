import { AdminShell } from '@/components/admin/AdminShell'
import { MediaLibrary } from '@/components/admin/MediaLibrary'

/** `/admin/media`: the media library (P05 round 2). */
export default function MediaPage() {
  return (
    <AdminShell>
      <MediaLibrary />
    </AdminShell>
  )
}
