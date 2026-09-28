import type { Metadata } from 'next'

import { PassedRoomView } from '@/components/public/rooms/PassedRoomView'
import { getPassedRoom } from '@/lib/content'

export const metadata: Metadata = { title: 'مررتُ من هنا' }

/** The room is built at build time from its published document (D32); the admin preview renders the same view with a draft. */
export default async function PassedPage() {
  return <PassedRoomView room={await getPassedRoom()} />
}
