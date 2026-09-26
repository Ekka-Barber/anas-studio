/**
 * The JSON reply contract shared by every Edge Function (ARCHITECTURE "Custom
 * API routes"): `{ok:true,data}` or `{ok:false,error:{code,message,fields?},
 * requestId}`, never cached, Arabic messages, ASCII codes.
 */

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

/** Reads a bounded body as text; null when it is larger than `maxBytes`. */
export async function boundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > maxBytes) return null
  const text = await request.text()
  return new TextEncoder().encode(text).length > maxBytes ? null : text
}
