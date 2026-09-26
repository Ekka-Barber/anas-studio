/**
 * Media library rules, server-side and pure (P05, D15). Everything about the
 * declared upload shape, the derivative widths and the R2 key layout lives
 * here so it is unit-testable; `src/app/api/media/*` owns HTTP and
 * `src/lib/r2.ts` owns the buckets. No Sharp, no WASM codec, no image proxy:
 * derivatives are encoded in the authenticated browser, and this module only
 * re-checks magic bytes, type and dimensions from a bounded head read. Those
 * checks are header inspections, not a full decode or metadata sterilization.
 */
import { imageSize } from 'image-size'
import { z } from 'zod'

import { derivativeHeight, derivativeWidths, folderIsInvalid } from './media-ref'

/** The only MIME types an original may declare. */
export const ORIGINAL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const

/** 15 MiB per original. */
export const MAX_ORIGINAL_BYTES = 15_728_640

/** 40 million pixels per original (`width * height`). */
export const MAX_PIXELS = 40_000_000

/** 4 MiB per derivative. */
export const MAX_DERIVATIVE_BYTES = 4_194_304

/** How many bytes a verification reads from an object (never the whole file). */
export const HEAD_READ_BYTES = 1_048_576

const positiveInt = z.number().int().positive()
const nonNegativeInt = z.number().int().min(0)
const byteCount = z.number().int().min(1)

const folderSchema = z.string().refine((folder) => !folderIsInvalid(folder), {
  message: 'مسار مجلد غير صالح.',
})

/**
 * The declaration a browser sends when asking for an upload ticket. Strict
 * objects: an unknown key anywhere is a validation failure, not a silent
 * ignore. The same object is what the SQL functions later read back from the
 * ticket, so it must satisfy the database's own checks too.
 */
export const ticketRequestSchema = z
  .strictObject({
    purpose: z.enum(['image', 'logo']),
    name: z.string().trim().min(1).max(120),
    folder: folderSchema,
    altAr: z.string().trim().min(1).max(300),
    caption: z.string().max(500).optional(),
    rights: z.string().trim().min(1).max(300),
    original: z
      .strictObject({
        mime: z.enum(ORIGINAL_MIME_TYPES),
        bytes: byteCount.max(MAX_ORIGINAL_BYTES),
        width: positiveInt,
        height: positiveInt,
      })
      .refine((original) => original.width * original.height <= MAX_PIXELS, {
        message: 'حجم الصورة بالبكسل أكبر من المسموح.',
      }),
    crop: z.strictObject({ x: nonNegativeInt, y: nonNegativeInt, width: positiveInt, height: positiveInt }),
    derivatives: z
      .array(
        z.strictObject({
          width: positiveInt,
          height: positiveInt,
          bytes: byteCount.max(MAX_DERIVATIVE_BYTES),
        }),
      )
      .min(1)
      .max(4),
  })
  .superRefine((value, ctx) => {
    if (
      value.crop.x + value.crop.width > value.original.width ||
      value.crop.y + value.crop.height > value.original.height
    ) {
      ctx.addIssue({ code: 'custom', path: ['crop'], message: 'القص خارج حدود الصورة الأصلية.' })
    }
    const expectedWidths = derivativeWidths(value.crop.width)
    const declaredWidths = value.derivatives.map((d) => d.width)
    if (expectedWidths.join(',') !== declaredWidths.join(',')) {
      ctx.addIssue({ code: 'custom', path: ['derivatives'], message: 'عروض المشتقات لا تطابق المسموح.' })
      return
    }
    for (const derivative of value.derivatives) {
      if (derivative.height !== derivativeHeight(derivative.width, value.crop)) {
        ctx.addIssue({ code: 'custom', path: ['derivatives'], message: 'ارتفاع أحد المشتقات لا يطابق نسبة القص.' })
        return
      }
    }
  })

export type TicketRequest = z.infer<typeof ticketRequestSchema>

/** R2 keys. Part names are `original` and `w<width>` (for example `w720`). */
export function originalKey(id: string): string {
  return `originals/${id}`
}

export function quarantineKey(id: string, width: number): string {
  return `quarantine/${id}/${width}.webp`
}

export function publicKey(id: string, width: number): string {
  return `m/${id}/${width}.webp`
}

/** The upload ticket's parts list, as the API replies with it. */
export function declaredParts(declared: TicketRequest): Array<{ part: string; bytes: number }> {
  return [
    { part: 'original', bytes: declared.original.bytes },
    ...declared.derivatives.map((d) => ({ part: `w${d.width}`, bytes: d.bytes })),
  ]
}

/**
 * Maps a PostgreSQL SQLSTATE raised by the media functions to its HTTP reply.
 * Anything else returns null and the route answers 500 FAILED.
 */
export function sqlErrorToHttp(code: string | undefined): { status: number; code: string; message: string } | null {
  switch (code) {
    case '42501':
      return { status: 403, code: 'FORBIDDEN', message: 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.' }
    case 'P0002':
      return { status: 404, code: 'NOT_FOUND', message: 'التذكرة غير موجودة.' }
    case '55000':
      return { status: 410, code: 'GONE', message: 'انتهت صلاحية التذكرة أو استُخدمت من قبل.' }
    case '54000':
      return { status: 429, code: 'RATE_LIMITED', message: 'لديك رفعات مفتوحة كثيرة؛ أكملها ثم تابع.' }
    case '23503':
      return { status: 409, code: 'IN_USE', message: 'الصورة مستخدمة في مستندات.' }
    case '23514':
    case '22P02':
    case '22023':
      return { status: 422, code: 'INVALID', message: 'بيانات غير صالحة.' }
    default:
      return null
  }
}

export interface ExpectedHead {
  mime: string
  width: number
  height: number
}

export type HeadVerification = { ok: true } | { ok: false; code: string; message: string }

/** image-size's type names for the allowed MIME types; any other type is refused. */
const DETECTED_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

const UNKNOWN_TYPE: HeadVerification = {
  ok: false,
  code: 'UNKNOWN_TYPE',
  message: 'لم يُعرف نوع الملف من محتواه أو أنه نوع غير مسموح.',
}

/**
 * Checks a bounded head read against the declaration. `image-size` finds the
 * type from the magic bytes (SVG, HTML, text and archives are refused) and
 * reads the dimensions from the header. A JPEG with EXIF orientation 5–8 has
 * its dimensions swapped before comparing, because the browser declares the
 * oriented dimensions. Header inspection only: not a full decode and not a
 * guarantee of metadata sterilization. (`file-type` was dropped: its only
 * entry imports `strtok3` for file reading, which the Worker bundle cannot
 * resolve and never needs.)
 */
export async function verifyObjectHead(head: Uint8Array, expected: ExpectedHead): Promise<HeadVerification> {
  let measured: { width?: number; height?: number; orientation?: number; type?: string }
  try {
    measured = imageSize(head)
  } catch {
    return UNKNOWN_TYPE
  }
  const mime = measured.type ? DETECTED_MIME[measured.type] : undefined
  if (!mime) return UNKNOWN_TYPE
  if (mime !== expected.mime) {
    return { ok: false, code: 'TYPE_MISMATCH', message: 'نوع الملف الفعلي لا يطابق المُعلَن.' }
  }
  let width = measured.width
  let height = measured.height
  if (width === undefined || height === undefined) {
    return { ok: false, code: 'UNREADABLE', message: 'تعذّرت قراءة أبعاد الصورة من محتواها.' }
  }
  if (expected.mime === 'image/jpeg') {
    const orientation = measured.orientation ?? 0
    if (orientation >= 5 && orientation <= 8) [width, height] = [height, width]
  }
  if (width !== expected.width || height !== expected.height) {
    return { ok: false, code: 'DIMENSION_MISMATCH', message: 'أبعاد الصورة الفعلية لا تطابق المُعلَن.' }
  }
  return { ok: true }
}
