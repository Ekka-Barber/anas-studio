/**
 * Site-wide details that are not in the CMS yet (D39). Anas's words live in
 * the CMS; this file holds the few facts the design needs beside them.
 * Moving any of these into site_settings is a later CMS change.
 */

/** His public handle on every network (the brief, PROMPTS.md item 9). */
export const SOCIAL = [
  { network: 'إنستغرام', handle: '@anasa.aq', href: 'https://www.instagram.com/anasa.aq' },
  { network: 'تيك توك', handle: '@anasa.aq', href: 'https://www.tiktok.com/@anasa.aq' },
  { network: 'إكس', handle: '@anasa.aq', href: 'https://x.com/anasa.aq' },
  { network: 'سناب شات', handle: 'anasa.aq', href: 'https://www.snapchat.com/add/anasa.aq' },
] as const

/** The rooms in Anas's order (his message of 21/09/2026), for the room doors. */
export const ROOM_ORDER = [
  { href: '/started', label: 'بدأتُ من هنا' },
  { href: '/built', label: 'بنيتُ هنا' },
  { href: '/passed', label: 'مررتُ من هنا' },
  { href: '/shelf', label: 'على الرف' },
  { href: '/book', label: 'كتبتُ هنا' },
  { href: '/journal', label: 'المجلس' },
] as const
