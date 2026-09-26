import { Suspense } from 'react'

import { RoomPreview } from '@/components/admin/RoomPreview'

/**
 * `/admin/preview?id=<room>`: a room's latest draft, rendered with the public
 * view (D32). Full width and without the admin chrome, so it looks like the
 * page will; the data is read under RLS, so only staff see anything.
 */
export default function PreviewPage() {
  return (
    <Suspense>
      <RoomPreview />
    </Suspense>
  )
}
