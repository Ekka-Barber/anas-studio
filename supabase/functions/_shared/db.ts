/**
 * The Edge Functions' only database path (D32): named SQL functions called
 * through the Data API as `service_role`. The key is provided by the Supabase
 * runtime and never leaves it (the pattern `staff-admin` already uses); the
 * functions themselves recheck every actor and invariant, so the service
 * role grants EXECUTE on exactly the server-only functions it needs. A
 * function that checks the caller itself (granted to `authenticated` only) is
 * called as the caller instead, with their own token (`callerRpc`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { optionalEnv, requireEnv } from './env.ts'

/** Calls one SQL function with named arguments and returns its result. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>

/** A database refusal, carrying the SQLSTATE as `code` like `pg` errors did. */
export class DbError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message)
    this.name = 'DbError'
  }
}

let admin: SupabaseClient | undefined

/**
 * One of the project's API keys, in the order the platform provides them
 * (supabase.com/docs/guides/functions/secrets, read 2026-10-07): the `default`
 * entry of the JSON dictionary it now sets (`SUPABASE_SECRET_KEYS`,
 * `SUPABASE_PUBLISHABLE_KEYS`) when that parses and holds a non-empty string,
 * else the legacy variable (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`),
 * which must then be set. Never logged.
 */
export function apiKey(dictionary: string, legacy: string): string {
  try {
    const key = (JSON.parse(optionalEnv(dictionary) ?? '') as { default?: unknown } | null)?.default
    if (typeof key === 'string' && key.length > 0) return key
  } catch {
    // Unset or not JSON: the legacy key below.
  }
  return requireEnv(legacy)
}

/** The service-role client, created once per isolate: `SUPABASE_SECRET_KEYS.default`, else `SUPABASE_SERVICE_ROLE_KEY`. */
export function serviceClient(): SupabaseClient {
  admin ??= createClient(requireEnv('SUPABASE_URL'), apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}

/**
 * An `Rpc` that runs as the caller: their own bearer token on the publishable
 * key, so a function granted to `authenticated` only sees them (`auth.uid()`)
 * and checks their role itself. The client is made at the call, so a missing
 * variable fails inside the caller's error handling.
 */
export function callerRpc(authorization: string): Rpc {
  return async (fn, args) => {
    const client = createClient(requireEnv('SUPABASE_URL'), apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new DbError(error.message, error.code)
    return data
  }
}

/** The default `Rpc`: the service-role client, errors rethrown with their SQLSTATE. */
export function serviceRpc(): Rpc {
  return async (fn, args) => {
    const { data, error } = await serviceClient().rpc(fn, args)
    if (error) throw new DbError(error.message, error.code)
    return data
  }
}
