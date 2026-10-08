import type { Metadata } from 'next'

import { PassedRoomView } from '@/components/public/rooms/PassedRoomView'
import { getNav, getPassedRoom, navLabel } from '@/lib/content'

/** The room's name is Anas's to change (its «العنوان»), so the title waits for the document. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getPassedRoom()).title }
}

/**
 * The room is built at build time from its published document (D32); the admin preview renders the same view with a
 * draft. The doors at its end carry the menu's names for the rooms beside it.
 */
export default async function PassedPage() {
  const [room, nav] = await Promise.all([getPassedRoom(), getNav()])
  return <PassedRoomView room={room} backName={navLabel(nav, '/built')} nextName={navLabel(nav, '/shelf')} />
}
