// AUDIT-2 R03: the editor's load defaults, issue labels, and the publish rules
// that used to let a blank or mismatched value through.
import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { schemaFor, SCENES_DOC_ID } from '../../src/admin/collections'
import { POLICY_BODY_ERROR } from '../../src/admin/collections/policies'
import { LINE_NOT_A_PARAGRAPH_ERROR, passedRoomFields, startedRoomFields } from '../../src/admin/collections/rooms'
import { scenesFields } from '../../src/admin/collections/scenes'
import {
  NAV_HREF_DUPLICATE_ERROR,
  NAV_HREF_ERROR,
  NAV_LABEL_ERROR,
  siteSettingsFields,
} from '../../src/admin/collections/site-settings'
import {
  draftOffer,
  draftStorageAction,
  equalData,
  fieldPathLabel,
  schemaFromFields,
  withDefaults,
  type Field,
  type StoredDraft,
} from '../../src/admin/fields'
import { SCENE_CATEGORIES } from '../../src/content/scenes'
import content from '../../content/initial-content.json'
import imageManifest from '../../public/images/manifest.json'
import mediaManifest from '../../public/media/manifest.json'

const text = (value: string) => ({ type: 'paragraph', children: [{ type: 'text', text: value, format: 0 }] })
const body = (value: string) => ({ root: { type: 'root', children: [text(value)] } })
const messages = (schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, data: unknown) => {
  const result = schema.safeParse(data)
  return result.success ? [] : result.error!.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

const seededSettings = { nav: content.nav, footer: content.footer, home: content.home }

describe('withDefaults: a stored document that lacks a whole group', () => {
  it('fills the missing groups, and the merged document is the form state, not a change', () => {
    const merged = withDefaults(siteSettingsFields, seededSettings)
    expect(merged.contact).toEqual({ email: '', whatsapp: '' })
    expect(merged.seo).toEqual({ title: '', description: '' })
    expect(equalData(withDefaults(siteSettingsFields, merged), merged)).toBe(true)
  })

  it('lets the owner type one contact value and still publish (the settings were unpublishable before)', () => {
    const gate = schemaFor('site_settings', 'site')
    const typedOnly = { ...seededSettings, contact: { whatsapp: '0501234567' } }
    expect(gate.safeParse(typedOnly).success).toBe(false)

    const merged = withDefaults(siteSettingsFields, seededSettings)
    const typed = { ...merged, contact: { ...(merged.contact as object), whatsapp: '0501234567' } }
    expect(gate.safeParse(typed).success).toBe(true)
  })

  it('loaded values win, and a group in both is merged key by key', () => {
    const merged = withDefaults(siteSettingsFields, { ...seededSettings, contact: { whatsapp: '0501234567' } })
    expect(merged.contact).toEqual({ whatsapp: '0501234567', email: '' })
    expect(merged.home).toEqual(content.home)
    expect(merged.nav).toEqual(content.nav)
  })

  it('leaves an optional field that is not a group absent, so an unset value stays unset', () => {
    const passed = structuredClone(content.rooms.passed) as Record<string, unknown>
    delete passed.galleryLine
    delete passed.bandLines
    const merged = withDefaults(passedRoomFields, passed)
    expect(merged).not.toHaveProperty('galleryLine')
    expect(merged).not.toHaveProperty('bandLines')
  })
})

describe('draftOffer: which stored local copy a loaded document offers (ADMIN-editor-2, FIX-admin-1, S08.2)', () => {
  const loaded = withDefaults(siteSettingsFields, seededSettings)
  const typed = { ...seededSettings, contact: { whatsapp: '0501234567' } }
  const savedAt = 1_700_000_000_000
  const copy = (over: Partial<StoredDraft> = {}): StoredDraft => ({ baseSeq: 3, data: typed, savedAt, ...over })
  const offerTo = (userId: string | undefined, stored: StoredDraft | null, loadedSeq = 3) =>
    draftOffer(stored, userId, loaded, loadedSeq, siteSettingsFields)
  const offer = (stored: StoredDraft | null, loadedSeq = 3) => offerTo('me', stored, loadedSeq)
  const nothing = { offered: null, staleBase: null, savedAt: null }

  it('offers the signed-in user their own copy, read as the form holds it (defaults merged)', () => {
    const result = offer(copy({ userId: 'me' }))
    expect(result.offered?.contact).toEqual({ whatsapp: '0501234567', email: '' })
    expect(result).toMatchObject({ staleBase: null, savedAt })
  })

  it("does not offer another user's copy, nor a user's copy when nobody is signed in", () => {
    expect(offer(copy({ userId: 'someone-else' }))).toEqual(nothing)
    expect(offerTo(undefined, copy({ userId: 'me' }))).toEqual(nothing)
  })

  it('offers a copy written before `userId` was recorded', () => {
    expect(copy()).not.toHaveProperty('userId')
    expect(offer(copy()).offered).not.toBeNull()
    expect(offerTo(undefined, copy()).offered).not.toBeNull()
  })

  it('does not offer a copy equal to the loaded data once defaults are merged, whatever its key order', () => {
    expect(offer(copy({ data: seededSettings, userId: 'me' }))).toEqual(nothing)
    expect(offer(copy({ data: Object.fromEntries(Object.entries(loaded).reverse()), userId: 'me' }))).toEqual(nothing)
  })

  it('names the version a copy was made from only when a newer one is saved now', () => {
    expect(offer(copy({ baseSeq: 2 }), 3).staleBase).toBe(2)
    expect(offer(copy({ baseSeq: 3 }), 3).staleBase).toBeNull()
    expect(offer(copy({ baseSeq: 4 }), 3).staleBase).toBeNull()
  })

  it('offers nothing for no copy, or for a copy whose data is not an object', () => {
    expect(offer(null)).toEqual(nothing)
    for (const data of [null, undefined, 'text', 42, true, ['a']]) {
      expect(offer(copy({ data })).offered, String(data)).toBeNull()
      expect(offer(copy({ data })).savedAt, String(data)).toBeNull()
    }
  })
})

describe('draftStorageAction: a copy on offer is never touched (ADMIN-editor-2, FIX-admin-1)', () => {
  const saved = withDefaults(siteSettingsFields, seededSettings)
  const typed = { ...saved, contact: { email: '', whatsapp: '0501234567' } }

  it('keeps the copy while an offer is pending, after a save (form equals saved) and while typing', () => {
    expect(draftStorageAction(true, saved, saved)).toBe('keep')
    expect(draftStorageAction(true, typed, saved)).toBe('keep')
  })

  it('removes the copy once the form equals its saved version, whatever the key order', () => {
    expect(draftStorageAction(false, saved, saved)).toBe('remove')
    expect(draftStorageAction(false, Object.fromEntries(Object.entries(saved).reverse()), saved)).toBe('remove')
  })

  it('writes the form as the copy when it differs from the saved version', () => {
    expect(draftStorageAction(false, typed, saved)).toBe('write')
  })
})

describe('fieldPathLabel: names the item and the field (FIX-admin-3)', () => {
  it('walks lists and groups with 1-based item numbers', () => {
    expect(fieldPathLabel(scenesFields, ['items', 16, 'image'])).toBe('الصور › 17 › الصورة')
    expect(fieldPathLabel(startedRoomFields, ['movements', 1, 'paragraphs', 2])).toBe('المحطّات › 2 › الفقرات › 3')
    expect(fieldPathLabel(startedRoomFields, ['media', 'reels', 0, 'id'])).toBe('الوسائط › المقاطع › 1 › المعرّف')
  })

  it('has no label for a document-level issue, and keeps an unknown key as it is', () => {
    expect(fieldPathLabel(startedRoomFields, [])).toBe('')
    expect(fieldPathLabel(startedRoomFields, ['elsewhere'])).toBe('elsewhere')
  })

  it('points at photo 3 of the scenes gallery when that photo has an unknown image id', () => {
    const photo = { image: Object.keys(imageManifest)[0]!, category: SCENE_CATEGORIES[0], caption: 'تعليق' }
    const result = schemaFor('scenes', SCENES_DOC_ID).safeParse({ items: [photo, photo, { ...photo, image: 'no-such-image' }] })
    expect(result.success).toBe(false)
    expect(fieldPathLabel(scenesFields, result.error!.issues[0]!.path)).toBe('الصور › 3 › الصورة')
  })
})

describe('room pull and band lines must repeat a paragraph (ADMIN-editor-4, X-CONTRACT-11)', () => {
  it('passes the seeded rooms, then refuses a line whose paragraph was edited', () => {
    const started = structuredClone(content.rooms.started)
    expect(messages(schemaFor('rooms', 'started'), started)).toEqual([])

    const line = started.pullLines[0]!
    for (const movement of started.movements) movement.paragraphs = movement.paragraphs.map((p) => (p === line ? `${p}.` : p))
    expect(messages(schemaFor('rooms', 'started'), started)).toEqual([`pullLines.0: ${LINE_NOT_A_PARAGRAPH_ERROR}`])
  })

  it('checks a band line of the passed room and the moonlight cup of the shelf by their own paragraphs', () => {
    const passed = structuredClone(content.rooms.passed)
    passed.bandLines = [...passed.bandLines, 'سطر ليس في الفقرات']
    expect(messages(schemaFor('rooms', 'passed'), passed)).toEqual([
      `bandLines.${passed.bandLines.length - 1}: ${LINE_NOT_A_PARAGRAPH_ERROR}`,
    ])

    const shelf = structuredClone(content.rooms.shelf)
    shelf.items.moonlightCup.pullLines = ['سطر ليس في الفقرات']
    expect(messages(schemaFor('rooms', 'shelf'), shelf)).toEqual([
      `items.moonlightCup.pullLines.0: ${LINE_NOT_A_PARAGRAPH_ERROR}`,
    ])
  })
})

describe('blank values the publish gate now refuses (ADMIN-editor-5, -6, -7, GAP-G4-9)', () => {
  it('a policy needs a title and some text', () => {
    const gate = schemaFor('policies', 'refund')
    expect(gate.safeParse({ title: 'سياسة الاسترجاع', body: body('نص') }).success).toBe(true)
    expect(messages(gate, { title: '  ', body: body('نص') })).toEqual(['title: لا يمكن أن يكون فارغًا.'])
    expect(messages(gate, { title: 'سياسة', body: { root: { type: 'root', children: [] } } })).toEqual([`body: ${POLICY_BODY_ERROR}`])
    expect(messages(gate, { title: 'سياسة', body: body('   ') })).toEqual([`body: ${POLICY_BODY_ERROR}`])
  })

  it('a post needs a title and a taxonomy a label', () => {
    const post = {
      slug: 'hello',
      title: 'عنوان',
      excerpt: 'مقتطف',
      body: body('نص'),
      author: 'أنس',
      categories: [],
      tags: [],
      visible: true,
    }
    expect(schemaFor('posts', randomUUID()).safeParse(post).success).toBe(true)
    expect(messages(schemaFor('posts', randomUUID()), { ...post, title: '' })).toEqual(['title: لا يمكن أن يكون فارغًا.'])
    expect(schemaFor('taxonomies', 'news').safeParse({ kind: 'category', label: 'أخبار' }).success).toBe(true)
    expect(messages(schemaFor('taxonomies', 'news'), { kind: 'category', label: '' })).toEqual(['label: لا يمكن أن يكون فارغًا.'])
  })

  it('a post slug is a route segment: at most 80 characters, no leading dash', () => {
    const slugMessages = (slug: string) =>
      messages(schemaFor('posts', randomUUID()), {
        slug,
        title: 'عنوان',
        excerpt: '',
        body: body('نص'),
        author: '',
        categories: [],
        tags: [],
        visible: true,
      })
    expect(slugMessages('a'.repeat(80))).toEqual([])
    expect(slugMessages('a'.repeat(81))).toHaveLength(1)
    expect(slugMessages('-x')).toHaveLength(1)
  })

  it('menu items need a name, an internal path or https link, and a link of their own', () => {
    const gate = schemaFor('site_settings', 'site')
    const withNav = (nav: unknown[]) => messages(gate, { ...seededSettings, nav })
    expect(withNav([{ label: 'المجلس', href: '/journal' }, { label: 'موقع', href: 'https://example.com/a' }])).toEqual([])
    expect(withNav([{ label: '', href: '' }])).toEqual([`nav.0.label: ${NAV_LABEL_ERROR}`, `nav.0.href: ${NAV_HREF_ERROR}`])
    expect(withNav([{ label: 'أ', href: 'journal' }])).toEqual([`nav.0.href: ${NAV_HREF_ERROR}`])
    expect(withNav([{ label: 'أ', href: '//evil.example' }])).toEqual([`nav.0.href: ${NAV_HREF_ERROR}`])
    expect(withNav([{ label: 'أ', href: 'javascript:alert(1)' }])).toEqual([`nav.0.href: ${NAV_HREF_ERROR}`])
    expect(withNav([{ label: 'أ', href: '/a' }, { label: 'ب', href: '/a' }])).toEqual([`nav.1.href: ${NAV_HREF_DUPLICATE_ERROR}`])
    // The Latin path is isolated from the Arabic around it, so «/journal» is not drawn as «journal/».
    expect(NAV_HREF_ERROR).toContain('‎/journal')
  })
})

describe('field rules shared by every form (ADMIN-editor-10, FIX-admin-2, GAP-G4-1, GAP-G4-3)', () => {
  const imageField = { name: 'id', label: 'الصورة', type: 'image' } as const satisfies Field
  const videoField = { name: 'id', label: 'المقطع', type: 'video' } as const satisfies Field

  it('an image or video id must be an own manifest key, not one every object inherits', () => {
    const images = schemaFromFields([imageField])
    const videos = schemaFromFields([videoField])
    expect(images.safeParse({ id: Object.keys(imageManifest)[0] }).success).toBe(true)
    expect(videos.safeParse({ id: Object.keys(mediaManifest.videos)[0] }).success).toBe(true)
    for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(images.safeParse({ id: inherited }).success, `image ${inherited}`).toBe(false)
      expect(videos.safeParse({ id: inherited }).success, `video ${inherited}`).toBe(false)
    }
  })

  it('a number stays inside Postgres integer, and says so, instead of reaching the database', () => {
    const stock = schemaFromFields([{ name: 'stock', label: 'المخزون', type: 'number' }])
    expect(stock.safeParse({ stock: 2_147_483_647 }).success).toBe(true)
    expect(messages(stock, { stock: 3_000_000_000 })).toEqual(['stock: أكبر قيمة 2147483647.'])
    expect(messages(stock, { stock: -3_000_000_000 })).toEqual(['stock: أقل قيمة ‎-2147483648.'])
    const capped = schemaFromFields([{ name: 'stock', label: 'المخزون', type: 'number', max: 5 }])
    expect(messages(capped, { stock: 6 })).toEqual(['stock: أكبر قيمة 5.'])
  })

  it('a required single-line name refuses the control characters its table refuses', () => {
    const named = schemaFromFields([{ name: 'title', label: 'العنوان', type: 'text', nonBlank: true }])
    expect(named.safeParse({ title: 'كوب' }).success).toBe(true)
    expect(messages(named, { title: 'كوب\tأبيض' })).toEqual(['title: لا يُقبل نص فيه رموز تحكم.'])
    expect(messages(named, { title: 'كوب\u0085' })).toEqual(['title: لا يُقبل نص فيه رموز تحكم.'])
    // A plain text area keeps its line breaks.
    const area = schemaFromFields([{ name: 'note', label: 'ملاحظة', type: 'textarea' }])
    expect(area.safeParse({ note: 'سطر\nسطر' }).success).toBe(true)
  })
})
