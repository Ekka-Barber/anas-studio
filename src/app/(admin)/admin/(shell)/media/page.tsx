import type { Metadata } from 'next'

import { MediaLibrary } from '@/components/admin/MediaLibrary'

export const metadata: Metadata = { title: 'المكتبة' }

/** `/admin/media`: the media library (P05 round 2). */
export default function MediaPage() {
  return <MediaLibrary />
}
