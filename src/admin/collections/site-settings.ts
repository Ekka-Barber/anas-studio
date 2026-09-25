import type { z } from 'zod'

import { type Field, schemaFromFields } from '../fields'

/**
 * `site_settings`: one fixed document, `site` — nav, footer and the home
 * intro addition (`content/initial-content.json` `nav`/`footer`/`home`).
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

export const siteSettingsFields = [
  { name: 'nav', label: 'التنقل', type: 'list', fields: navItemFields },
  { name: 'footer', label: 'التذييل', type: 'group', fields: footerFields },
  { name: 'home', label: 'الرئيسية', type: 'group', fields: homeFields },
] as const satisfies Field[]
export const siteSettingsSchema = schemaFromFields(siteSettingsFields)
export type SiteSettings = z.infer<typeof siteSettingsSchema>
