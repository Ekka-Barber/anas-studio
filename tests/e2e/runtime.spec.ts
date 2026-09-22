import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * P00 runtime spike proof.
 *
 * Everything here runs against the real OpenNext Worker artifact served by
 * `wrangler dev`, with the HYPERDRIVE binding pointed at a disposable local
 * PostgreSQL container and the R2 binding backed by wrangler's local object
 * store. It proves the combination, not a mock:
 *
 *  - a custom API route coexists with Payload's REST catch-all,
 *  - native Payload auth bootstraps, logs in and logs out,
 *  - one collection row is created, read and updated,
 *  - a Lexical rich-text field saves and produces a second version that restores,
 *  - an uploaded object round-trips through R2 and is denied to an anonymous reader,
 *  - the bounded scheduled task runs through the Worker `scheduled` handler.
 *
 * Synthetic data only. Credentials come from the environment.
 */

const OWNER_EMAIL = 'p00-owner@example.invalid'
const OWNER_PASSWORD = process.env.P00_OWNER_PASSWORD ?? 'P00-spike-Passw0rd!'

const evidenceDir = './artifacts/acceptance/P00/screenshots'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true })
}

/**
 * Signs in through Payload's REST API and returns an `Authorization` header
 * value. The JWT strategy is used rather than the cookie jar so that every
 * request's identity is explicit, and an unauthenticated request is genuinely
 * unauthenticated.
 */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/users/login', {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  })
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as { token?: string }
  expect(body.token, 'login must return a session token').toBeTruthy()
  return `JWT ${body.token}`
}

function lexicalParagraph(text: string) {
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'rtl',
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          direction: 'rtl',
          textFormat: 0,
          children: [
            { type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 },
          ],
        },
      ],
    },
  }
}

test.describe.configure({ mode: 'serial' })

test('public route renders Arabic right-to-left', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await shot(page, '01-public-home')
})

test('custom /api/health answers beside the Payload REST catch-all', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  const body = (await health.json()) as {
    ok: boolean
    data: { status: string; database: { ok: boolean; latencyMs: number } }
  }
  expect(body.ok).toBe(true)
  expect(body.data.status).toBe('ok')
  expect(body.data.database.ok).toBe(true)
  // The health response must never leak configuration.
  const raw = await health.text()
  expect(raw).not.toContain('postgres')
  expect(raw).not.toContain('HYPERDRIVE')

  // Same /api prefix, handled by Payload's catch-all rather than the route above.
  const payloadRoute = await request.get('/api/users/me')
  expect(payloadRoute.status()).toBe(200)
  expect(await payloadRoute.text()).toContain('"user"')

  // A collection that requires a session is refused for an anonymous caller.
  const denied = await request.get('/api/runtime-probe')
  expect(denied.status()).toBe(403)
})

/**
 * Reaches an authenticated admin session through the native UI, bootstrapping
 * the single owner out of band the first time. Works against both a fresh
 * database and one that already holds the owner.
 */
async function signInToAdmin(page: Page, screenshotPrefix: string): Promise<void> {
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  if (page.url().includes('create-first-user')) {
    await page.locator('#field-email').waitFor({ state: 'visible' })
    await page.locator('#field-email').fill(OWNER_EMAIL)
    await page.locator('#field-password').fill(OWNER_PASSWORD)
    await page.locator('#field-confirm-password').fill(OWNER_PASSWORD)
    await shot(page, `${screenshotPrefix}-create-first-user`)
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForURL((url) => !url.pathname.includes('create-first-user'), { timeout: 60_000 })
    return
  }

  if (page.url().includes('/login')) {
    await page.locator('#field-email').waitFor({ state: 'visible' })
    await page.locator('#field-email').fill(OWNER_EMAIL)
    await page.locator('#field-password').fill(OWNER_PASSWORD)
    await shot(page, `${screenshotPrefix}-login`)
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 })
  }
}

test('native Payload auth bootstraps one owner, logs in and logs out', async ({ page }) => {
  await signInToAdmin(page, '02')

  await expect(page.locator('body')).toBeVisible()
  expect(page.url()).not.toContain('/login')
  await shot(page, '03-admin-dashboard')

  await page.goto('/admin/logout')
  await page.waitForLoadState('networkidle')
  await shot(page, '04-admin-logout')

  // After logout the admin must require a session again.
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  expect(page.url()).toContain('/admin/login')

  await signInToAdmin(page, '05')
  expect(page.url()).not.toContain('/login')
  await shot(page, '06-admin-signed-in-again')
})

test('collection row: create, read, update, and a second Lexical version restores', async ({
  request,
}) => {
  const authorization = await apiLogin(request)
  const headers = { authorization, 'content-type': 'application/json' }

  const created = await request.post('/api/runtime-probe', {
    headers,
    data: {
      title: 'فحص التشغيل',
      body: lexicalParagraph('النسخة الأولى'),
      _status: 'published',
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const { doc } = (await created.json()) as { doc: { id: string; title: string } }
  expect(doc.title).toBe('فحص التشغيل')

  const read = await request.get(`/api/runtime-probe/${doc.id}`, { headers })
  expect(read.status()).toBe(200)

  const updated = await request.patch(`/api/runtime-probe/${doc.id}`, {
    headers,
    data: {
      title: 'فحص التشغيل — معدّل',
      body: lexicalParagraph('النسخة الثانية'),
      _status: 'published',
    },
  })
  expect(updated.status(), await updated.text()).toBe(200)
  const updatedBody = (await updated.json()) as { doc: { title: string } }
  expect(updatedBody.doc.title).toBe('فحص التشغيل — معدّل')

  const versions = await request.get(
    `/api/runtime-probe/versions?where[parent][equals]=${doc.id}&limit=20&sort=-updatedAt`,
    { headers },
  )
  expect(versions.status()).toBe(200)
  const versionList = (await versions.json()) as {
    totalDocs: number
    docs: { id: string; version: { title: string } }[]
  }
  expect(versionList.totalDocs).toBeGreaterThanOrEqual(2)

  // Restore the oldest recorded version and confirm the document reverts.
  const oldest = versionList.docs[versionList.docs.length - 1]
  expect(oldest).toBeDefined()
  const restored = await request.post(`/api/runtime-probe/versions/${oldest!.id}`, { headers })
  expect(restored.status(), await restored.text()).toBe(200)

  const afterRestore = await request.get(`/api/runtime-probe/${doc.id}?draft=true`, { headers })
  const afterRestoreBody = (await afterRestore.json()) as { title: string }
  expect(afterRestoreBody.title).toBe(oldest!.version.title)
})

test('R2 object round-trips and is denied to an anonymous reader', async ({ request, baseURL }) => {
  const authorization = await apiLogin(request)

  const bytes = Buffer.from('P00 runtime spike synthetic object\n', 'utf8')
  const upload = await request.post('/api/runtime-probe-media', {
    headers: { authorization },
    multipart: {
      file: { name: 'p00-probe.txt', mimeType: 'text/plain', buffer: bytes },
      _payload: JSON.stringify({ alt: 'ملف فحص' }),
    },
  })
  expect(upload.status(), await upload.text()).toBe(201)
  const { doc } = (await upload.json()) as { doc: { id: string; filename: string } }
  expect(doc.filename).toBeTruthy()

  const authorized = await request.get(`/api/runtime-probe-media/file/${doc.filename}`, {
    headers: { authorization },
  })
  expect(authorized.status()).toBe(200)
  expect((await authorized.body()).toString('utf8')).toContain('P00 runtime spike synthetic object')

  // A completely separate context: no token, no cookie jar.
  const anonymous = await playwrightRequest.newContext({ baseURL })
  const refused = await anonymous.get(`/api/runtime-probe-media/file/${doc.filename}`)
  expect([401, 403, 404]).toContain(refused.status())
  await anonymous.dispose()
})

test('bounded scheduled task runs through the Worker scheduled handler', async ({ request }) => {
  // A tick never runs the job it just queued: Payload's `handleSchedules`
  // queues the task with `waitUntil` set to the *next* cron slot, and `runJobs`
  // only picks up jobs whose `waitUntil` has passed. On a database that has
  // never scheduled this task, that slot is up to one full cron period away
  // (`*/15`), so the first completion can be fifteen minutes after the first
  // tick. That is the real behaviour of this pairing, so the test drives ticks
  // until the job actually completes and allows more than one period.
  test.setTimeout(20 * 60 * 1000)

  const authorization = await apiLogin(request)

  const tick = async () => {
    // wrangler dev exposes the Worker's scheduled handler for local invocation.
    const triggered = await request.get('/cdn-cgi/handler/scheduled?cron=*%2F15+*+*+*+*')
    expect(triggered.status(), await triggered.text()).toBe(200)
  }

  // `payload-jobs` is a private internal collection, so job completion is read
  // through the health endpoint, which queries the newest completed job
  // server-side. Completed jobs are retained deliberately (`deleteJobOnComplete:
  // false`); with Payload's default the row is deleted the instant it succeeds
  // and no completion is ever observable.
  const lastJobCompletedAt = async (): Promise<string | null> => {
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
    const body = (await health.json()) as { data: { jobs: { lastCompletedAt: string | null } } }
    return body.data.jobs.lastCompletedAt
  }

  // A completion left behind by an earlier run must not satisfy this test. The
  // job has to complete *again*, while this test is the one driving the ticks.
  const before = await lastJobCompletedAt()

  const deadline = Date.now() + 18 * 60 * 1000
  let completedAt = before
  while (completedAt === before && Date.now() < deadline) {
    await tick()
    completedAt = await lastJobCompletedAt()
    if (completedAt === before) {
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
  }

  expect(completedAt, 'the scheduled probeHeartbeat job must complete').not.toBeNull()
  expect(completedAt, 'a completion recorded before this test started does not count').not.toBe(
    before,
  )

  // The task wrote to the database, so the scheduled path reached PostgreSQL
  // through the same binding a request uses.
  const probes = await request.get('/api/runtime-probe?limit=1&sort=-createdAt&depth=0', {
    headers: { authorization },
  })
  expect(probes.status()).toBe(200)
  const list = (await probes.json()) as { docs: { lastScheduledRunAt: string | null }[] }
  expect(list.docs[0]).toBeDefined()
  const writtenAt = list.docs[0]!.lastScheduledRunAt
  expect(writtenAt).not.toBeNull()
  // ...and it wrote during this run, not during an earlier one.
  expect(new Date(writtenAt!).getTime()).toBeGreaterThan(new Date(before ?? 0).getTime())
})
