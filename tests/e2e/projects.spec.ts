// P12 round R2 e2e: the projects board («لوحة المشاريع») in the browser on `next dev`, against the real local stack with
// real sign-in (an email code read from Mailpit, once per person). It runs at 1440 and at 360:
// - an owner makes a project, two columns and two cards through the screens;
// - a member (a project's person with the role `member`, seeded through the board's own functions as an owner) moves a card
//   by mouse (held 250 ms), by keyboard (Space, an arrow, Space; the side arrows follow the reading direction, so on this
//   right-to-left board the left arrow goes to the next column) and by «نقل إلى…», and each move survives a reload;
// - a viewer sees the cards and has no move control and no «بطاقة جديدة»;
// - a person whose staff role is `board` lands on «مهامي», is sent there from `/admin/store`, and has «المشاريع» and
//   «الأمان» in the rail and nothing else.
// The local database holds hundreds of test owners, and every active owner is a person of every project, so no test counts
// people. Screenshots land in projects-*.png under shotsDir('P12'): test-results/screenshots/P12 (git-ignored) unless an
// ACCEPTANCE_PACKAGE=P12 run files them under the package. The spec retires what it made: its projects are archived and
// deleted, and its people are made inactive.
import { mkdirSync, rmSync } from 'node:fs'

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

import { anonClient, mailsTo, readCodeFromMailpit, SENT_MESSAGE, serviceClient, signInByCode, status, uniqueEmail } from './helpers'
import { shotsDir } from './shots'

const SHOTS = shotsDir('P12')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const STATES = {
  owner: 'test-results/projects/owner.json',
  member: 'test-results/projects/member.json',
  viewer: 'test-results/projects/viewer.json',
  board: 'test-results/projects/board.json',
}
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
// 1440 is 1200 high: a card carried near the foot of the window sets the page scrolling (dnd-kit's auto-scroll), and a drag
// that a test aims at screen coordinates must not meet that.
const VIEWS = [
  { width: 1440, height: 1200, label: '1440' },
  { width: 360, height: 800, label: '360' },
] as const

type Person = { id: string; email: string }
let people: { owner: Person; member: Person; viewer: Person; board: Person }
let owner: SupabaseClient
let db: Client
const projects: string[] = []

test.describe.configure({ mode: 'serial', timeout: 120_000 })

async function makePerson(role: 'owner' | 'editor' | 'operations' | 'board', name: string): Promise<Person> {
  const email = uniqueEmail(`p12-${role}`)
  const { data, error } = await serviceClient.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`makePerson: ${error?.message}`)
  const { error: staffError } = await serviceClient.from('staff').insert({ user_id: data.user.id, display_name: name, role })
  if (staffError) throw new Error(`makePerson: ${staffError.message}`)
  return { id: data.user.id, email }
}

/** A signed-in API client for a person (a one-time code made by the service key, as the integration tests do). */
async function apiClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) throw new Error(`apiClient: ${error?.message}`)
  const client = anonClient()
  const { error: verifyError } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' })
  if (verifyError) throw new Error(`apiClient: ${verifyError.message}`)
  return client
}

async function rpc<T = any>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message} ${error.details ?? ''}`)
  return data as T
}

/** The sign-in of the board-only role lands on «مهامي», which `signInByCode` (it waits for `/admin`) does not expect. */
async function signInBoard(page: Page, email: string): Promise<void> {
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await expect(page.getByRole('button', { name: 'أرسل الرمز' })).toBeEnabled()
  const seen = new Set((await mailsTo(email)).map((mail) => mail.id))
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
  await page.getByLabel('رمز الدخول').fill(await readCodeFromMailpit(email, undefined, seen))
  await page.getByRole('button', { name: 'تحقق' }).click()
  await expect(page).toHaveURL(/\/admin\/projects\/mine$/)
}

async function saveSession(browser: Browser, email: string, path: string, land: (page: Page) => Promise<void>): Promise<void> {
  // An empty state of its own: a context made here would otherwise start from the state a test group names.
  const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', storageState: { cookies: [], origins: [] } })
  await land(await context.newPage())
  await context.storageState({ path })
  await context.close()
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  people = {
    owner: await makePerson('owner', 'مالك الاختبار'),
    member: await makePerson('editor', 'مشارك الاختبار'),
    viewer: await makePerson('operations', 'مُطّلع الاختبار'),
    board: await makePerson('board', 'منسق الاختبار'),
  }
  // One real sign-in per person; the tests start from the session it left.
  await saveSession(browser, people.owner.email, STATES.owner, (page) => signInByCode(page, people.owner.email))
  await saveSession(browser, people.member.email, STATES.member, (page) => signInByCode(page, people.member.email))
  await saveSession(browser, people.viewer.email, STATES.viewer, (page) => signInByCode(page, people.viewer.email))
  await saveSession(browser, people.board.email, STATES.board, (page) => signInBoard(page, people.board.email))
  owner = await apiClient(people.owner.email)
  // `next dev` compiles a page on its first request: do it once, before any test has a clock running.
  for (const route of ['/admin/sign-in', '/admin', '/admin/projects', '/admin/projects/view', '/admin/projects/mine', '/admin/store']) {
    await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
  }
})

test.afterAll(async () => {
  rmSync('test-results/projects', { recursive: true, force: true })
  try {
    for (const id of projects) {
      const current = await rpc<{ version: number }>(owner, 'board_project_archive', { p_project: id, p_version: (await projectVersion(id)) })
      await rpc(owner, 'board_project_delete', { p_project: id, p_version: current.version })
    }
    // The projects made through the screens carry this run's marker in their name.
    const { rows } = await db.query<{ id: string; version: number }>("select id, version from board.projects where name like $1", [`%${marker}%`])
    for (const row of rows) {
      const archived = await rpc<{ version: number }>(owner, 'board_project_archive', { p_project: row.id, p_version: row.version })
      await rpc(owner, 'board_project_delete', { p_project: row.id, p_version: archived.version })
    }
  } finally {
    // Inactive people leave every project's list (every active owner is a person of every project).
    await db.query('update public.staff set active = false where user_id = any($1::uuid[])', [Object.values(people).map((person) => person.id)])
    await db.end()
  }
})

async function projectVersion(id: string): Promise<number> {
  return (await db.query<{ version: number }>('select version from board.projects where id = $1', [id])).rows[0]!.version
}

// ---- the board, as the tests read it ------------------------------------------------------------------------------

type Seed = { project: string; url: string; cards: Record<'first' | 'second' | 'third' | 'fourth', string> }

/** A project through the board's own functions: «أفكار» with three cards, «قيد العمل» with one, and the three people on it. */
async function seed(label: string): Promise<Seed> {
  const project = await rpc<{ id: string }>(owner, 'board_project_create', { p_name: `مشروع الاختبار ${label} ${marker}` })
  projects.push(project.id)
  await rpc(owner, 'board_person_set', { p_project: project.id, p_user: people.member.id, p_role: 'member' })
  await rpc(owner, 'board_person_set', { p_project: project.id, p_user: people.viewer.id, p_role: 'viewer' })
  await rpc(owner, 'board_person_set', { p_project: project.id, p_user: people.board.id, p_role: 'member' })
  const ideas = await rpc<{ id: string }>(owner, 'board_column_create', { p_project: project.id, p_name: 'أفكار' })
  const doing = await rpc<{ id: string }>(owner, 'board_column_create', { p_project: project.id, p_name: 'قيد العمل' })
  const make = async (column: string, title: string) => (await rpc<{ id: string }>(owner, 'board_card_create', { p_column: column, p_title: title })).id
  const first = await make(ideas.id, 'بطاقة أولى')
  const second = await make(ideas.id, 'بطاقة ثانية')
  const third = await make(ideas.id, 'بطاقة ثالثة')
  const fourth = await make(doing.id, 'بطاقة رابعة')
  // The third is the board-only person's: due today, so «مهامي» has it under «اليوم».
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
  const card = (await rpc<{ cards: Array<{ id: string; version: number }> }>(owner, 'board_project', { p_project: project.id })).cards.find((entry) => entry.id === third)!
  await rpc(owner, 'board_card_update', { p_card: third, p_version: card.version, p_changes: { people: [people.board.id], dueOn: today } })
  return { project: project.id, url: `/admin/projects/view?id=${project.id}`, cards: { first, second, third, fourth } }
}

/** The titles of a column's open cards as the database holds them, top to bottom (what a reload will draw). */
async function serverOrder(project: string, name: string): Promise<string[]> {
  const read = await rpc<{ columns: Array<{ id: string; name: string }>; cards: Array<{ columnId: string; position: number; title: string }> }>(owner, 'board_project', { p_project: project })
  const id = read.columns.find((entry) => entry.name === name)!.id
  return read.cards.filter((entry) => entry.columnId === id).sort((a, b) => a.position - b.position).map((entry) => entry.title)
}

const column = (page: Page, name: string): Locator => page.getByRole('group', { name, exact: true })
const card = (page: Page, title: string): Locator => page.locator('[data-card]', { hasText: title })
/** The titles of a column's cards, top to bottom. */
const order = async (page: Page, name: string): Promise<string[]> => column(page, name).locator('[data-card] > p:first-child').allInnerTexts()
const moved = (page: Page) => page.waitForResponse((response) => response.url().includes('/rpc/board_card_move') && response.request().method() === 'POST')
const heard = (page: Page): Locator => page.locator('[id^="DndLiveRegion"]')

/** A mouse drag as the board wants it: press, hold 250 ms (and a little more), then move to the card's edge and release. */
async function drag(page: Page, from: Locator, to: Locator, edge: 'above' | 'below'): Promise<void> {
  // Both cards in view, at once (the page scrolls smoothly otherwise): a mouse works on the screen's coordinates, and on a phone the board starts below the fold.
  await to.evaluate((element) => element.closest('[role=group]')?.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(350)
  await page.mouse.move(a.x + a.width / 2 - 20, a.y + a.height / 2 - 10, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, edge === 'above' ? b.y + 6 : b.y + b.height - 6, { steps: 12 })
  const done = moved(page)
  await page.mouse.up()
  await done
}

for (const view of VIEWS) {
  test.describe(`the projects board at ${view.label}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } })
    let board: Seed

    test.beforeAll(async () => {
      board = await seed(view.label)
    })

    test.describe('an owner', () => {
      test.use({ storageState: STATES.owner })

      test('makes a project, two columns and two cards', async ({ page }) => {
        const name = `مشروع من الشاشة ${view.label} ${marker}`
        await page.goto('/admin/projects')
        await page.getByRole('button', { name: 'مشروع جديد' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('اسم المشروع').fill(name)
        await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
        await expect(page).toHaveURL(/\/admin\/projects\/view\?id=[0-9a-f-]{36}$/)
        await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
        // Every active owner is a person of the project: the row stays short, with the rest as a count, never a list.
        expect((await page.locator('ul[aria-label="الأشخاص"]').boundingBox())!.height).toBeLessThan(140)

        for (const columnName of ['أفكار', 'قيد العمل']) {
          await page.getByRole('button', { name: 'عمود جديد' }).click()
          await page.getByRole('dialog').getByLabel('اسم العمود').fill(columnName)
          await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click()
          await expect(page.getByRole('heading', { level: 2, name: columnName, exact: true })).toBeVisible()
        }
        // «بطاقة جديدة» opens the composer of the first column that can take cards, at every width.
        for (const title of ['بطاقة من الشاشة 1', 'بطاقة من الشاشة 2']) {
          await page.getByRole('button', { name: 'بطاقة جديدة', exact: true }).click()
          await page.getByLabel('العنوان').fill(title)
          await page.getByRole('button', { name: 'حفظ', exact: true }).click()
          await expect(card(page, title)).toBeVisible()
        }
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة من الشاشة 1', 'بطاقة من الشاشة 2'])
        // The cards made were saved: they are still there after a reload.
        await page.reload()
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة من الشاشة 1', 'بطاقة من الشاشة 2'])
        await page.screenshot({ path: `${SHOTS}/projects-owner-board-${view.label}.png` })
      })

      test('sees the project among the doors, and its board', async ({ page }) => {
        await page.goto('/admin/projects')
        const door = page.getByRole('link', { name: new RegExp(`مشروع الاختبار ${view.label} ${marker}`) })
        await expect(door).toContainText(/بطاق/)
        await page.screenshot({ path: `${SHOTS}/projects-home-${view.label}.png` })
        await door.click()
        await expect(card(page, 'بطاقة أولى')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      })
    })

    test.describe('a member', () => {
      test.use({ storageState: STATES.member })

      test('moves a card by mouse, by keyboard and by «نقل إلى…», and each move survives a reload', async ({ page }) => {
        await page.goto(board.url)
        await expect(card(page, 'بطاقة أولى')).toBeVisible()
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة أولى', 'بطاقة ثانية', 'بطاقة ثالثة'])
        // «نقل إلى…» is on every card at every width.
        await expect(page.getByRole('button', { name: /^نقل إلى…/ })).toHaveCount(view.width >= 768 ? 4 : 3)

        // By mouse: the third above the first.
        await drag(page, card(page, 'بطاقة ثالثة'), card(page, 'بطاقة أولى'), 'above')
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة أولى', 'بطاقة ثانية'])
        expect(await serverOrder(board.project, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة أولى', 'بطاقة ثانية'])
        await page.reload()
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة أولى', 'بطاقة ثانية'])

        // By keyboard: Space lifts, the up arrow takes the second above the first, Space puts it down.
        await card(page, 'بطاقة ثانية').focus()
        await page.keyboard.press('Space')
        await expect(heard(page)).toHaveText('رُفعت البطاقة «بطاقة ثانية».')
        await page.keyboard.press('ArrowUp')
        await expect(heard(page)).toHaveText(/^البطاقة في «أفكار»، الموضع 2 من 3\.$/)
        const keyed = moved(page)
        await page.keyboard.press('Space')
        await keyed
        await expect(heard(page)).toHaveText('وُضعت البطاقة في «أفكار».')
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة ثانية', 'بطاقة أولى'])
        expect(await serverOrder(board.project, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة ثانية', 'بطاقة أولى'])
        await expect(card(page, 'بطاقة ثانية')).toBeFocused()
        await page.reload()
        await expect.poll(() => order(page, 'أفكار')).toEqual(['بطاقة ثالثة', 'بطاقة ثانية', 'بطاقة أولى'])

        if (view.width >= 768) {
          // On a right-to-left board the left arrow goes to the next column, the right arrow back to the previous one.
          await card(page, 'بطاقة ثانية').focus()
          await page.keyboard.press('Space')
          await expect(heard(page)).toHaveText('رُفعت البطاقة «بطاقة ثانية».')
          await page.keyboard.press('ArrowLeft')
          await expect(heard(page)).toHaveText(/^البطاقة في «قيد العمل»/)
          const across = moved(page)
          await page.keyboard.press('Space')
          await across
          await expect(column(page, 'قيد العمل').locator('[data-card]', { hasText: 'بطاقة ثانية' })).toBeVisible()
          expect(await serverOrder(board.project, 'قيد العمل')).toContain('بطاقة ثانية')
          await page.reload()
          await expect(column(page, 'قيد العمل').locator('[data-card]', { hasText: 'بطاقة ثانية' })).toBeVisible()
          await card(page, 'بطاقة ثانية').focus()
          await page.keyboard.press('Space')
          await expect(heard(page)).toHaveText('رُفعت البطاقة «بطاقة ثانية».')
          await page.keyboard.press('ArrowRight')
          await expect(heard(page)).toHaveText(/^البطاقة في «أفكار»/)
          const back = moved(page)
          await page.keyboard.press('Space')
          await back
          await expect(column(page, 'أفكار').locator('[data-card]', { hasText: 'بطاقة ثانية' })).toBeVisible()
          // Escape puts a lifted card back where it was, and says so.
          await card(page, 'بطاقة ثانية').focus()
          await page.keyboard.press('Space')
          await expect(heard(page)).toHaveText('رُفعت البطاقة «بطاقة ثانية».')
          await page.keyboard.press('ArrowLeft')
          await expect(heard(page)).toHaveText(/^البطاقة في «قيد العمل»/)
          await page.keyboard.press('Escape')
          await expect(heard(page)).toHaveText('أُلغي النقل.')
          await expect(column(page, 'أفكار').locator('[data-card]', { hasText: 'بطاقة ثانية' })).toBeVisible()
        }

        // By «نقل إلى…»: the first card to the head of «قيد العمل».
        const before = (await serverOrder(board.project, 'قيد العمل')).length
        await page.getByRole('button', { name: 'نقل إلى… «بطاقة أولى»' }).click()
        const menu = page.getByRole('dialog')
        await menu.getByRole('button', { name: 'قيد العمل', exact: true }).click()
        await expect(menu.getByRole('button', { name: new RegExp(`^الموضع \\d+ من ${before + 1}$`) })).toHaveCount(before + 1)
        await page.screenshot({ path: `${SHOTS}/projects-move-menu-${view.label}.png` })
        const menuMove = moved(page)
        await menu.getByRole('button', { name: `الموضع 1 من ${before + 1}` }).click()
        await menuMove
        // The moved card is where it was sent and has the focus (on a phone the board shows its column).
        await expect(column(page, 'قيد العمل').locator('[data-card]').first()).toContainText('بطاقة أولى')
        await expect(card(page, 'بطاقة أولى')).toBeFocused()
        expect((await serverOrder(board.project, 'قيد العمل'))[0]).toBe('بطاقة أولى')
        await page.reload()
        if (view.width < 768) await page.getByRole('button', { name: /^قيد العمل/ }).click()
        await expect(column(page, 'قيد العمل').locator('[data-card]').first()).toContainText('بطاقة أولى')
        await page.screenshot({ path: `${SHOTS}/projects-member-board-${view.label}.png` })
      })

      test('opens a card with Enter, and a card from «مهامي»\'s kind of link (&card=)', async ({ page }) => {
        // The second card is in «أفكار», the first column, which a phone shows to begin with.
        await page.goto(board.url)
        await card(page, 'بطاقة ثانية').focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('dialog').getByLabel('العنوان')).toHaveValue('بطاقة ثانية')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toBeHidden()
        await expect(card(page, 'بطاقة ثانية')).toBeFocused()
        await page.goto(`${board.url}&card=${board.cards.fourth}`)
        await expect(page.getByRole('dialog').getByLabel('العنوان')).toHaveValue('بطاقة رابعة')
        await page.screenshot({ path: `${SHOTS}/projects-card-${view.label}.png` })
        await page.keyboard.press('Escape')
        await expect(page).not.toHaveURL(/card=/)
      })
    })

    test.describe('a viewer', () => {
      test.use({ storageState: STATES.viewer })

      test('sees the cards, has no move control and no «بطاقة جديدة», and cannot save a card', async ({ page }) => {
        await page.goto(board.url)
        await expect(card(page, 'بطاقة ثانية')).toBeVisible()
        await expect(page.getByRole('button', { name: /^نقل إلى…/ })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'بطاقة جديدة', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: /^بطاقة جديدة في/ })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'عمود جديد' })).toHaveCount(0)
        await card(page, 'بطاقة ثانية').click()
        const dialog = page.getByRole('dialog')
        // A viewer's text fields are read-only, not disabled: they take the focus (long notes scroll) and change nothing.
        await expect(dialog.getByLabel('العنوان')).not.toBeEditable()
        await expect(dialog.getByLabel('الملاحظات')).not.toBeEditable()
        await dialog.getByLabel('الملاحظات').focus()
        await expect(dialog.getByLabel('الملاحظات')).toBeFocused()
        await expect(dialog.getByRole('radio', { name: 'عاجل' })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: 'حفظ', exact: true })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: 'أرشفة البطاقة' })).toHaveCount(0)
        await page.screenshot({ path: `${SHOTS}/projects-viewer-${view.label}.png` })
      })
    })

    test.describe('a board-only person', () => {
      test.use({ storageState: STATES.board })

      test('lands on «مهامي», is sent there from /admin/store, and sees only «المشاريع» and «الأمان»', async ({ page }) => {
        await page.goto('/admin/store')
        await expect(page).toHaveURL(/\/admin\/projects\/mine$/)
        await page.goto('/admin')
        await expect(page).toHaveURL(/\/admin\/projects\/mine$/)
        await expect(page.getByRole('heading', { level: 1, name: 'مهامي' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'لوحة التحكم' }).getByRole('link')).toHaveText(['المشاريع', 'الأمان'])
        // The card assigned to this person, due today, is under «اليوم» and opens on its board.
        const today = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'اليوم', exact: true }) })
        // The projects of the other width are still there: this one's card is the link to its own project.
        const mine = today.locator(`a[href$="id=${board.project}&card=${board.cards.third}"]`)
        await expect(mine).toHaveText('بطاقة ثالثة')
        await page.screenshot({ path: `${SHOTS}/projects-mine-${view.label}.png` })
        await mine.click()
        await expect(page).toHaveURL(new RegExp(`/admin/projects/view\\?id=${board.project}&card=${board.cards.third}$`))
        await expect(page.getByRole('dialog').getByLabel('العنوان')).toHaveValue('بطاقة ثالثة')
        // «الأمان» is the one other screen it keeps.
        await page.goto('/admin/security')
        await expect(page).toHaveURL(/\/admin\/security$/)
      })
    })
  })
}
