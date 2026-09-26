/**
 * Client-safe media references (P05). A saved draft stores bare media-library
 * ids; the public loaders (`src/lib/content.ts`) replace every id they can
 * resolve with a self-describing `media|…` string that `<Picture>` renders.
 * No server imports here — `Picture.tsx` (a client component's dependency)
 * and `src/admin/fields.ts` both use this module. The derivative width rules
 * also live here (P05 round 2) so the browser upload flow can use them
 * without importing `src/lib/media.ts`, which pulls server-only code.
 */

/**
 * The public media origin: `NEXT_PUBLIC_MEDIA_ORIGIN` in production (the
 * isolated origin of the public R2 bucket), or the local stand-in route
 * `/media`. The literal `process.env` property access is what Next inlines at
 * build time, in both server and client bundles — P11 must therefore build
 * with the real origin set.
 */
export const MEDIA_ORIGIN = process.env.NEXT_PUBLIC_MEDIA_ORIGIN || '/media'

/**
 * A public derivative URL from its R2 key. Keys are `m/<id>/<width>.webp`
 * and the loaders build `<origin>/m/<id>` bases (`src/lib/content.ts`), so
 * the key is kept whole: `mediaUrl('m/<id>/1200.webp')` →
 * `/media/m/<id>/1200.webp` locally — exactly the URLs `<Picture>` renders
 * and the `/media` route answers.
 */
export function mediaUrl(key: string): string {
  return `${MEDIA_ORIGIN}/${key}`
}

/** Derivative widths the browser generates, ascending; never upscaled past the crop. */
export const PRESET_WIDTHS = [360, 720, 1200, 1800] as const

/** The preset widths that fit in `cropWidth`; alone below the smallest preset, so never an upscale. */
export function derivativeWidths(cropWidth: number): number[] {
  const fitting = PRESET_WIDTHS.filter((width) => width <= cropWidth)
  return fitting.length > 0 ? fitting : [cropWidth]
}

/** The height a derivative of `width` has at the crop's aspect ratio. */
export function derivativeHeight(width: number, crop: { width: number; height: number }): number {
  return Math.round((width * crop.height) / crop.width)
}

/**
 * Folder path rules shared by the SQL check, `ticketRequestSchema` and the
 * admin form: at most 120 characters, no control characters, and a clean
 * `/`-separated path (no leading/trailing/double slash). The empty string is
 * the root folder and is valid.
 */
export function folderIsInvalid(folder: string): boolean {
  return folder.length > 120 || /[\u0000-\u001F\u007F]/.test(folder) || /(^\/|\/$|\/\/)/.test(folder)
}

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A lowercase UUID string — the shape of a media-library id (the ticket id). */
export function isMediaId(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_ID.test(value)
}

/** Every unique media id anywhere inside `value`, in first-seen order. */
export function collectMediaIds(value: unknown): string[] {
  const ids = new Set<string>()
  function walk(node: unknown): void {
    if (typeof node === 'string') {
      if (isMediaId(node)) ids.add(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item)
    }
  }
  walk(value)
  return [...ids]
}

export interface MediaRef {
  /** `<origin>/m/<id>`; the origin is `MEDIA_ORIGIN` (`/media` locally). */
  base: string
  /** The largest derivative's width and height, for layout. */
  width: number
  height: number
  /** Available derivative widths, ascending. */
  widths: number[]
}

/** `media|<base>|<width>x<height>|<w1>,<w2>,…` */
export function formatMediaRef(ref: MediaRef): string {
  return `media|${ref.base}|${ref.width}x${ref.height}|${ref.widths.join(',')}`
}

const REF_PATTERN = /^media\|([^|]+)\|(\d+)x(\d+)\|(\d{1,7}(?:,\d{1,7})*)$/

/** The inverse of `formatMediaRef`; null for anything else (including bare ids). */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (typeof value !== 'string') return null
  const match = REF_PATTERN.exec(value)
  if (!match) return null
  const width = Number(match[2])
  const height = Number(match[3])
  const widths = match[4]!.split(',').map(Number)
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null
  if (widths.some((w) => !Number.isInteger(w) || w <= 0)) return null
  return { base: match[1]!, width, height, widths }
}
