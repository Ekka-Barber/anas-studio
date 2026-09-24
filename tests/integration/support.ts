// Shared helpers for `pnpm test:db` integration specs (P03). Reads
// `supabase status -o json` once and refuses anything but a local stack —
// `vitest.config.ts` already gates the whole run on `TEST_ENV=local` and a
// loopback `DATABASE_URL`, this is the same rule applied to the API host.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

type Status = {
  API_URL: string
  FUNCTIONS_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

function readStatus(): Status {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const status = JSON.parse(raw) as Status
  const host = new URL(status.API_URL).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error('Refusing: supabase status API_URL is not a local host.')
  }
  return status
}

export const status = readStatus()

export type Role = 'owner' | 'editor' | 'operations'

/** Service-role client: bypasses RLS, used only to set up and inspect fixtures. */
export const serviceClient: SupabaseClient = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** A fresh client authenticated as no one, using the publishable key. */
export function anonClient(): SupabaseClient {
  return createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

let counter = 0
/** A unique email per run and per call, so tests can share a database. */
export function uniqueEmail(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}@example.com`
}

/** Creates a confirmed user and a staff row directly, bypassing the app. */
export async function createStaff(
  role: Role,
  overrides: { active?: boolean; email?: string } = {},
): Promise<{ userId: string; email: string }> {
  const email = overrides.email ?? uniqueEmail(role)
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (createError || !created.user) throw new Error(`createStaff: ${createError?.message}`)
  const { error: staffError } = await serviceClient
    .from('staff')
    .insert({ user_id: created.user.id, display_name: email, role, active: overrides.active ?? true })
  if (staffError) throw new Error(`createStaff: ${staffError.message}`)
  return { userId: created.user.id, email }
}

/** Signs in as `email` through a real one-time code, as the browser would. */
export async function signIn(email: string): Promise<SupabaseClient> {
  const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) throw new Error(`signIn: could not generate a link for ${email}: ${error?.message}`)
  const token = data.properties.email_otp
  const client = anonClient()
  const { error: verifyError } = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (verifyError) throw new Error(`signIn: verifyOtp failed: ${verifyError.message}`)
  return client
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error(`base32Decode: invalid character ${char}`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP, 30-second step, 6 digits — the same shape an authenticator app computes. */
function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

/** Enrols and verifies a TOTP factor on `client`'s session, reaching aal2. */
export async function stepUp(client: SupabaseClient): Promise<void> {
  const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrollError || !enrolled || enrolled.type !== 'totp') {
    throw new Error(`stepUp: enroll failed: ${enrollError?.message}`)
  }
  const code = totpCode(enrolled.totp.secret)
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code })
  if (verifyError) throw new Error(`stepUp: challengeAndVerify failed: ${verifyError.message}`)
}

export type StaffAdminReply =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } }

/** Calls the `staff-admin` Edge Function as `client`'s current session. */
export async function callStaffAdmin(client: SupabaseClient, body: Record<string, unknown>): Promise<{
  status: number
  reply: StaffAdminReply
}> {
  const { data: sessionData } = await client.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: status.PUBLISHABLE_KEY,
  }
  if (sessionData.session) headers.Authorization = `Bearer ${sessionData.session.access_token}`
  const response = await fetch(`${status.FUNCTIONS_URL}/staff-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const reply = (await response.json()) as StaffAdminReply
  return { status: response.status, reply }
}
