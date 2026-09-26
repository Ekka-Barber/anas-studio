import { z } from 'zod'

import { isMediaId } from '../lib/media-ref'

import { richTextSchema, type RichTextDocument } from './richtext'

import imageManifestRaw from '../../public/images/manifest.json'
import mediaManifestRaw from '../../public/media/manifest.json'

/**
 * Collection field model (D29 "Collections, drafts and versions"): one small
 * config describes each collection's fields once, and `schemaFromFields`
 * derives the Zod schema that the admin form, the publish check and the
 * public loaders all share. Only the field types P04's four collections
 * actually use.
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'paragraphs'
  | 'select'
  | 'boolean'
  | 'image'
  | 'video'
  | 'group'
  | 'list'
  | 'date'
  | 'slug'
  | 'relation'
  | 'richtext'

interface FieldBase {
  name: string
  /** Arabic label shown in the admin form. */
  label: string
  /** Whether the key must be present. Defaults to true. */
  required?: boolean
  /** Whether the value may be `null` in addition to its normal type. */
  nullable?: boolean
}

export type Field =
  | (FieldBase & { type: 'text' | 'textarea' | 'paragraphs' | 'boolean' | 'image' | 'video' | 'date' | 'slug' | 'relation' | 'richtext' })
  | (FieldBase & { type: 'select'; options: readonly string[] })
  | (FieldBase & { type: 'group'; fields: readonly Field[] })
  | (FieldBase & { type: 'list'; fields: readonly Field[]; hideable?: boolean })

/**
 * The plain value shape a field list validates to, computed from the field
 * config itself so `z.infer<typeof someSchema>` matches the real interface
 * (`src/lib/content.ts`'s `StartedRoom` etc.) instead of collapsing to
 * `{[x: string]: unknown}`. Every field list a typed collection schema is
 * built from must be declared `as const satisfies Field[]` (or `Field` for a
 * single shared field like the jewel select) — a plain `Field[]`/`Field`
 * annotation widens `name`/`type`/`options` and breaks this inference.
 */
// prettier-ignore
type BaseValue<F extends Field> =
  F extends { type: 'text' | 'textarea' | 'slug' | 'date' | 'image' | 'video' } ? string :
  F extends { type: 'paragraphs' | 'relation' } ? string[] :
  F extends { type: 'boolean' } ? boolean :
  F extends { type: 'select'; options: infer O } ? (O extends readonly (infer S extends string)[] ? S : string) :
  F extends { type: 'richtext' } ? RichTextDocument :
  F extends { type: 'group'; fields: infer Fs } ? (Fs extends readonly Field[] ? ShapeValue<Fs> : Record<string, unknown>) :
  F extends { type: 'list'; fields: infer Fs; hideable: true } ? (Fs extends readonly Field[] ? Array<ShapeValue<Fs> & { hidden?: boolean }> : unknown[]) :
  F extends { type: 'list'; fields: infer Fs } ? (Fs extends readonly Field[] ? Array<ShapeValue<Fs>> : unknown[]) :
  never

type FieldValue<F extends Field> = F extends { nullable: true } ? BaseValue<F> | null : BaseValue<F>

type OptionalFieldNames<Fields extends readonly Field[]> = Extract<Fields[number], { required: false }>['name']

export type ShapeValue<Fields extends readonly Field[]> = {
  [Name in Exclude<Fields[number]['name'], OptionalFieldNames<Fields>>]: FieldValue<
    Extract<Fields[number], { name: Name }>
  >
} & {
  [Name in OptionalFieldNames<Fields>]?: FieldValue<Extract<Fields[number], { name: Name }>>
}

const imageManifest = imageManifestRaw as unknown as Record<string, unknown>
const videoManifest = (mediaManifestRaw as unknown as { videos: Record<string, unknown> }).videos

// P05: an image field accepts a manifest id (the committed originals) or a
// media-library id (uploaded through the `admin` Edge Function). Videos stay
// manifest-only.
const imageIdSchema = z
  .string()
  .refine((id) => id in imageManifest || isMediaId(id), { message: 'معرّف صورة غير معروف.' })
const videoIdSchema = z.string().refine((id) => id in videoManifest, { message: 'معرّف فيديو غير معروف.' })
const slugSchema = z.string().regex(/^[a-z0-9-]+$/, { message: 'يجب أن يتكوّن من حروف لاتينية صغيرة وأرقام وشرطات.' })
const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'تاريخ غير صالح.' })

const HIDDEN_FIELD: Field = { name: 'hidden', label: 'مخفي', type: 'boolean', required: false }

function baseSchemaFor(field: Field): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return z.string()
    case 'paragraphs':
      return z.array(z.string())
    case 'select':
      return z.enum(field.options as [string, ...string[]])
    case 'boolean':
      return z.boolean()
    case 'image':
      return imageIdSchema
    case 'video':
      return videoIdSchema
    case 'slug':
      return slugSchema
    case 'relation':
      return z.array(slugSchema)
    case 'date':
      return isoDateSchema
    case 'richtext':
      // D14 allowlist (src/admin/richtext.ts).
      return richTextSchema
    case 'group':
      return schemaFromFields(field.fields)
    case 'list': {
      const itemFields = field.hideable ? [...field.fields, HIDDEN_FIELD] : field.fields
      return z.array(schemaFromFields(itemFields))
    }
  }
}

/** Wraps a field's base schema with its `nullable`/`required` modifiers. */
function fieldSchema(field: Field): z.ZodTypeAny {
  let schema = baseSchemaFor(field)
  if (field.nullable) schema = schema.nullable()
  if (field.required === false) schema = schema.optional()
  return schema
}

/**
 * Builds a Zod object schema from a field list — one collection or group.
 * Generic so the return type is `z.ZodType<ShapeValue<F>>`, the precise
 * shape computed from `F`, not the erased `Record<string, ZodTypeAny>` the
 * runtime loop below builds it from.
 */
export function schemaFromFields<const F extends readonly Field[]>(fields: F): z.ZodType<ShapeValue<F>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    shape[field.name] = fieldSchema(field)
  }
  return z.object(shape) as unknown as z.ZodType<ShapeValue<F>>
}
