// F2-PAGES: the home page's room doors and the contact page's words are drawn
// from the published `site_settings` document, in the admin's order, not from
// constants in the code.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ContactPage from '../../src/app/(public)/contact/page'
import HomePage from '../../src/app/(public)/page'
import content from '../../content/initial-content.json'

// The pages and views import through the `@/` alias, which the unit config does not resolve:
// each import is redirected to the real file, except the ones that need a browser or the manifest.
vi.mock('@/components/public/Picture', () => ({ Picture: () => null }))
vi.mock('@/components/public/contact/ContactForm', () => ({ ContactForm: () => null }))
vi.mock('@/components/public/contact/ServiceRequest', () => ({
  ServiceRequest: ({ service }: { service: string }) => createElement('i', { 'data-service': service }),
}))
vi.mock('@/components/public/contact/contact.module.css', async () => import('../../src/components/public/contact/contact.module.css'))
vi.mock('@/components/public/home/HomeView', async () => import('../../src/components/public/home/HomeView'))
vi.mock('@/components/weave/Action', async () => import('../../src/components/weave/Action'))
vi.mock('@/components/weave/Band', async () => import('../../src/components/weave/Band'))
vi.mock('@/components/weave/Edge', async () => import('../../src/components/weave/Edge'))
vi.mock('@/components/weave/layout.module.css', async () => import('../../src/components/weave/layout.module.css'))
vi.mock('@/components/weave/Lines', async () => import('../../src/components/weave/Lines'))
vi.mock('@/components/weave/motion', async () => import('../../src/components/weave/motion'))
vi.mock('@/components/weave/Signature', async () => import('../../src/components/weave/Signature'))
vi.mock('@/lib/content', async () => import('../../src/lib/content'))
vi.mock('@/lib/format', async () => import('../../src/lib/format'))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Serves the published documents: the settings given, and the fixture's rooms with the overrides laid over them. */
function serve(site: Record<string, unknown>, rooms: Record<string, Record<string, unknown>> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const docId = new URL(url).searchParams.get('doc_id')!.slice('eq.'.length)
      const stored = (content.rooms as Record<string, object>)[docId]
      return Response.json([{ data: docId === 'site' ? site : { ...stored, ...rooms[docId] } }])
    }),
  )
}
const settings = (patch: Record<string, unknown>) => ({
  nav: content.nav,
  footer: content.footer,
  home: content.home,
  social: content.social,
  contactPage: content.contactPage,
  ...patch,
})
const doorTitles = (html: string) => [...html.matchAll(/<h3 class="t-card">([^<]*)<\/h3>/g)].map((match) => match[1])

describe('the home page doors', () => {
  const doors = [
    { href: '/contact', title: 'ابدأ الحديث', tone: 'coral', cta: 'هيا نتحدث' },
    { href: '/started', title: 'من البداية', tone: 'aub', meta: 'معلومة قصيرة', line: 'سطر لا يظهر' },
    { href: '/book', title: 'الكتاب', tone: 'saffron', line: 'سطر الكتاب', cta: '' },
    { href: '/journal', title: 'عنوان آخر', tone: 'paper' },
  ]
  const render = async () => renderToStaticMarkup(await HomePage())

  it('are the settings doors in the settings order, so the admin can reorder, rename and drop them', async () => {
    serve(settings({ home: { ...content.home, doors }, nav: content.nav.map((item) => (item.href === '/journal' ? { ...item, label: 'المدونة' } : item)) }), {
      started: { tagline: 'سطر البداية' },
    })
    const html = await render()
    // The journal's door carries the menu's name for it, as before.
    expect(doorTitles(html)).toEqual(['ابدأ الحديث', 'من البداية', 'الكتاب', 'المدونة'])
    expect(html).toContain('هيا نتحدث')
    expect(html).toContain('معلومة قصيرة')
    expect(html).not.toContain('href="/scenes"')
  })

  it('show a room its own line when it has a document, else the door line; a blank cta falls back to «ادخل»', async () => {
    serve(settings({ home: { ...content.home, doors } }), { started: { tagline: 'سطر البداية' } })
    const html = await render()
    expect(html).toContain('سطر البداية')
    expect(html).not.toContain('سطر لا يظهر')
    expect(html).toContain('سطر الكتاب')
    expect(html).toContain('ادخل <span aria-hidden="true">←</span>')
  })

  it('fail the build for a published document without them', async () => {
    const { doors: _doors, ...home } = content.home
    serve(settings({ home }))
    await expect(render()).rejects.toThrow('missing home.doors')
  })
})

describe('the contact page words', () => {
  const contactPage = {
    titleLines: ['سطر أول', 'سطر ثان'],
    servicesTitle: 'خدماتي',
    servicesIntro: 'مقدمة الخدمات',
    services: [
      { name: 'خدمة أولى', text: 'وصف الأولى' },
      { name: 'خدمة ثانية', text: 'وصف الثانية' },
    ],
  }
  const render = async () => renderToStaticMarkup(await ContactPage())

  it('are the settings words, each service opening the form with its own name', async () => {
    serve(settings({ contactPage }))
    const html = await render()
    expect(html.indexOf('سطر أول')).toBeGreaterThan(-1)
    expect(html.indexOf('سطر أول')).toBeLessThan(html.indexOf('سطر ثان'))
    for (const text of [contactPage.servicesTitle, contactPage.servicesIntro, 'وصف الأولى', 'وصف الثانية']) expect(html).toContain(text)
    expect([...html.matchAll(/data-service="([^"]*)"/g)].map((match) => match[1])).toEqual(['خدمة أولى', 'خدمة ثانية'])
    // Nothing of the seed is left once the settings change.
    expect(html).not.toContain(content.contactPage.services[0]!.name)
    expect(html).not.toContain(content.contactPage.servicesTitle)
  })

  it('fail the build for a published document without them', async () => {
    const { contactPage: _contactPage, ...withoutPage } = settings({})
    serve(withoutPage)
    await expect(render()).rejects.toThrow('missing contactPage')
  })
})
