import { type Field, schemaFromFields } from '../fields'

/**
 * `taxonomies`: an open collection of categories and tags. `doc_id` is the
 * slug itself.
 */
export const taxonomyFields = [
  { name: 'kind', label: 'النوع', type: 'select', options: ['category', 'tag'] },
  { name: 'label', label: 'التسمية', type: 'text' },
] as const satisfies Field[]
export const taxonomySchema = schemaFromFields(taxonomyFields)
