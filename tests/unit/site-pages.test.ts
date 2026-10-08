// F2-PAGES: the home page's room doors and the contact page's words are drawn
// from the published `site_settings` document, in the admin's order, not from
// constants in the code. So are the names the header, the footer and the rooms
// give one another, and the titles of the room pages.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BuiltPage, { generateMetadata as builtTitle } from '../../src/app/(public)/built/page'
import ContactPage from '../../src/app/(public)/contact/page'
import HomePage from '../../src/app/(public)/page'
import PassedPage, { generateMetadata as passedTitle } from '../../src/app/(public)/passed/page'
import ShelfPage, { generateMetadata as shelfTitle } from '../../src/app/(public)/shelf/page'
import StartedPage, { generateMetadata as startedTitle } from '../../src/app/(public)/started/page'
import { StartedRoomView } from '../../src/components/public/rooms/StartedRoomView'
import { Footer } from '../../src/components/site/Footer'
import { SiteHeader } from '../../src/components/site/SiteHeader'
import type { StartedRoom } from '../../src/lib/content'
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
// The four room pages draw a stub that shows the two names the page gave its view; the one real view is drawn by its relative path.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/components/public/rooms/StartedRoomView', () => ({ StartedRoomView: namesOf }))
vi.mock('@/components/public/rooms/BuiltRoomView', () => ({ BuiltRoomView: namesOf }))
vi.mock('@/components/public/rooms/PassedRoomView', () => ({ PassedRoomView: namesOf }))
vi.mock('@/components/public/rooms/ShelfRoomView', () => ({ ShelfRoomView: namesOf }))
vi.mock('@/components/public/RoomHero', () => ({
  RoomHero: ({ title }: { title: string }) => createElement('h1', null, title),
}))
vi.mock('@/components/public/story/flow', async () => import('../../src/components/public/story/flow'))
vi.mock('@/components/public/story/Story', () => ({ StatementBand: () => null, StoryFigure: () => null, StoryText: () => null }))
vi.mock('@/components/weave/RoomNav', async () => import('../../src/components/weave/RoomNav'))
vi.mock('@/components/weave/VideoTile', () => ({ VideoTile: () => null }))
vi.mock('@/lib/digits', async () => import('../../src/lib/digits'))

/** What a stubbed room view draws: the two names the page gave it for its neighbours. */
function namesOf(props: { backName?: string; nextName?: string }) {
  return createElement('i', { 'data-back': props.backName ?? '', 'data-next': props.nextName ?? '' })
}
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

/** The text of the one link to `href` in a page. */
const linkText = (html: string, href: string) => new RegExp(`<a href="${href}"[^>]*>([^<]*)</a>`).exec(html)?.[1]

describe('the header brand (A11Y-RTL-13)', () => {
  it('is named with the words it shows, in their order, then where it leads (WCAG 2.5.3)', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { items: content.nav }))
    const brands = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].filter((link) => /aria-label="أنس/.test(link[1]!))
    // The bar's brand and the menu's.
    expect(brands).toHaveLength(2)
    for (const [, attributes, inner] of brands) {
      const name = /aria-label="([^"]*)"/.exec(attributes!)![1]!
      const shown = [...inner!.matchAll(/<span\b[^>]*>([^<]+)<\/span>/g)].map((span) => span[1]!)
      expect(shown).toEqual(['أنس', 'anas.studio'])
      let from = 0
      for (const words of shown) {
        const at = name.indexOf(words, from)
        expect(at, `«${words}» in «${name}»`).toBeGreaterThanOrEqual(0)
        from = at + words.length
      }
      expect(name.endsWith('الرئيسية')).toBe(true)
    }
  })
})

describe('the footer links (DSN-HOME-21)', () => {
  const render = async () => renderToStaticMarkup(await Footer())
  const label = (href: string) => content.nav.find((item) => item.href === href)!.label

  it('carry the menu’s names for the scenes and the contact page, so a room is spelled one way on every page', async () => {
    serve(settings({}))
    const seeded = await render()
    expect(linkText(seeded, '/scenes')).toBe(label('/scenes'))
    expect(linkText(seeded, '/contact')).toBe(label('/contact'))

    const rename = (item: (typeof content.nav)[number]) =>
      item.href === '/scenes' ? { ...item, label: 'المعرض' } : item.href === '/contact' ? { ...item, label: 'راسلني' } : item
    serve(settings({ nav: content.nav.map(rename) }))
    const renamed = await render()
    expect(linkText(renamed, '/scenes')).toBe('المعرض')
    expect(linkText(renamed, '/contact')).toBe('راسلني')
  })

  it('keep their own words while the menu has no item for them or leaves its label blank', async () => {
    serve(settings({ nav: content.nav.filter((item) => item.href !== '/scenes').map((item) => (item.href === '/contact' ? { ...item, label: '  ' } : item)) }))
    const html = await render()
    expect(linkText(html, '/scenes')).toBe('المَشاهد')
    expect(linkText(html, '/contact')).toBe('تواصل')
  })
})

describe('the home page’s optional bands (DSN-HOME-20)', () => {
  const tones = (html: string, tone: string) => html.split(`data-tone="${tone}"`).length - 1
  const render = async (home: Record<string, unknown>) => {
    serve(settings({ home: { ...content.home, ...home } }))
    return renderToStaticMarkup(await HomePage())
  }

  it('draws the coral addition and the aubergine statement only while they have words', async () => {
    const full = await render({})
    const emptied = await render({ introAddition: '', statement: '' })
    expect(tones(full, 'coral') - tones(emptied, 'coral')).toBe(1)
    expect(tones(full, 'aub') - tones(emptied, 'aub')).toBe(1)

    // Spaces are no words, and each band goes on its own.
    const blank = await render({ introAddition: '  ', statement: ' \n ' })
    expect([tones(blank, 'coral'), tones(blank, 'aub')]).toEqual([tones(emptied, 'coral'), tones(emptied, 'aub')])
    const noStatement = await render({ statement: '' })
    expect(tones(full, 'aub') - tones(noStatement, 'aub')).toBe(1)
    expect(tones(noStatement, 'coral')).toBe(tones(full, 'coral'))
    const noAddition = await render({ introAddition: '' })
    expect(tones(full, 'coral') - tones(noAddition, 'coral')).toBe(1)
    expect(tones(noAddition, 'aub')).toBe(tones(full, 'aub'))
  })
})

describe('the rooms (DSN-HOME-19, DSN-HOME-16)', () => {
  const movement = (year: string) => ({ year, vignette: null, paragraphs: ['فقرة'], films: false })
  const started = (...years: string[]) => ({ ...content.rooms.started, movements: years.map(movement) }) as StartedRoom
  const bands = (html: string) =>
    [...html.matchAll(/<h2 id="year-\d+-title"([^>]*)>([^<]*)<\/h2>/g)].map((band) => [band[1]!.includes('t-year') ? 'year' : 'label', band[2]])

  it('takes a year typed with Arabic-Indic digits for a year, drawn in Latin digits, and leaves any other label as typed', () => {
    const typed = '\u0662\u0660\u0662\u0664'
    const label = `${typed} \u0645`
    const html = renderToStaticMarkup(
      createElement(StartedRoomView, { room: started(typed, '2018', ` ${typed} `, label, 'وشيء لم يبدأ بعد') }),
    )
    expect(bands(html)).toEqual([
      ['year', '2024'],
      ['year', '2018'],
      ['year', '2024'],
      ['label', label],
      ['label', 'وشيء لم يبدأ بعد'],
    ])
  })

  it('draws the doors at its end with the names it is given, and with its own words without them', () => {
    const draw = (names: { backName?: string; nextName?: string }) =>
      renderToStaticMarkup(createElement(StartedRoomView, { room: started(), ...names }))
    const plain = draw({})
    expect(plain).toContain('الرئيسية')
    expect(plain).toContain('بنيتُ هنا')
    const renamed = draw({ backName: 'البيت', nextName: 'غرفة البناء' })
    expect(renamed).toContain('البيت')
    expect(renamed).toContain('غرفة البناء')
    expect(renamed).not.toContain('بنيتُ هنا')
  })

  it('give each page the room’s own title for the browser tab, and its doors the menu’s names for the rooms beside it', async () => {
    const nav = content.nav.map((item) => ({ ...item, label: `${item.label} (القائمة)` }))
    const label = (href: string) => nav.find((item) => item.href === href)!.label
    serve(settings({ nav }), {
      started: { title: 'أولى' },
      built: { title: 'ثانية' },
      passed: { title: 'ثالثة' },
      shelf: { title: 'رابعة' },
    })
    expect(await startedTitle()).toEqual({ title: 'أولى' })
    expect(await builtTitle()).toEqual({ title: 'ثانية' })
    expect(await passedTitle()).toEqual({ title: 'ثالثة' })
    expect(await shelfTitle()).toEqual({ title: 'رابعة' })

    const doors = async (page: () => Promise<ReactElement>) => {
      const html = renderToStaticMarkup(await page())
      return [/data-back="([^"]*)"/.exec(html)![1], /data-next="([^"]*)"/.exec(html)![1]]
    }
    expect(await doors(StartedPage)).toEqual([label('/'), label('/built')])
    expect(await doors(BuiltPage)).toEqual([label('/started'), label('/passed')])
    expect(await doors(PassedPage)).toEqual([label('/built'), label('/shelf')])
    expect(await doors(ShelfPage)).toEqual([label('/passed'), label('/book')])
  })

  it('hand a view nothing for a neighbour the menu does not name, so the view keeps its own words', async () => {
    serve(settings({ nav: content.nav.filter((item) => item.href !== '/built').map((item) => (item.href === '/passed' ? { ...item, label: ' ' } : item)) }))
    const html = renderToStaticMarkup(await BuiltPage())
    expect(/data-next="([^"]*)"/.exec(html)![1]).toBe('')
    const started = renderToStaticMarkup(await StartedPage())
    expect(/data-next="([^"]*)"/.exec(started)![1]).toBe('')
  })
})
