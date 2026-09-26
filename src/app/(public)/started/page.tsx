import { StartedRoomView } from '@/components/public/rooms/StartedRoomView'
import { getStartedRoom } from '@/lib/content'

/** The room is built at build time from its published document (D32); the admin preview renders the same view with a draft. */
export default async function StartedPage() {
  return <StartedRoomView room={await getStartedRoom()} />
}
