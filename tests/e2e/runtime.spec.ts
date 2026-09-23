import { expect, test, type Page } from '@playwright/test'

/**
 * P00 runtime spike proof — Worker suite (I19/I20/D27).
 *
 * The Payload admin, authentication, REST/GraphQL writes and the job runner
 * moved to a Node server on the Oracle VM (I19/D27). This file now proves the
 * Worker's *narrower* contract only:
 *
 *  - the public route renders Arabic right-to-left,
 *  - `/admin` and `/admin/*` redirect to the admin origin rather than serving
 *    anything,
 *  - `/api/*` is refused (404) except `/api/health` and `POST /api/revalidate`
 *    — this is what keeps Payload's REST/GraphQL surface, and its broken
 *    PBKDF2 login path (I17), unreachable through the Worker,
 *  - `/api/health` still answers,
 *  - `POST /api/revalidate` rejects a bad or missing secret,
 *  - the public probe page 404s when there is no published document.
 *
 * Removed, not skipped: the admin bootstrap/login/logout test, the collection
 * CRUD + Lexical version test, the R2 upload/denial test, and the bounded
 * scheduled-task test. Every one of them drove the Worker's `/admin` or
 * `/api/*` surface directly, which this Worker now refuses by design — they
 * are not "temporarily broken", they test a path that no longer exists on
 * this target. Their node-target equivalents are P00 part 2 (I19), not yet
 * written; `docs/admin-vm.md` is the runbook for that deployment.
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

test('GET /admin and /admin/* redirect to the admin origin, same path and query', async ({
  request,
}) => {
  const root = await request.get('/admin', { maxRedirects: 0 })
  expect(root.status()).toBe(308)
  expect(root.headers()['location']).toBe('https://admin.anas.studio/admin')

  const nested = await request.get('/admin/collections/runtime-probe?limit=1', {
    maxRedirects: 0,
  })
  expect(nested.status()).toBe(308)
  expect(nested.headers()['location']).toBe(
    'https://admin.anas.studio/admin/collections/runtime-probe?limit=1',
  )
})

test('/api/* is refused except /api/health and POST /api/revalidate', async ({ request }) => {
  const refused: { method: 'GET' | 'POST'; path: string }[] = [
    { method: 'GET', path: '/api/users/me' },
    { method: 'POST', path: '/api/users/login' },
    { method: 'POST', path: '/api/users/first-register' },
    { method: 'GET', path: '/api/runtime-probe' },
    { method: 'GET', path: '/api/graphql' },
    { method: 'GET', path: '/api/revalidate' }, // right path, wrong method
  ]
  for (const { method, path } of refused) {
    const response =
      method === 'GET' ? await request.get(path) : await request.post(path, { data: {} })
    expect(response.status(), `${method} ${path}`).toBe(404)
  }
})

test('GET /api/health answers and leaks no configuration', async ({ request }) => {
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

test('POST /api/revalidate rejects a bad or missing secret', async ({ request }) => {
  // Never a success without proof of the secret, whether or not
  // REVALIDATE_SECRET happens to be configured on this instance (unconfigured
  // means unavailable: 404; configured with the wrong bearer: 401).
  const noAuth = await request.post('/api/revalidate', { data: { tags: ['runtime-probe:test'] } })
  expect([401, 404]).toContain(noAuth.status())

  const badAuth = await request.post('/api/revalidate', {
    headers: { authorization: 'Bearer definitely-not-the-secret' },
    data: { tags: ['runtime-probe:test'] },
  })
  expect([401, 404]).toContain(badAuth.status())
})

test('GET /probe/[id] 404s when there is no published document', async ({ request }) => {
  const response = await request.get('/probe/00000000-0000-0000-0000-000000000000')
  expect(response.status()).toBe(404)
})
