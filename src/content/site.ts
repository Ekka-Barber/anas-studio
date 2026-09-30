/**
 * Site-wide details that are not in the CMS (D39). Anas's words and his
 * social links (`site_settings.social`, C09) live in the CMS; this file
 * keeps the room order the design needs beside them.
 */

/**
 * The rooms in Anas's order (his message of 21/09/2026), for the list on the
 * 404 and error page (Lost.tsx); the home doors are ROOM_DOORS in home.ts.
 */
export const ROOM_ORDER = [
  { href: '/started', label: 'بدأتُ من هنا' },
  { href: '/built', label: 'بنيتُ هنا' },
  { href: '/passed', label: 'مررتُ من هنا' },
  { href: '/shelf', label: 'على الرف' },
  { href: '/book', label: 'كتبتُ هنا' },
  { href: '/journal', label: 'المجلس' },
] as const
