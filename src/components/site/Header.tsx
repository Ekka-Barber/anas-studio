import { getNav } from '@/lib/content'

import { SiteHeader } from './SiteHeader'

/** The site header: its links are the CMS navigation (site_settings.nav). */
export async function Header() {
  return <SiteHeader items={await getNav()} />
}
