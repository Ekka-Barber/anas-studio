// P03 end-to-end: staff sign-in, TOTP enrolment and an owner-only invite
// through the step-up dialog, against `next dev` and the local Supabase
// stack. The test owner is created directly with the local service key, read
// from `supabase status`, never from a hosted project.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

type Status = { API_URL: string; MAILPIT_URL: string; SECRET_KEY: string }

function readStatus(): Status {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const status = JSON.parse(raw) as Status
  const host = new URL(status.API_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Refusing: supabase status API_URL is not a local host.')
  }
  return status
}

const status = readStatus()
const serviceClient = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

async function createOwner(displayName: string): Promise<string> {
  const email = uniqueEmail('e2e-owner')
  const { data, error } = await serviceClient.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createOwner: ${error?.message}`)
  const { error: staffError } = await serviceClient
    .from('staff')
    .insert({ user_id: data.user.id, display_name: displayName, role: 'owner' })
  if (staffError) throw new Error(`createOwner: ${staffError.message}`)
  return email
}

/**
 * Reads the 6-digit sign-in code Supabase Auth just sent through Mailpit.
 * Pass the previous code to wait for a newer email instead of re-reading it.
 */
async function readCodeFromMailpit(email: string, previousCode?: string): Promise<string> {
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

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP, 30-second step, 6 digits — computed from the secret shown on the page. */
function totpCode(secret: string): string {
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

const SENT_MESSAGE = 'إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رمزًا من 6 أرقام.'

test('an unknown email gets the identical sent message', async ({ page }) => {
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(uniqueEmail('unknown'))
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
})

test('sign-in by code reaches /admin, enrols TOTP, and invites a member through step-up', async ({ page }) => {
  const displayName = 'مالك الاختبار'
  const email = await createOwner(displayName)

  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()

  const code = await readCodeFromMailpit(email)
  await page.getByLabel('رمز الدخول').fill(code)
  await page.getByRole('button', { name: 'تحقق' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByText(displayName, { exact: false })).toBeVisible()

  // Enrol TOTP on /admin/security.
  await page.locator('nav').getByRole('link', { name: 'الأمان' }).click()
  await expect(page).toHaveURL(/\/admin\/security$/)
  const secret = await page.locator('[class*="secret"]').innerText()
  await page.getByLabel('رمز التحقق').fill(totpCode(secret))
  await page.getByRole('button', { name: 'تفعيل' }).click()
  await expect(page.getByText('تطبيق المصادقة مفعّل')).toBeVisible()

  // Enrolling just verified a TOTP code, so the session would pass the
  // 5-minute step-up check without the dialog. Sign out and back in with an
  // email code (aal1) so the invite must go through the step-up dialog.
  await page.locator('nav').getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
  await page.getByLabel('رمز الدخول').fill(await readCodeFromMailpit(email, code))
  await page.getByRole('button', { name: 'تحقق' }).click()
  await expect(page).toHaveURL(/\/admin$/)

  // Invite a member on /admin/team, through the step-up dialog.
  await page.locator('nav').getByRole('link', { name: 'الفريق' }).click()
  await expect(page).toHaveURL(/\/admin\/team$/)
  const memberEmail = uniqueEmail('e2e-member')
  await page.getByLabel('البريد الإلكتروني').fill(memberEmail)
  await page.getByLabel('الاسم').fill('عضو الاختبار')
  await page.getByRole('button', { name: 'دعوة' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رمز التحقق').fill(totpCode(secret))
  await dialog.getByRole('button', { name: 'تحقق' }).click()

  await expect(page.getByText(memberEmail)).toBeVisible()
})
