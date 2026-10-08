import type { Metadata } from 'next'

import { BuiltRoomView } from '@/components/public/rooms/BuiltRoomView'
import { getBuiltRoom, getNav, navLabel } from '@/lib/content'

/** The room's name is Anas's to change (its «العنوان»), so the title waits for the document. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getBuiltRoom()).title }
}

/**
 * The room is built at build time from its published document (D32); the admin preview renders the same view with a
 * draft. The doors at its end carry the menu's names for the rooms beside it.
 */
export default async function BuiltPage() {
  const [room, nav] = await Promise.all([getBuiltRoom(), getNav()])
  return <BuiltRoomView room={room} backName={navLabel(nav, '/started')} nextName={navLabel(nav, '/passed')} />
}
