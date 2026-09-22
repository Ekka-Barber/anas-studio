import { r2Storage } from '@payloadcms/storage-r2'
import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import type { CollectionConfig } from 'payload'

/**
 * R2 object storage mapping.
 *
 * Uses `@payloadcms/storage-r2` with the native Worker R2 binding, never the S3
 * adapter. Originals stay private: the collection keeps Payload access control
 * in front of the file route, so an unauthenticated request for an uploaded
 * object is denied rather than served.
 */

/**
 * The R2 binding is only available inside a Worker request or scheduled
 * invocation, while the Payload config is built when the module loads. This
 * proxy defers every bucket operation to the live binding.
 */
const bucket = new Proxy({} as Parameters<typeof r2Storage>[0]['bucket'], {
  get(_target, property) {
    const liveBucket = getCloudflareContext().env.R2
    if (!liveBucket) {
      throw new Error('R2 binding is not available in this context.')
    }
    const value = Reflect.get(liveBucket, property) as unknown
    return typeof value === 'function' ? value.bind(liveBucket) : value
  },
})

export const RUNTIME_PROBE_MEDIA_SLUG = 'runtime-probe-media'

/**
 * Spike-only upload collection. P05 owns the real `Media` collection with the
 * browser-side crop/WebP derivative pipeline; this one exists solely so P00 can
 * prove an object round-trips through the R2 binding and that an anonymous read
 * is refused. It is removed with the rest of the probe.
 */
export const RuntimeProbeMedia: CollectionConfig = {
  slug: RUNTIME_PROBE_MEDIA_SLUG,
  labels: {
    singular: 'ملف فحص',
    plural: 'ملفات الفحص',
  },
  access: {
    create: ({ req }) => Boolean(req.user),
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  upload: {
    // No `imageSizes`, no focal point, no resize path: D15 forbids Sharp and any
    // native image processing in this runtime.
    disableLocalStorage: true,
    mimeTypes: ['image/webp', 'image/png', 'image/jpeg', 'text/plain', 'application/pdf'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'النص البديل',
    },
  ],
}

export const r2StoragePlugin = r2Storage({
  bucket,
  collections: {
    [RUNTIME_PROBE_MEDIA_SLUG]: true,
  },
})
