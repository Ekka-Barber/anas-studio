/**
 * Client-safe media references (P05). A saved draft stores bare media-library
 * ids; the public loaders (`src/lib/content.ts`) replace every id they can
 * resolve with a self-describing `media|…` string that `<Picture>` renders.
 * No server imports here — `Picture.tsx` (a client component's dependency)
 * and `src/admin/fields.ts` both use this module.
 */

/**
 * The public media origin (D32): the `media-public` Supabase Storage bucket,
 * an origin separate from the site's. The literal `process.env` property
 * access is what Next inlines at build time, in both server and client
 * bundles; without it (unit tests) the origin is empty.
 */
export const MEDIA_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media-public`
  : ''

/**
 * A public derivative URL from its storage key. Keys are `m/<id>/<width>.webp`
 * and the loaders build `<origin>/m/<id>` bases (`src/lib/content.ts`), so
 * the key is kept whole.
 */
export function mediaUrl(key: string): string {
  return `${MEDIA_ORIGIN}/${key}`
}

// The derivative and folder rules are shared with the media Edge Function,
// which re-checks every upload server-side; one definition, two runtimes.
export {
  PRESET_WIDTHS,
  derivativeHeight,
  derivativeWidths,
  folderIsInvalid,
  isMediaId,
} from '../../supabase/functions/_shared/media-rules.ts'
import { isMediaId } from '../../supabase/functions/_shared/media-rules.ts'

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
