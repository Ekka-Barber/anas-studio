import { SCENE_CATEGORIES } from '../../content/scenes'

import { type Field, schemaFromFields } from '../fields'

/**
 * `scenes` (C05): one fixed document, `gallery`, holding the photos the
 * scenes page shows, in its order. The list is hideable like the rooms'
 * lists: a hidden photo stays in the document and leaves the page. A photo's
 * category is a select over Anas's five (`SCENE_CATEGORIES`), so publish
 * refuses any other value. Its caption is the lightbox caption, the photo's
 * alt and the tile's name («تكبير: …»), so publish refuses an empty one.
 */
export const sceneFields = [
  { name: 'image', label: 'الصورة', type: 'image' },
  { name: 'category', label: 'التصنيف', type: 'select', options: SCENE_CATEGORIES },
  { name: 'caption', label: 'التعليق', type: 'text' },
] as const satisfies Field[]

export const scenesFields = [
  { name: 'items', label: 'الصور', type: 'list', fields: sceneFields, hideable: true },
] as const satisfies Field[]

export const SCENE_CAPTION_ERROR = 'اكتب تعليق الصورة.'

export const scenesSchema = schemaFromFields(scenesFields).superRefine((value, ctx) => {
  value.items.forEach((item, index) => {
    if (item.caption.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'caption'], message: SCENE_CAPTION_ERROR })
    }
  })
})
