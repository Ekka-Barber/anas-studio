// Shared helpers for the e2e suites (P03/P04): the local Supabase service
// client, test users and Mailpit/TOTP code reading. Extracted from
// `auth.spec.ts` so `cms.spec.ts` can reuse them without duplication.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

type Status = {
  API_URL: string
  MAILPIT_URL: string
  SECRET_KEY: string
  DB_URL: string
  PUBLISHABLE_KEY: string
}

export function readStatus(): Status {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const status = JSON.parse(raw) as Status
  const host = new URL(status.API_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Refusing: supabase status API_URL is not a local host.')
  }
  return status
}

export const status = readStatus()
export const serviceClient = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** A fresh client authenticated as no one, using the publishable key — reads what any site visitor can. */
export function anonClient() {
  return createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * "Tomorrow" at `hhmm` Riyadh wall-clock time, as an `<input type="datetime-local">`
 * value (the format `PublishBar`'s `riyadhLocalToIso` expects).
 */
export function tomorrowRiyadhLocal(hhmm = '10:00'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number]
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1))
  const yyyy = tomorrow.getUTCFullYear()
  const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(tomorrow.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hhmm}`
}

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

export async function createOwner(displayName: string): Promise<string> {
  const email = uniqueEmail('e2e-owner')
  const { data, error } = await serviceClient.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createOwner: ${error?.message}`)
  const { error: staffError } = await serviceClient
    .from('staff')
    .insert({ user_id: data.user.id, display_name: displayName, role: 'owner' })
  if (staffError) throw new Error(`createOwner: ${staffError.message}`)
  return email
}

/** Creates a staff member directly with the local service key (P05 media spec). */
export async function createStaff(role: 'owner' | 'editor' | 'operations'): Promise<{ userId: string; email: string }> {
  const email = uniqueEmail(`e2e-${role}`)
  const { data, error } = await serviceClient.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createStaff: ${error?.message}`)
  const { error: staffError } = await serviceClient
    .from('staff')
    .insert({ user_id: data.user.id, display_name: email, role })
  if (staffError) throw new Error(`createStaff: ${staffError.message}`)
  return { userId: data.user.id, email }
}

/** A staff member's access token, obtained the way the browser does: email code. */
export async function staffAccessToken(email: string): Promise<string> {
  const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) throw new Error(`staffAccessToken: ${error?.message}`)
  const client = anonClient()
  const { error: verifyError } = await client.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: 'email',
  })
  if (verifyError) throw new Error(`staffAccessToken: ${verifyError.message}`)
  const { data: session } = await client.auth.getSession()
  if (!session.session) throw new Error('staffAccessToken: no session after verifyOtp')
  return session.session.access_token
}

/**
 * Reads the 6-digit sign-in code Supabase Auth just sent through Mailpit.
 * Pass the previous code to wait for a newer email instead of re-reading it.
 */
export async function readCodeFromMailpit(email: string, previousCode?: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = (await fetch(
      `${status.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((r) => r.json())) as { messages?: { ID: string }[] }
    const latest = search.messages?.[0]
    if (latest) {
      const message = (await fetch(`${status.MAILPIT_URL}/api/v1/message/${latest.ID}`).then((r) =>
        r.json(),
      )) as { Text?: string; HTML?: string }
      const match = (message.Text ?? message.HTML ?? '').match(/\b\d{6}\b/)
      if (match && match[0] !== previousCode) return match[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No sign-in code email found for ${email}`)
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP, 30-second step, 6 digits — computed from the secret shown on the page. */
export function totpCode(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30)
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

export const SENT_MESSAGE = 'إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رمزًا من 6 أرقام.'

/** Signs in at `/admin/sign-in` by email code and waits for `/admin`. */
export async function signInByCode(page: Page, email: string, previousCode?: string): Promise<void> {
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
  const code = await readCodeFromMailpit(email, previousCode)
  await page.getByLabel('رمز الدخول').fill(code)
  await page.getByRole('button', { name: 'تحقق' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}
