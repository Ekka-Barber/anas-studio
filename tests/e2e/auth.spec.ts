// P03 end-to-end: staff sign-in, TOTP enrolment and an owner-only invite
// through the step-up dialog, against `next dev` and the local Supabase
// stack. The test owner is created directly with the local service key, read
// from `supabase status`, never from a hosted project.
import { expect, test } from '@playwright/test'

import { createOwner, readCodeFromMailpit, SENT_MESSAGE, totpCode, uniqueEmail } from './helpers'

test('an unknown email gets the identical sent message', async ({ page }) => {
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(uniqueEmail('unknown'))
  await expect(page.getByRole('button', { name: 'أرسل الرمز' })).toBeEnabled()
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
})

test('sign-in by code reaches /admin, enrols TOTP, and invites a member through step-up', async ({ page }) => {
  const displayName = 'مالك الاختبار'
  const email = await createOwner(displayName)

  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await expect(page.getByRole('button', { name: 'أرسل الرمز' })).toBeEnabled()
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
  await expect(page.getByRole('button', { name: 'أرسل الرمز' })).toBeEnabled()
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
