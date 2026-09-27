/**
 * The commerce settings' editable fields (P06 round 3): one Zod schema
 * shared by the `admin` Edge Function's `commerce-settings-save` action and
 * the browser form (`src/components/admin/CommerceSettingsForm.tsx`), so the
 * two never disagree. The limits are the SQL table's own checks
 * (`20260927130000_commerce_settings.sql`). No tax field of any kind (D34):
 * prices are what the buyer pays.
 *
 * Zod is the only import, like `media-rules.ts`, so the browser form can use
 * this module the way `src/lib/media-ref.ts` uses the media rules.
 */
import { z } from 'zod'

// The SQL checks use `[[:cntrl:]]`, which in the database's UTF-8 locale
// also matches the C1 controls U+0080–U+009F; refusing the same range here
// keeps a field error instead of a generic 422 from the table.
const noControlCharacters = (value: string) => !/[\u0000-\u001F\u007F-\u009F]/.test(value)

const sellerField = (max: number) =>
  z
    .string({ message: 'أدخل نصًا أو اترك الحقل فارغًا.' })
    .trim()
    .min(1, 'أدخل نصًا أو اترك الحقل فارغًا.')
    .max(max, `الحد الأقصى ${max} حرفًا.`)
    .refine(noControlCharacters, 'لا يُقبل نص فيه رموز تحكم.')
    .nullable()

/** The three seller fields; every other key is refused. */
export const commerceSettingsSchema = z.strictObject({
  sellerLegalName: sellerField(200),
  sellerAddress: sellerField(500),
  sellerRegistration: sellerField(100),
})

/** The `admin` action's whole body: `{ action, expectedVersion, settings }`. */
export const commerceSettingsSaveSchema = z.strictObject({
  action: z.literal('commerce-settings-save'),
  expectedVersion: z.number().int().min(0),
  settings: commerceSettingsSchema,
})

export type CommerceSettings = z.infer<typeof commerceSettingsSchema>
