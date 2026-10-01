import { type HomeDoor, HomeView } from '@/components/public/home/HomeView'
import {
  getBookRoom,
  getBuiltRoom,
  getHome,
  getHomeDoors,
  getJournalName,
  getPassedRoom,
  getShelfRoom,
  getStartedRoom,
} from '@/lib/content'

/** The home page, built from the published CMS documents at build time (D32). */
export default async function HomePage() {
  const [home, roomDoors, started, built, passed, shelf, book, journalName] = await Promise.all([
    getHome(),
    getHomeDoors(),
    getStartedRoom(),
    getBuiltRoom(),
    getPassedRoom(),
    getShelfRoom(),
    getBookRoom(),
    getJournalName(),
  ])
  const lines: Record<string, string> = {
    '/started': started.tagline,
    '/built': built.tagline,
    '/passed': passed.tagline,
    '/shelf': shelf.tagline,
  }
  const doors: HomeDoor[] = roomDoors.map((door) => ({
    ...door,
    // The journal's door carries its editable name (D11, C08).
    title: door.href === '/journal' ? journalName : door.title,
    roomLine: lines[door.href],
  }))
  return <HomeView home={home} doors={doors} book={book} />
}
