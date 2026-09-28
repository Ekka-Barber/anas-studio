import type { Metadata } from 'next'

import { ShelfRoomView } from '@/components/public/rooms/ShelfRoomView'
import { getShelfRoom } from '@/lib/content'

export const metadata: Metadata = { title: 'على الرف' }

/** The room is built at build time from its published document (D32); the admin preview renders the same view with a draft. */
export default async function ShelfPage() {
  return <ShelfRoomView room={await getShelfRoom()} />
}
