import { BuiltRoomView } from '@/components/public/rooms/BuiltRoomView'
import { getBuiltRoom } from '@/lib/content'

/** The room is built at build time from its published document (D32); the admin preview renders the same view with a draft. */
export default async function BuiltPage() {
  return <BuiltRoomView room={await getBuiltRoom()} />
}
