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

export const siteSettingsFields = [
  { name: 'nav', label: 'التنقل', type: 'list', fields: navItemFields },
  { name: 'footer', label: 'التذييل', type: 'group', fields: footerFields },
  { name: 'home', label: 'الرئيسية', type: 'group', fields: homeFields },
  { name: 'seo', label: 'SEO', type: 'group', required: false, fields: seoFields },
  { name: 'contact', label: 'التواصل', type: 'group', required: false, fields: contactFields },
] as const satisfies Field[]
export const siteSettingsSchema = schemaFromFields(siteSettingsFields)
export type SiteSettings = z.infer<typeof siteSettingsSchema>
