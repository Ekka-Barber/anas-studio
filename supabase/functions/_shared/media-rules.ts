/**
 * Media rules shared by the browser upload flow (through
 * `src/lib/media-ref.ts`) and the `admin` Edge Function's server-side checks
 * (P05, D15, D32). Pure functions only: no imports, no runtime APIs.
 */

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
