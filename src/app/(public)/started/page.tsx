import type { Metadata } from 'next'

import { StartedRoomView } from '@/components/public/rooms/StartedRoomView'
import { getNav, getStartedRoom, navLabel } from '@/lib/content'

/** The room's name is Anas's to change (its «العنوان»), so the title waits for the document. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getStartedRoom()).title }
}

/**
 * The room is built at build time from its published document (D32); the admin preview renders the same view with a
 * draft. The doors at its end carry the menu's names for the rooms beside it.
 */
export default async function StartedPage() {
  const [room, nav] = await Promise.all([getStartedRoom(), getNav()])
  return <StartedRoomView room={room} backName={navLabel(nav, '/')} nextName={navLabel(nav, '/built')} />
}
