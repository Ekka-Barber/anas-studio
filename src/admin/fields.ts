import { z } from 'zod'

import { isDay } from '../lib/admin-commerce'
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
  | 'date'

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
      /** A line under the input, for what a label cannot say (who sees the text). */
      hint?: string
    })
  | (FieldBase & { type: 'datetime'; after?: string })
  // A calendar day, `YYYY-MM-DD` (a preorder's delivery date): no time, no zone.
  | (FieldBase & { type: 'date' })
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
  F extends { type: 'text' | 'textarea' | 'slug' | 'image' | 'video' | 'datetime' | 'date' } ? string :
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

/** A field list's empty starting value, computed from the config itself. */
export function defaultsForFields(fields: readonly Field[]): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of fields) value[field.name] = defaultForField(field)
  return value
}

/**
 * `loaded` with what it lacks filled from the field defaults, so a stored
 * document without a whole group (the seeded settings have no `contact` or
 * `seo`) opens with that group's values in place, and typing into one child
 * cannot leave its siblings undefined. Loaded values always win, a group in
 * both is merged key by key, and an optional field that is not a group stays
 * absent: an unset value must stay unset, not become '' (`galleryLine ?? …`).
 */
export function withDefaults(fields: readonly Field[], loaded: Record<string, unknown>): Record<string, unknown> {
  const value = { ...loaded }
  for (const field of fields) {
    const current = loaded[field.name]
    if (field.type === 'group' && current !== null && typeof current === 'object' && !Array.isArray(current)) {
      value[field.name] = withDefaults(field.fields, current as Record<string, unknown>)
    } else if (current === undefined && (field.type === 'group' || field.required !== false)) {
      const fallback = defaultForField(field)
      if (fallback !== undefined) value[field.name] = fallback
    }
  }
  return value
}

function defaultForField(field: Field): unknown {
  if (field.nullable) return null
  // An optional (not nullable) image/video has no valid "empty" id, so an
  // empty default must be an absent key, not '' (which would fail the id
  // schema). `posts.cover` is the only field like this today.
  if (field.required === false && (field.type === 'image' || field.type === 'video')) return undefined
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'slug':
    case 'image':
    case 'video':
      return ''
    case 'paragraphs':
    case 'relation':
      return []
    case 'boolean':
      return false
    case 'select':
      return field.options[0] ?? ''
    // P07 round 2: nullable number/money/datetime default to null (handled
    // above), otherwise a number starts at 0 and a timestamp as ''.
    case 'number':
    case 'money':
      return 0
    case 'datetime':
    case 'date':
      return ''
    case 'richtext':
      return { root: { type: 'root', children: [] } }
    case 'group':
      return defaultsForFields(field.fields)
    case 'list':
      return []
  }
}

/** The unsaved copy the editor keeps in `localStorage` (CollectionForm's autosave). */
export interface StoredDraft {
  baseSeq: number
  data: unknown
  savedAt: number
  /** Who wrote the copy. Absent on copies written before this was recorded. */
  userId?: string
}

/**
 * What a loaded document offers back from its stored local copy. A copy another
 * signed-in user left on this browser is not offered (this user may not even be
 * allowed to read the document); one without a `userId` predates the field and
 * is. The copy is read as the form would hold it (defaults merged), and is not
 * offered when that is the loaded data. `staleBase` is the version the copy was
 * made from, when a newer one is saved now.
 */
export function draftOffer(
  stored: StoredDraft | null,
  userId: string | undefined,
  loadedData: Record<string, unknown>,
  loadedSeq: number,
  fields: readonly Field[],
): { offered: Record<string, unknown> | null; staleBase: number | null; savedAt: number | null } {
  const own = stored && (stored.userId === undefined || stored.userId === userId) ? stored : null
  const data = own?.data
  const merged =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? withDefaults(fields, data as Record<string, unknown>)
      : null
  const offered = merged && !equalData(merged, loadedData) ? merged : null
  return {
    offered,
    staleBase: own && own.baseSeq < loadedSeq ? own.baseSeq : null,
    savedAt: offered && own ? own.savedAt : null,
  }
}

/**
 * What the editor does with its local copy after a change: nothing while a
 * copy is on offer (it stays until the user answers it, whether the form was
 * saved or typed in), else remove it when the form equals the saved version,
 * else write the form as the copy. Save does not touch the copy itself; this
 * rule runs again after it (AUDIT-2 ADMIN-editor-2, FIX-admin-1).
 */
export function draftStorageAction(offerPending: boolean, data: unknown, saved: unknown): 'keep' | 'remove' | 'write' {
  return offerPending ? 'keep' : equalData(data, saved) ? 'remove' : 'write'
}

/**
 * A validation issue's path in words for the form's error list (FIX-admin-3):
 * the top-level label, the 1-based number of a list item or paragraph, then the
 * inner field's label, like «المشاهد › 17 › التعليق».
 */
export function fieldPathLabel(fields: readonly Field[], path: readonly PropertyKey[]): string {
  const parts: string[] = []
  let scope: readonly Field[] = fields
  for (const segment of path) {
    if (typeof segment === 'number') {
      parts.push(String(segment + 1))
      continue
    }
    const field = scope.find((candidate) => candidate.name === segment)
    parts.push(field?.label ?? String(segment))
    scope = field?.type === 'group' || field?.type === 'list' ? field.fields : []
  }
  return parts.join(' › ')
}

const imageManifest = imageManifestRaw as unknown as Record<string, unknown>
const videoManifest = (mediaManifestRaw as unknown as { videos: Record<string, unknown> }).videos

// P05: an image field accepts a manifest id (the committed originals) or a
// media-library id (uploaded through the `admin` Edge Function). Videos stay
// manifest-only.
// Own keys only: `in` would accept `constructor` and `toString`, names the
// manifests inherit from Object.prototype (the same rule as `isRoomSlug`).
const imageIdSchema = z
  .string()
  .refine((id) => Object.hasOwn(imageManifest, id) || isMediaId(id), { message: 'معرّف صورة غير معروف.' })
const videoIdSchema = z.string().refine((id) => Object.hasOwn(videoManifest, id), { message: 'معرّف فيديو غير معروف.' })
// The rule every slug in the database follows (`content_versions.doc_id`, products):
// it is a static route segment, so its length and first character matter.
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, {
  message: 'حروف لاتينية صغيرة وأرقام وشرطات، حتى 80 حرفًا، ولا يبدأ بشرطة.',
})
const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'تاريخ غير صالح.' })
const daySchema = z.string().refine(isDay, { message: 'تاريخ غير صالح.' })

const HIDDEN_FIELD: Field = { name: 'hidden', label: 'مخفي', type: 'boolean', required: false }

function baseSchemaFor(field: Field): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'slug': {
      let schema = field.type === 'slug' && !field.pattern ? slugSchema : z.string()
      if (field.pattern) schema = schema.regex(field.pattern.regex, { message: field.pattern.message })
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength, `الحد الأقصى ${field.maxLength} حرفًا.`)
      // `nonBlank` marks a single-line name whose table also checks `btrim(x) <> ''`
      // and `x !~ '[[:cntrl:]]'`, so a pasted tab is named here, not by a 23514.
      return field.nonBlank
        ? schema
            .refine((value) => value.trim() !== '', { message: 'لا يمكن أن يكون فارغًا.' })
            .refine((value) => !/[\u0000-\u001F\u007F-\u009F]/.test(value), { message: 'لا يُقبل نص فيه رموز تحكم.' })
        : schema
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
    case 'date':
      return daySchema
    case 'number': {
      // Every catalog number is a Postgres `integer`: without these bounds an
      // overflow (22003) would reach the owner as «تعذّر الحفظ.», naming nothing.
      const min = field.min ?? -2_147_483_648
      const max = field.max ?? 2_147_483_647
      return z
        .number({ message: 'أدخل رقمًا.' })
        .int('أدخل عددًا صحيحًا.')
        // LRM before a negative number keeps its minus on its left; without it the sign is drawn after the digits.
        .min(min, `أقل قيمة ${min < 0 ? '‎' : ''}${min}.`)
        .max(max, `أكبر قيمة ${max}.`)
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
