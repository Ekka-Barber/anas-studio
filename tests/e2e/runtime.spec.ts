import { expect, test, type Page } from '@playwright/test'

/**
 * P00 runtime spike proof — Worker suite (D29).
 *
 * The Payload admin, authentication, REST/GraphQL writes and the Oracle VM
 * node admin target are withdrawn (D29): a custom Supabase admin replaces
 * them, outside this Worker. This file proves the Worker's narrow contract:
 *
 *  - the public route renders Arabic right-to-left,
 *  - `/api/health` answers through `app_server`,
 *  - `POST /api/revalidate` rejects a request with no secret.
 *
 * Synthetic data only. Credentials come from the environment.
 */

const evidenceDir = './artifacts/acceptance/P00/screenshots'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true })
}

test.describe.configure({ mode: 'serial' })

test('public route renders Arabic right-to-left', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await shot(page, '01-public-home')
})

test('GET /api/health answers 200 with ok:true, through app_server', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  const body = (await health.json()) as {
    ok: boolean
    data: { status: string; database: { ok: boolean; latencyMs: number } }
  }
  expect(body.ok).toBe(true)
  expect(body.data.status).toBe('ok')
  expect(body.data.database.ok).toBe(true)
  const raw = await health.text()
  expect(raw).not.toContain('postgres')
  expect(raw).not.toContain('HYPERDRIVE')
})

test('POST /api/revalidate without a secret is refused', async ({ request }) => {
  // Unconfigured means unavailable: 404. Configured with the wrong bearer: 401.
  // Either is a refusal — this is never a success without proof of the secret.
  const noAuth = await request.post('/api/revalidate', { data: { tags: ['test'] } })
  expect([401, 404]).toContain(noAuth.status())
})
