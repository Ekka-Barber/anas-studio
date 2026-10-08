import type { Metadata } from 'next'

import { ShelfRoomView } from '@/components/public/rooms/ShelfRoomView'
import { getNav, getShelfRoom, navLabel } from '@/lib/content'

/** The room's name is Anas's to change (its «العنوان»), so the title waits for the document. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getShelfRoom()).title }
}

/**
 * The room is built at build time from its published document (D32); the admin preview renders the same view with a
 * draft. The doors at its end carry the menu's names for the rooms beside it.
 */
export default async function ShelfPage() {
  const [room, nav] = await Promise.all([getShelfRoom(), getNav()])
  return <ShelfRoomView room={room} backName={navLabel(nav, '/passed')} nextName={navLabel(nav, '/book')} />
}
