import { r2Storage } from '@payloadcms/storage-r2'
import { s3Storage } from '@payloadcms/storage-s3'
import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import type { CollectionConfig, Plugin } from 'payload'

import { isNodeRuntimeTarget, requireEnv } from '../lib/env'

/**
 * R2 object storage mapping.
 *
 * Worker target (`RUNTIME_TARGET` unset): `@payloadcms/storage-r2` against the
 * native Worker R2 binding. Node target (`RUNTIME_TARGET=node`, I19/D27): the
 * R2 binding does not exist outside a Worker, so `@payloadcms/storage-s3`
 * talks to the same bucket through R2's S3-compatible API instead.
 *
 * Both adapters land objects at the same key: `handleUpload`/`handleDelete`
 * both receive an identical `storageFilePath` computed by the shared
 * `@payloadcms/plugin-cloud-storage` wrapper (same collection config, same
 * default `useCompositePrefixes: false`, no `prefix` override), and both
 * adapters pass it straight through with no transformation —
 * `storage-r2/dist/uploadFile.js` calls `bucket.put(storageFilePath, ...)`,
 * `storage-s3/dist/uploadFile.js` calls `client.putObject({ Key:
 * storageFilePath, ... })`. Verified by reading both packages'
 * `adapter.js`/`uploadFile.js` at the pinned 3.90.1 version.
 *
 * Originals stay private in both cases: the collection keeps Payload access
 * control in front of the file route, so an unauthenticated request for an
 * uploaded object is denied rather than served. No Sharp either way (D15).
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

/**
 * R2's S3-compatible API: region is always `auto` and the endpoint is the
 * account-scoped `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` host, both
 * required by R2 rather than left at AWS SDK defaults
 * (developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/, fetched
 * 2026-09-23: `region: "auto", // Required by SDK but not used by R2`). No
 * `forcePathStyle` — Cloudflare's own example does not set it.
 */
export const storagePlugin: Plugin = isNodeRuntimeTarget()
  ? s3Storage({
      bucket: requireEnv('R2_BUCKET_NAME'),
      config: {
        region: 'auto',
        endpoint: requireEnv('R2_ENDPOINT'),
        credentials: {
          accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
          secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
        },
      },
      collections: {
        [RUNTIME_PROBE_MEDIA_SLUG]: true,
      },
    })
  : r2Storage({
      bucket,
      collections: {
        [RUNTIME_PROBE_MEDIA_SLUG]: true,
      },
    })
