/**
 * The Edge Functions' only database path (D32): named SQL functions called
 * through the Data API as `service_role`. The key is provided by the Supabase
 * runtime and never leaves it (the pattern `staff-admin` already uses); the
 * functions themselves recheck every actor and invariant, so the service
 * role grants EXECUTE on exactly the server-only functions it needs.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { requireEnv } from './env.ts'

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

/** The service-role client, created once per isolate. */
export function serviceClient(): SupabaseClient {
  admin ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}

/** The default `Rpc`: the service-role client, errors rethrown with their SQLSTATE. */
export function serviceRpc(): Rpc {
  return async (fn, args) => {
    const { data, error } = await serviceClient().rpc(fn, args)
    if (error) throw new DbError(error.message, error.code)
    return data
  }
}
