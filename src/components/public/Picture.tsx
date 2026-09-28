import { imageSources } from '@/lib/images'

/**
 * `<picture>`/`srcset` from the widths `scripts/prepare-media.mjs` actually
 * generated (never upscaled past the source), with explicit width/height on
 * the fallback `<img>` so the layout never shifts while it loads. A
 * media-library reference (P05) renders the same way from the media origin;
 * an unresolved media-library id renders nothing, never a broken image.
 *
 * Server-rendered only (it reads the manifest through `imageSources`); a
 * client component takes `ImageSources` props instead. `data-*` props (a
 * scroll reveal, motion.ts) go on the `<picture>`.
 */
export function Picture({
  id,
  alt,
  sizes,
  className,
  loading = 'lazy',
  fetchPriority,
  ...data
}: {
  id: string
  alt: string
  sizes: string
  className?: string
  loading?: 'lazy' | 'eager'
  /** `high` for the one image that is a page's largest first paint. */
  fetchPriority?: 'high'
  [data: `data-${string}`]: string | number | undefined
}) {
  const sources = imageSources(id)
  if (!sources) return null
  return (
    <picture className={className} {...data}>
      <source type="image/webp" srcSet={sources.srcSet} sizes={sizes} />
      <img src={sources.src} width={sources.width} height={sources.height} alt={alt} loading={loading} fetchPriority={fetchPriority} decoding="async" />
    </picture>
  )
}
