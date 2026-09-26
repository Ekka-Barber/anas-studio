import { z } from 'zod'

import { folderIsInvalid } from '../../lib/media-ref'

import { type Field } from '../fields'

/**
 * The media library's descriptive fields (P05 round 2). Media is not a
 * content collection: it has no drafts, no versions and no publish flow, so
 * it is deliberately NOT registered in `collections` — `MediaLibrary`
 * renders these fields and edits the `media` row directly through the Data
 * API. `mediaMetaSchema` is the `schemaFromFields(mediaFields)` shape with
 * the same trims and limits the SQL columns enforce (`media` checks and
 * `ticketRequestSchema`), so both the edit form and the upload dialog
 * validate with it; it is client-safe (no `media.ts` import, which would
 * pull server-only code). A unit test keeps the field list and the schema in
 * sync.
 */
export const mediaFields = [
  { name: 'name', label: 'الاسم', type: 'text' },
  { name: 'altAr', label: 'الوصف البديل', type: 'text' },
  { name: 'caption', label: 'التعليق', type: 'textarea' },
  { name: 'rights', label: 'الحقوق', type: 'text' },
  { name: 'folder', label: 'المجلد', type: 'text' },
] as const satisfies Field[]

/** The value shape the five fields above edit (and the upload form collects). */
export type MediaMeta = z.infer<typeof mediaMetaSchema>

export const mediaMetaSchema = z.strictObject({
  name: z
    .string({ error: 'الاسم مطلوب.' })
    .trim()
    .min(1, 'الاسم مطلوب.')
    .max(120, 'الاسم أطول من 120 حرفًا.'),
  altAr: z
    .string({ error: 'الوصف البديل مطلوب.' })
    .trim()
    .min(1, 'الوصف البديل مطلوب.')
    .max(300, 'الوصف البديل أطول من 300 حرف.'),
  caption: z.string().max(500, 'التعليق أطول من 500 حرف.').optional(),
  rights: z
    .string({ error: 'الحقوق مطلوبة.' })
    .trim()
    .min(1, 'الحقوق مطلوبة.')
    .max(300, 'الحقوق أطول من 300 حرف.'),
  folder: z.string().refine((folder) => !folderIsInvalid(folder), {
    message: 'مسار مجلد غير صالح.',
  }),
})
