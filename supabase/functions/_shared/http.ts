/**
 * The JSON reply contract shared by every Edge Function (ARCHITECTURE "Custom
 * API routes"): `{ok:true,data}` or `{ok:false,error:{code,message,fields?},
 * requestId}`, never cached, Arabic messages, ASCII codes. A reply of status 500
 * or above also leaves one line in the function's log with the same requestId
 * (`fail`), and the SQL-failure helpers add where it came from (`logCause`).
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
  const requestId = crypto.randomUUID()
  // A handled server fault leaves one line, so the id the reply carries matches something in the log: the id, the
  // status and the code, never the message, the body or any value.
  if (status >= 500) console.error(JSON.stringify({ requestId, status, code }))
  return Response.json(
    { ok: false, error: { code, message, ...(fields ? { fields } : {}) }, requestId },
    { status, headers: { ...NO_STORE, ...headers } },
  )
}

/** A SQLSTATE (five characters) or PostgREST's own code (`PGRST202`): the only part of a database error that is logged or recorded. */
const DATABASE_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/

/** The SQLSTATE a database error carries, or null for anything else (a network failure, a timeout, an error of another kind). */
export function sqlstateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && DATABASE_CODE.test(code) ? code : null
}

/**
 * Where a handled failure came from, for the log: which function and which SQLSTATE the database raised, and nothing
 * else. Never the error's message (it can carry a value), the arguments, the body, a token, an address or a name.
 * Called just before the `fail(500, ...)` that answers it, so the line sits next to the one `fail` writes.
 */
export function logCause(fn: string, error: unknown): void {
  console.error(JSON.stringify({ fn, sqlstate: sqlstateOf(error) }))
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
