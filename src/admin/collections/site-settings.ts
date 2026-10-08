import type { z } from 'zod'

import { normalizeSaudiMobile } from '../../lib/format'

import { type Field, schemaFromFields } from '../fields'

import { JEWEL_FIELD, PHOTO_ALT_ERROR } from './rooms'

/**
 * `site_settings`: one fixed document, `site` — nav, footer, the home page's
 * words (D39) and the social links (C09) (`content/initial-content.json`
 * `nav`/`footer`/`home`). P06 round 2 adds the optional `seo` and `contact`
 * groups (`required: false`), so the already-published document without them
 * still validates; `contact` is read by /contact (`getContact`), `seo` is not
 * read yet (P10). C09 adds the optional `social` list the same way (it was
 * `SOCIAL` in `src/content/site.ts`). The home page's room doors
 * (`home.doors`) and the contact page's words (`contactPage`) are optional
 * the same way, and required at publish; their loaders fail the build when a
 * published document lacks them.
 */
export const navItemFields = [
  { name: 'label', label: 'التسمية', type: 'text' },
  { name: 'href', label: 'الرابط', type: 'text' },
] as const satisfies Field[]
export const navItemSchema = schemaFromFields(navItemFields)

export const footerFields = [
  { name: 'poem', label: 'أبيات التذييل', type: 'paragraphs' },
  { name: 'domain', label: 'النطاق', type: 'text' },
] as const satisfies Field[]
export const footerSchema = schemaFromFields(footerFields)

/** The eight routes a home door can open, with the room's name. */
export const DOOR_HREFS = ['/started', '/built', '/passed', '/shelf', '/book', '/journal', '/scenes', '/contact'] as const
const DOOR_HREF_LABELS = {
  '/started': 'بدأتُ من هنا',
  '/built': 'بنيتُ هنا',
  '/passed': 'مررتُ من هنا',
  '/shelf': 'على الرف',
  '/book': 'كتبتُ هنا',
  '/journal': 'المجلس',
  '/scenes': 'المَشاهد',
  '/contact': 'تواصل',
} as const

/** One room door on the home page: its colour is the room's, its order is the list's. */
export const homeDoorFields = [
  { name: 'href', label: 'الغرفة', type: 'select', options: DOOR_HREFS, optionLabels: DOOR_HREF_LABELS },
  { name: 'title', label: 'العنوان', type: 'text', nonBlank: true },
  { ...JEWEL_FIELD, name: 'tone', label: 'اللون' },
  { name: 'meta', label: 'المعلومة القصيرة', type: 'text', required: false },
  { name: 'line', label: 'السطر (لغرفة بلا مستند)', type: 'text', required: false },
  { name: 'cta', label: 'نص الدخول', type: 'text', required: false },
] as const satisfies Field[]

/** D39: the home page's words, all Anas's (his brief, section 1 and 2). */
export const homeFields = [
  { name: 'name', label: 'الاسم الكامل', type: 'text', nonBlank: true },
  { name: 'portrait', label: 'الصورة الشخصية', type: 'image' },
  { name: 'portraitAlt', label: 'وصف الصورة الشخصية', type: 'text' },
  { name: 'tagline', label: 'الوصف المختصر', type: 'text' },
  { name: 'intro', label: 'النص الرئيسي', type: 'textarea' },
  { name: 'introAddition', label: 'إضافة مقدمة الرئيسية', type: 'text' },
  { name: 'statement', label: 'العبارة الكبيرة', type: 'text' },
  { name: 'doors', label: 'أبواب الغرف', type: 'list', required: false, fields: homeDoorFields },
] as const satisfies Field[]

export const seoFields = [
  { name: 'title', label: 'عنوان SEO', type: 'text' },
  { name: 'description', label: 'وصف SEO', type: 'textarea' },
] as const satisfies Field[]

export const contactFields = [
  { name: 'email', label: 'بريد التواصل', type: 'text' },
  { name: 'whatsapp', label: 'رقم واتساب', type: 'text' },
] as const satisfies Field[]

/** One consulting service on the contact page. */
export const contactServiceFields = [
  { name: 'name', label: 'الاسم', type: 'text', nonBlank: true },
  { name: 'text', label: 'الوصف', type: 'textarea' },
] as const satisfies Field[]

/** The contact page's words (D39): his two title lines, his consulting services. */
export const contactPageFields = [
  { name: 'titleLines', label: 'سطرا العنوان', type: 'paragraphs' },
  { name: 'servicesTitle', label: 'عنوان الاستشارات', type: 'text' },
  { name: 'servicesIntro', label: 'مقدمة الاستشارات', type: 'textarea' },
  { name: 'services', label: 'الاستشارات', type: 'list', fields: contactServiceFields },
] as const satisfies Field[]

/** One social channel: the footer shows the first, the contact page all. */
export const socialLinkFields = [
  { name: 'network', label: 'الشبكة', type: 'text' },
  { name: 'handle', label: 'المعرّف', type: 'text' },
  { name: 'href', label: 'الرابط', type: 'text' },
] as const satisfies Field[]

/** L5: real server-side validation for the contact values (was browser-only).
 * Empty means "not set" — the whole `contact` group is optional — but a filled
 * whatsapp must be a Saudi mobile in any everyday spelling
 * (`normalizeSaudiMobile`) and a filled email a plausible address. Exported
 * messages so SettingsView mirrors the exact same rule client-side. */
export const WHATSAPP_ERROR = 'رقم واتساب غير صالح. لازم رقم سعودي يبدأ بـ 5، مثل 0501234567.'
export const CONTACT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/
export const CONTACT_EMAIL_ERROR = 'بريد التواصل غير صالح. لازم بريد كامل، مثل name@example.com.'

/** C09: the publish rules for each social link, and their messages. */
export const SOCIAL_NETWORK_ERROR = 'اكتب اسم الشبكة.'
export const SOCIAL_HANDLE_ERROR = 'اكتب المعرّف.'
export const SOCIAL_HREF_ERROR = 'الرابط غير صالح. لازم رابط كامل يبدأ بـ https، مثل https://x.com/name.'

/** The publish rules for each menu item, and their messages. */
export const NAV_LABEL_ERROR = 'اكتب اسم العنصر.'
export const NAV_HREF_ERROR = 'الرابط غير صالح. لازم مسار داخلي يبدأ بـ /، مثل ‎/journal، أو رابط كامل يبدأ بـ https.'
export const NAV_HREF_DUPLICATE_ERROR = 'هذا الرابط مكرر في القائمة.'

/** The publish rules for the home doors and the contact page, and their messages. */
export const DOOR_HREF_DUPLICATE_ERROR = 'هذه الغرفة مكررة بين الأبواب.'
export const HOME_DOORS_MISSING_ERROR = 'أضف أبواب الغرف.'
export const CONTACT_PAGE_MISSING_ERROR = 'اكتب كلمات صفحة التواصل.'
export const CONTACT_TITLE_ERROR = 'اكتب سطور العنوان، ولا تترك سطرًا فارغًا.'
export const CONTACT_SERVICES_TITLE_ERROR = 'اكتب عنوان الاستشارات.'

/** True only for an absolute `https:` URL: `http:`, `javascript:`, `data:` and relative links are false. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export const siteSettingsFields = [
  { name: 'nav', label: 'التنقل', type: 'list', fields: navItemFields },
  { name: 'footer', label: 'التذييل', type: 'group', fields: footerFields },
  { name: 'home', label: 'الرئيسية', type: 'group', fields: homeFields },
  { name: 'seo', label: 'SEO', type: 'group', required: false, fields: seoFields },
  { name: 'contact', label: 'التواصل', type: 'group', required: false, fields: contactFields },
  { name: 'social', label: 'روابط التواصل', type: 'list', required: false, fields: socialLinkFields },
  { name: 'contactPage', label: 'صفحة التواصل', type: 'group', required: false, fields: contactPageFields },
] as const satisfies Field[]

/**
 * The lenient stored-data schema the public loader (`src/lib/content.ts`)
 * parses: a bad stored value (a junk whatsapp from an older draft) must never
 * 500 every public page — the contact rules below run only at publish.
 */
export const siteSettingsStoredSchema = schemaFromFields(siteSettingsFields)
export type SiteSettings = z.infer<typeof siteSettingsStoredSchema>

/** The strict schema `schemaFor` hands to the admin form and the publish
 * gate: stored leniency above, plus the L5 contact rules, the C09 social
 * link rules, and the home doors and contact page the stored schema leaves
 * optional. */
export const siteSettingsSchema = siteSettingsStoredSchema.superRefine((value, ctx) => {
  // A blank item draws an unnamed link, and an empty href marks every page as
  // current (`startsWith('/')`); the header keys its items by href.
  const hrefs = new Set<string>()
  value.nav.forEach((item, index) => {
    if (item.label.trim() === '') ctx.addIssue({ code: 'custom', path: ['nav', index, 'label'], message: NAV_LABEL_ERROR })
    if (!/^\/(?!\/)\S*$/.test(item.href) && !isHttpsUrl(item.href)) {
      ctx.addIssue({ code: 'custom', path: ['nav', index, 'href'], message: NAV_HREF_ERROR })
    } else if (hrefs.has(item.href)) {
      ctx.addIssue({ code: 'custom', path: ['nav', index, 'href'], message: NAV_HREF_DUPLICATE_ERROR })
    }
    hrefs.add(item.href)
  })
  if (value.home.doors === undefined) {
    ctx.addIssue({ code: 'custom', path: ['home', 'doors'], message: HOME_DOORS_MISSING_ERROR })
  }
  // The portrait is a photo like the rooms' (ADMIN-CMS-09): set, it needs its alt.
  if (value.home.portrait !== '' && value.home.portraitAlt.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['home', 'portraitAlt'], message: PHOTO_ALT_ERROR })
  }
  // Each room has one door, and the home page keys its doors by href.
  const doorHrefs = new Set<string>()
  value.home.doors?.forEach((door, index) => {
    if (doorHrefs.has(door.href)) {
      ctx.addIssue({ code: 'custom', path: ['home', 'doors', index, 'href'], message: DOOR_HREF_DUPLICATE_ERROR })
    }
    doorHrefs.add(door.href)
  })
  if (value.contactPage === undefined) {
    ctx.addIssue({ code: 'custom', path: ['contactPage'], message: CONTACT_PAGE_MISSING_ERROR })
  } else {
    // Both are headings on the page: blank, they draw an empty h1 or h2.
    const { titleLines, servicesTitle } = value.contactPage
    if (titleLines.length === 0 || titleLines.some((line) => line.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: ['contactPage', 'titleLines'], message: CONTACT_TITLE_ERROR })
    }
    if (servicesTitle.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['contactPage', 'servicesTitle'], message: CONTACT_SERVICES_TITLE_ERROR })
    }
  }
  value.social?.forEach((link, index) => {
    if (link.network.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['social', index, 'network'], message: SOCIAL_NETWORK_ERROR })
    }
    if (link.handle.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['social', index, 'handle'], message: SOCIAL_HANDLE_ERROR })
    }
    if (!isHttpsUrl(link.href)) {
      ctx.addIssue({ code: 'custom', path: ['social', index, 'href'], message: SOCIAL_HREF_ERROR })
    }
  })
  const contact = value.contact
  if (!contact) return
  if (contact.whatsapp.trim() !== '' && normalizeSaudiMobile(contact.whatsapp) === null) {
    ctx.addIssue({ code: 'custom', path: ['contact', 'whatsapp'], message: WHATSAPP_ERROR })
  }
  const email = contact.email.trim()
  if (email !== '' && !CONTACT_EMAIL_PATTERN.test(email)) {
    ctx.addIssue({ code: 'custom', path: ['contact', 'email'], message: CONTACT_EMAIL_ERROR })
  }
})
