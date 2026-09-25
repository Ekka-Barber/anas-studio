import { type Field, schemaFromFields } from '../fields'

/**
 * `posts`: an open collection, one document per journal entry. `doc_id` is a
 * lowercase uuid (matches `content_versions.doc_id`'s regex).
 */
export const postFields = [
  { name: 'slug', label: 'المعرّف', type: 'slug' },
  { name: 'title', label: 'العنوان', type: 'text' },
  { name: 'excerpt', label: 'مقتطف', type: 'textarea' },
  { name: 'body', label: 'النص', type: 'richtext' },
  { name: 'author', label: 'الكاتب', type: 'text' },
  { name: 'categories', label: 'التصنيفات', type: 'relation' },
  { name: 'tags', label: 'الوسوم', type: 'relation' },
  { name: 'cover', label: 'صورة الغلاف', type: 'image', required: false },
  { name: 'visible', label: 'ظاهر', type: 'boolean' },
] as const satisfies Field[]
export const postSchema = schemaFromFields(postFields)
