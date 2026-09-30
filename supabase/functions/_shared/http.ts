/**
 * The JSON reply contract shared by every Edge Function (ARCHITECTURE "Custom
 * API routes"): `{ok:true,data}` or `{ok:false,error:{code,message,fields?},
 * requestId}`, never cached, Arabic messages, ASCII codes.
 */
import { optionalEnv } from './env.ts'

export const NO_STORE = { 'cache-control': 'no-store' }

/** CORS headers for one allowed origin (or `*` for bearer-token endpoints). */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  }
}

export function fail(
  status: number,
  code: string,
  message: string,
  fields?: unknown,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { ok: false, error: { code, message, ...(fields ? { fields } : {}) }, requestId: crypto.randomUUID() },
    { status, headers: { ...NO_STORE, ...headers } },
  )
}

export function ok(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json({ ok: true, data }, { status, headers: { ...NO_STORE, ...headers } })
}

/** The site origin the public forms live on; null when `SITE_URL` is unset or invalid. */
export function siteOrigin(): string | null {
  const siteUrl = optionalEnv('SITE_URL')
  if (!siteUrl) return null
  try {
    return new URL(siteUrl).origin
  } catch {
    return null
  }
}

/**
 * Reads a body as UTF-8 text; null when it is larger than `maxBytes`. A
 * declared content-length is refused before any read, and the stream is
 * counted chunk by chunk and cancelled at the limit, so a chunked body with no
 * content-length never sits in memory whole.
 */
export async function boundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
}
