import imageManifestRaw from '../../public/images/manifest.json'
import { isMediaId, parseMediaRef } from './media-ref'

/**
 * Where an image's files are, from the committed manifest
 * (`scripts/prepare-media.mjs`) or a resolved media-library reference (P05).
 * Build-time only: a client component that needs an image gets these strings
 * as props instead of importing the manifest (P01 audit fix 10).
 */
export interface ImageSources {
  src: string
  srcSet: string
  width: number
  height: number
}

interface ManifestEntry {
  derivatives?: Array<{ width: number; height: number; file: string }>
  poster?: { width: number; height: number; file: string }
}
const manifest = imageManifestRaw as unknown as Record<string, ManifestEntry>

/**
 * The sources for `id`, or null when it has nothing to show (an unresolved
 * media-library id). A manifest id that is not in the manifest is a build
 * error: the media script has not been run.
 */
export function imageSources(id: string): ImageSources | null {
  const ref = parseMediaRef(id)
  if (ref) {
    const largest = Math.max(...ref.widths)
    return {
      src: `${ref.base}/${largest}.webp`,
      srcSet: ref.widths.map((w) => `${ref.base}/${w}.webp ${w}w`).join(', '),
      width: ref.width,
      height: ref.height,
    }
  }
  if (isMediaId(id)) return null
  // An own key only: an inherited one («constructor») would pass as an entry with nothing to show.
  const entry = Object.hasOwn(manifest, id) ? manifest[id] : undefined
  if (!entry) throw new Error(`Missing image manifest entry: ${id}. Run scripts/prepare-media.mjs.`)
  // A video poster is one still at the film's own size.
  if (entry.poster) {
    const { file, width, height } = entry.poster
    return { src: `/${file}`, srcSet: `/${file} ${width}w`, width, height }
  }
  const derivatives = entry.derivatives ?? []
  const largest = derivatives[derivatives.length - 1]
  if (!largest) return null
  return {
    src: `/${largest.file}`,
    srcSet: derivatives.map((d) => `/${d.file} ${d.width}w`).join(', '),
    width: largest.width,
    height: largest.height,
  }
}
