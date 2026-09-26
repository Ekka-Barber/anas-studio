import { FunctionsHttpError } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from './browser'

export type FunctionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: unknown } }

/**
 * Calls one of the Supabase Edge Functions from the admin (D32). The signed-in
 * staff member's session token travels with the call; the function verifies
 * it again. A function's own `{ok:false,error}` reply is passed through; a
 * network failure becomes a generic error, never an exception.
 */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<FunctionResult<T>> {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const parsed = (await error.context.json()) as { error?: { code: string; message: string } }
        if (parsed?.error) return { ok: false, error: parsed.error }
      } catch {
        // fall through to the generic message below
      }
    }
    return { ok: false, error: { code: 'UNKNOWN', message: 'تعذّر الاتصال بالخادم.' } }
  }
  // A 200 reply is still validated: a gateway or proxy answering HTML would
  // otherwise surface as a TypeError at the call site.
  if (data && typeof data === 'object' && 'ok' in data) return data as FunctionResult<T>
  return { ok: false, error: { code: 'UNKNOWN', message: 'تعذّر الاتصال بالخادم.' } }
}

/** The admin URL that edits one document; ids travel in the query (static export). */
export function documentHref(collection: string, docId: string): string {
  return `/admin/content/${collection}/edit?id=${encodeURIComponent(docId)}`
}
