import { type HomeDoor, HomeView } from '@/components/public/home/HomeView'
import { ROOM_DOORS } from '@/content/home'
import { getBuiltRoom, getHome, getJournalName, getPassedRoom, getShelfRoom, getStartedRoom } from '@/lib/content'

/** The home page, built from the published CMS documents at build time (D32). */
export default async function HomePage() {
  const [home, started, built, passed, shelf, journalName] = await Promise.all([
    getHome(),
    getStartedRoom(),
    getBuiltRoom(),
    getPassedRoom(),
    getShelfRoom(),
    getJournalName(),
  ])
  const lines = { started: started.tagline, built: built.tagline, passed: passed.tagline, shelf: shelf.tagline }
  const doors: HomeDoor[] = ROOM_DOORS.map((door) => ({
    ...door,
    // The journal's door carries its editable name (D11, C08).
    title: door.href === '/journal' ? journalName : door.title,
    roomLine: door.room ? lines[door.room] : undefined,
  }))
  return <HomeView home={home} doors={doors} />
}
