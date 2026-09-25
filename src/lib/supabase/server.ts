import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { requireEnv } from '../env'

/**
 * Server-side Supabase client (P03 "Three data paths"): the publishable
 * key only, no session persistence. Its one job is verifying a staff
 * member's access token (`auth.getClaims`) before a publish action —
 * never a service-role client, and never used for its own Data API calls.
 */
let client: SupabaseClient | undefined

export function getSupabaseServerClient(): SupabaseClient {
  if (client) return client
  client = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
