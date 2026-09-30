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
  | 'slug'
  | 'relation'
  | 'richtext'
  | 'number'
  | 'money'
  | 'datetime'

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
  | (FieldBase & {
      type: 'paragraphs' | 'boolean' | 'image' | 'video' | 'relation' | 'richtext'
    })
  // AUDIT-1 S11.3: the rules a catalog table's own checks put on a string, so the
  // form refuses what the database would. `pattern` replaces a slug's default
  // rule; `nonBlank` is `btrim(x) <> ''`; `after` names an earlier datetime
  // field this one must follow (a coupon's `ends_at`).
  | (FieldBase & {
      type: 'text' | 'textarea' | 'slug'
      nonBlank?: boolean
      maxLength?: number
      pattern?: { regex: RegExp; message: string }
    })
  | (FieldBase & { type: 'datetime'; after?: string })
  // `optionLabels` gives the Arabic text shown for each stored option value.
  | (FieldBase & { type: 'select'; options: readonly string[]; optionLabels?: Readonly<Record<string, string>> })
  | (FieldBase & { type: 'group'; fields: readonly Field[] })
  | (FieldBase & { type: 'list'; fields: readonly Field[]; hideable?: boolean })
  // P07 round 2: an integer within `min`/`max`, integer halalas (D06) with an
  // optional `min`/`max` — `min: 0` where a table allows a zero fee — and an
  // ISO timestamp. `unit: 'percent'` types a coupon's basis points as a
  // percentage (10 → 1000), with the same two-decimal folding as riyals.
  | (FieldBase & { type: 'number'; min?: number; max?: number })
  | (FieldBase & { type: 'money'; min?: number; max?: number; unit?: 'percent'; nullHint?: string })

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
  F extends { type: 'text' | 'textarea' | 'slug' | 'image' | 'video' | 'datetime' } ? string :
  F extends { type: 'paragraphs' | 'relation' } ? string[] :
  F extends { type: 'number' | 'money' } ? number :
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

/**
 * Whether two documents hold the same data, whatever their key order: jsonb
 * reorders keys and Lexical writes them in its own order, so a plain
 * `JSON.stringify` calls an untouched document changed.
 */
export function equalData(a: unknown, b: unknown): boolean {
  const sorted = (_key: string, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : value
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted)
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
    case 'slug': {
      let schema = field.type === 'slug' && !field.pattern ? slugSchema : z.string()
      if (field.pattern) schema = schema.regex(field.pattern.regex, { message: field.pattern.message })
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength, `الحد الأقصى ${field.maxLength} حرفًا.`)
      return field.nonBlank ? schema.refine((value) => value.trim() !== '', { message: 'لا يمكن أن يكون فارغًا.' }) : schema
    }
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
    case 'relation':
      return z.array(slugSchema)
    case 'datetime':
      return isoDateSchema
    case 'number': {
      let schema = z.number({ message: 'أدخل رقمًا.' }).int('أدخل عددًا صحيحًا.')
      if (field.min !== undefined) schema = schema.min(field.min, `أقل قيمة ${field.min}.`)
      if (field.max !== undefined) schema = schema.max(field.max, `أكبر قيمة ${field.max}.`)
      return schema
    }
    case 'money': {
      const min = field.min ?? 1
      return z
        .number({ message: field.unit === 'percent' ? 'أدخل نسبة.' : 'أدخل مبلغًا.' })
        .int()
        .min(min, min === 0 ? 'لا يقل عن صفر.' : 'أدخل قيمة أكبر من صفر.')
        .max(field.max ?? 10_000_000, 'القيمة أكبر من المسموح.')
    }
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
  let schema: z.ZodTypeAny = z.object(shape)
  for (const field of fields) {
    if (field.type !== 'datetime' || !field.after) continue
    const earlier = field.after
    const label = fields.find((candidate) => candidate.name === earlier)?.label ?? earlier
    schema = schema.refine(
      (value) => {
        const data = value as Record<string, unknown>
        const start = data[earlier]
        const end = data[field.name]
        return !(typeof start === 'string' && typeof end === 'string' && Date.parse(end) <= Date.parse(start))
      },
      { path: [field.name], message: `يجب أن يكون بعد «${label}».` },
    )
  }
  return schema as unknown as z.ZodType<ShapeValue<F>>
}
