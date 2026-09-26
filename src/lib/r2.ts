import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'

/**
 * The media library's two R2 buckets (P05). `R2` is private — originals and
 * quarantine, never served; `MEDIA_PUBLIC` holds the public derivatives
 * behind an isolated origin. Both are bindings in `wrangler.jsonc`, reached
 * the same way as `HYPERDRIVE` in `src/lib/db.ts`.
 */

/** The private bucket (`originals/<id>`, `quarantine/<id>/<width>.webp`); never served. */
export function privateBucket(): R2Bucket {
  return getCloudflareContext().env.R2
}

/** The public derivative bucket (`m/<id>/<width>.webp`), served from an isolated origin. */
export function publicBucket(): R2Bucket {
  return getCloudflareContext().env.MEDIA_PUBLIC
}

/**
 * Range-reads at most the first `length` bytes of an object — the only way
 * media verification reads a file; a whole object is never buffered or
 * decoded just to check it. Returns null when the object does not exist.
 */
export async function readHead(bucket: R2Bucket, key: string, length: number): Promise<Uint8Array | null> {
  const object = await bucket.get(key, { range: { offset: 0, length } })
  if (!object) return null
  return new Uint8Array(await object.arrayBuffer())
}
