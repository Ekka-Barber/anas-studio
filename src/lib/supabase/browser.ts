import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The admin's only Supabase client (P03 "Three data paths" #1): the browser
 * talks to the Data API as the signed-in staff member, with RLS deciding per
 * person. One lazily created singleton, never a service-role key.
 */
let client: SupabaseClient | undefined

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    )
  }

  client = createClient(url, key)
  return client
}
