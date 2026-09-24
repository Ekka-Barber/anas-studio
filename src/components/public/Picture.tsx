import imageManifestRaw from '../../../public/images/manifest.json'

/**
 * `<picture>`/`srcset` from the widths `scripts/prepare-media.mjs` actually
 * generated (never upscaled past the source), with explicit width/height on
 * the fallback `<img>` so the layout never shifts while it loads.
 *
 * Reads the image manifest directly rather than via `@/lib/content`: Picture
 * is rendered from client components (Gallery), and any value-import from
 * content.ts there would bundle Anas's texts into client JS (P01 audit fix 10).
 */
interface ImageDerivative {
  width: number
  height: number
  file: string
}
interface ImageManifestEntry {
  derivatives?: ImageDerivative[]
}
const imageManifest = imageManifestRaw as unknown as Record<string, ImageManifestEntry>

function getImage(id: string): ImageManifestEntry {
  const entry = imageManifest[id]
  if (!entry) throw new Error(`Missing image manifest entry: ${id}. Run scripts/prepare-media.mjs.`)
  return entry
}
export function Picture({
  id,
  alt,
  sizes,
  className,
  loading = 'lazy',
}: {
  id: string
  alt: string
  sizes: string
  className?: string
  loading?: 'lazy' | 'eager'
}) {
  const entry = getImage(id)
  const derivatives = entry.derivatives ?? []
  const largest = derivatives[derivatives.length - 1]
  if (!largest) return null
  const srcSet = derivatives.map((d) => `/${d.file} ${d.width}w`).join(', ')
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={srcSet} sizes={sizes} />
      <img
        src={`/${largest.file}`}
        width={largest.width}
        height={largest.height}
        alt={alt}
        loading={loading}
      />
    </picture>
  )
}
