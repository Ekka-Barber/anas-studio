import { publicBucket } from '@/lib/r2'

/**
 * A local stand-in for the isolated public media origin (P05): reads only
 * `m/<uuid>/<width>.webp` objects from the `MEDIA_PUBLIC` bucket, with
 * nosniff and a sandboxing CSP. When `NEXT_PUBLIC_MEDIA_ORIGIN` is set,
 * production serves media from that origin instead and this route stops
 * answering. The env read is the literal property access so Next inlines it
 * at build time (matching `MEDIA_ORIGIN` in `src/lib/media-ref.ts`).
 */
export const dynamic = 'force-dynamic'

const KEY_PATTERN = /^m\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{2,4}\.webp$/

const HEADERS = {
  'content-type': 'image/webp',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cache-control': 'public, max-age=31536000, immutable',
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })
}

export async function GET(_request: Request, context: { params: Promise<{ key?: string[] }> }): Promise<Response> {
  if (process.env.NEXT_PUBLIC_MEDIA_ORIGIN) return notFound()
  const { key } = await context.params
  const joined = (key ?? []).join('/')
  if (!KEY_PATTERN.test(joined)) return notFound()
  const object = await publicBucket().get(joined)
  if (!object) return notFound()
  return new Response(object.body, { headers: HEADERS })
}
