import { Lost } from '@/components/public/Lost'
import { getJournalName } from '@/lib/content'

export default async function NotFound() {
  return <Lost title="هذا الطريق" accent="لم يُبنَ بعد" journalName={await getJournalName()} />
}
