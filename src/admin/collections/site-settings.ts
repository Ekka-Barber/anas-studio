import type { z } from 'zod'

import { normalizeSaudiMobile } from '../../lib/format'

import { type Field, schemaFromFields } from '../fields'

/**
 * `site_settings`: one fixed document, `site` — nav, footer and the home
 * intro addition (`content/initial-content.json` `nav`/`footer`/`home`).
 * P06 round 2 adds the optional `seo` and `contact` groups (`required:
 * false`), so the already-published document without them still validates;
 * the public pages read them from P10 (design paused). C09 adds the optional
 * `social` list the same way (it was `SOCIAL` in `src/content/site.ts`).
 */
export const navItemFields = [
  { name: 'label', label: 'التسمية', type: 'text' },
  { name: 'href', label: 'الرابط', type: 'text' },
] as const satisfies Field[]
export const navItemSchema = schemaFromFields(navItemFields)

export const footerFields = [
  { name: 'poem', label: 'أبيات التذييل', type: 'paragraphs' },
  { name: 'signature', label: 'التوقيع', type: 'text' },
  { name: 'domain', label: 'النطاق', type: 'text' },
] as const satisfies Field[]
export const footerSchema = schemaFromFields(footerFields)

/** D39: the home page's words, all Anas's (his brief, section 1 and 2). */
export const homeFields = [
  { name: 'name', label: 'الاسم الكامل', type: 'text' },
  { name: 'portrait', label: 'الصورة الشخصية', type: 'image' },
  { name: 'portraitAlt', label: 'وصف الصورة الشخصية', type: 'text' },
  { name: 'tagline', label: 'الوصف المختصر', type: 'text' },
  { name: 'intro', label: 'النص الرئيسي', type: 'textarea' },
  { name: 'introAddition', label: 'إضافة مقدمة الرئيسية', type: 'text' },
  { name: 'statement', label: 'العبارة الكبيرة', type: 'text' },
] as const satisfies Field[]

export const seoFields = [
  { name: 'title', label: 'عنوان SEO', type: 'text' },
  { name: 'description', label: 'وصف SEO', type: 'textarea' },
] as const satisfies Field[]

export const contactFields = [
  { name: 'email', label: 'بريد التواصل', type: 'text' },
  { name: 'whatsapp', label: 'رقم واتساب', type: 'text' },
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
] as const satisfies Field[]

/**
 * The lenient stored-data schema the public loader (`src/lib/content.ts`)
 * parses: a bad stored value (a junk whatsapp from an older draft) must never
 * 500 every public page — the contact rules below run only at publish.
 */
export const siteSettingsStoredSchema = schemaFromFields(siteSettingsFields)
export type SiteSettings = z.infer<typeof siteSettingsStoredSchema>

/** The strict schema `schemaFor` hands to the admin form and the publish
 * gate: stored leniency above, plus the L5 contact rules and the C09 social
 * link rules. */
export const siteSettingsSchema = siteSettingsStoredSchema.superRefine((value, ctx) => {
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
