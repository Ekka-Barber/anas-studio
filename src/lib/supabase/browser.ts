import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The admin's only Supabase client (P03 "Three data paths" #1): the browser
 * talks to the Data API as the signed-in staff member, with RLS deciding per
 * person. One lazily created singleton, never a service-role key.
 */
let client: SupabaseClient | undefined
/** Where auth-js keeps the session: supabase-js's own default, `sb-<project ref>-auth-token`, named here so `forgetStoredSession` can find it. */
let storageKey = ''

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    )
  }

  storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  // PKCE (CLIENT-SEC-04): a session comes from the address bar only as a code
  // whose verifier this browser stored when it started that sign-in, so a link
  // carrying another account's tokens cannot replace the session. Nothing here
  // signs in through an implicit link: the email code is checked by verifyOtp,
  // an invite sends no link, and Google (D08, when switched on) returns a code.
  // URL detection stays on for that Google return.
  client = createClient(url, key, { auth: { flowType: 'pkce', storageKey } })
  return client
}

/**
 * Drops this browser's stored session without asking Auth. With an expired
 * access token whose refresh cannot reach Auth (offline), auth-js's signOut
 * returns that error before it clears anything, whatever the scope (2.117.1,
 * `_signOut`); the sign-out button calls this then, so the device is signed
 * out anyway.
 */
export function forgetStoredSession(): void {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Storage is unavailable: auth-js kept nothing there.
  }
}
