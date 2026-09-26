import type { z } from 'zod'

import { type Field, schemaFromFields } from '../fields'

/**
 * `site_settings`: one fixed document, `site` — nav, footer and the home
 * intro addition (`content/initial-content.json` `nav`/`footer`/`home`).
 * P06 round 2 adds the optional `seo` and `contact` groups (`required:
 * false`), so the already-published document without them still validates;
 * the public pages read them from P10 (design paused).
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

export const homeFields = [{ name: 'introAddition', label: 'إضافة مقدمة الرئيسية', type: 'text' }] as const satisfies Field[]

export const seoFields = [
  { name: 'title', label: 'عنوان SEO', type: 'text' },
  { name: 'description', label: 'وصف SEO', type: 'textarea' },
] as const satisfies Field[]

export const contactFields = [
  { name: 'email', label: 'بريد التواصل', type: 'text' },
  { name: 'whatsapp', label: 'رقم واتساب', type: 'text' },
] as const satisfies Field[]

/** L5: real server-side validation for the contact values (was browser-only).
 * Empty means "not set" — the whole `contact` group is optional — but a filled
 * value must be a Saudi mobile or a plausible email address. Exported so
 * SettingsView mirrors the exact same patterns and messages client-side. */
export const WHATSAPP_PATTERN = /^(\+?966|0)?5\d{8}$/
export const WHATSAPP_ERROR = 'رقم واتساب غير صالح — لازم رقم سعودي يبدأ بـ 5، مثل 0501234567.'
export const CONTACT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/
export const CONTACT_EMAIL_ERROR = 'بريد التواصل غير صالح — لازم بريد كامل، مثل name@example.com.'

export const siteSettingsFields = [
  { name: 'nav', label: 'التنقل', type: 'list', fields: navItemFields },
  { name: 'footer', label: 'التذييل', type: 'group', fields: footerFields },
  { name: 'home', label: 'الرئيسية', type: 'group', fields: homeFields },
  { name: 'seo', label: 'SEO', type: 'group', required: false, fields: seoFields },
  { name: 'contact', label: 'التواصل', type: 'group', required: false, fields: contactFields },
] as const satisfies Field[]
export const siteSettingsSchema = schemaFromFields(siteSettingsFields).superRefine((value, ctx) => {
  const contact = value.contact
  if (!contact) return
  // Dashes and spaces are typing aids, not data: validate the compact form
  // (stored values like `050-123-4567` must stay publishable).
  const whatsapp = contact.whatsapp.replace(/[\s-]/g, '')
  if (whatsapp !== '' && !WHATSAPP_PATTERN.test(whatsapp)) {
    ctx.addIssue({ code: 'custom', path: ['contact', 'whatsapp'], message: WHATSAPP_ERROR })
  }
  const email = contact.email.trim()
  if (email !== '' && !CONTACT_EMAIL_PATTERN.test(email)) {
    ctx.addIssue({ code: 'custom', path: ['contact', 'email'], message: CONTACT_EMAIL_ERROR })
  }
})
export type SiteSettings = z.infer<typeof siteSettingsSchema>
