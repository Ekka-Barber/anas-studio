// AUDIT-2 R04: the schedule path's error messages, the chunked media check of
// the publish gate, and the bar that says a schedule is behind the latest edit.
import { randomUUID } from 'node:crypto'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SCENES_DOC_ID } from '../../src/admin/collections'
import { PREVIEW_UNSAVED_NOTE, PublishBar } from '../../src/components/admin/PublishBar'
import { publishDocument, scheduleDocument, scheduleIsBehind } from '../../src/lib/admin-publish'
import { SCENE_CATEGORIES } from '../../src/content/scenes'

const mock = vi.hoisted(() => {
  const calls = { in: [] as string[][], rpc: [] as Array<{ fn: string; args: unknown }> }
  const box = { version: null as unknown, rpcError: null as unknown }
  const client = {
    from() {
      const query: Record<string, unknown> = {}
      query.select = () => query
      query.eq = () => query
      query.maybeSingle = async () => ({ data: { data: box.version }, error: null })
      query.in = async (_column: string, ids: string[]) => {
        calls.in.push(ids)
        return { data: ids.map((id) => ({ id })), error: null }
      }
      return query
    },
    rpc: async (fn: string, args: unknown) => {
      calls.rpc.push({ fn, args })
      return { error: box.rpcError }
    },
  }
  return { calls, box, client }
})
vi.mock('../../src/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => mock.client }))

const AT = '2030-01-01T07:00:00.000Z'

beforeEach(() => {
  mock.calls.in = []
  mock.calls.rpc = []
  mock.box.version = { kind: 'tag', label: 'وسم' }
  mock.box.rpcError = null
})

describe('the schedule action names what went wrong (ADMIN-publish-3, GAP-G4-7)', () => {
  it('a slug another post already has live gets the slug message', async () => {
    mock.box.rpcError = {
      code: '23505',
      message: 'Another published post already uses this slug (published_documents_post_slug).',
    }
    const result = await scheduleDocument('taxonomies', 'tag-one', 3, AT)
    expect(mock.calls.rpc[0]!.fn).toBe('schedule_version')
    expect(result).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'معرّف المقال مستخدم في مقال منشور آخر؛ غيّره ثم أعد المحاولة.' },
    })
  })

  it('a time that is not in the future says so; any other 22023 stays generic', async () => {
    mock.box.rpcError = { code: '22023', message: 'The schedule time must be in the future.' }
    expect(await scheduleDocument('taxonomies', 'tag-one', 3, AT)).toMatchObject({
      error: { message: 'يجب أن يكون موعد الجدولة في المستقبل.' },
    })
    mock.box.rpcError = { code: '22023', message: 'something else' }
    expect(await scheduleDocument('taxonomies', 'tag-one', 3, AT)).toMatchObject({
      error: { message: 'قيمة غير صالحة لهذا الإجراء.' },
    })
  })
})

describe('the publish gate reads library images in chunks (X-CONTRACT-7)', () => {
  it('250 images take three requests of at most 100 ids, and the gate still passes', async () => {
    const ids = Array.from({ length: 250 }, () => randomUUID())
    mock.box.version = { items: ids.map((image) => ({ image, category: SCENE_CATEGORIES[0], caption: 'تعليق' })) }
    const result = await publishDocument('scenes', SCENES_DOC_ID, 1)
    expect(result).toEqual({ ok: true })
    expect(mock.calls.in.map((chunk) => chunk.length)).toEqual([100, 100, 50])
  })
})

describe('a schedule behind the latest version (ADMIN-publish-3)', () => {
  it('is behind only when the scheduled version is older than the latest', () => {
    expect(scheduleIsBehind(null, 4)).toBe(false)
    expect(scheduleIsBehind(4, 4)).toBe(false)
    expect(scheduleIsBehind(3, 4)).toBe(true)
  })

  const bar = (scheduledSeq: number | null) =>
    renderToStaticMarkup(
      createElement(PublishBar, {
        collection: 'posts',
        docId: 'a-post',
        seq: 4,
        liveSeq: null,
        scheduledAt: AT,
        scheduledSeq,
        canPublish: true,
        canArchive: true,
        previewPath: null,
        onChanged: () => {},
      }),
    ).replaceAll('<!-- -->', '')

  it('warns and offers one button that reschedules the latest version', () => {
    const html = bar(3)
    expect(html).toContain('مجدول: نسخة 3 في')
    expect(html).toContain('role="alert"')
    expect(html).toContain('الجدولة على نسخة أقدم: ستُنشر النسخة 3 في الموعد، وآخر نسخة محفوظة هي 4.')
    expect(html).toContain('جدولة النسخة 4 في الموعد نفسه')
  })

  it('shows no warning when the schedule is on the latest version', () => {
    const html = bar(4)
    expect(html).toContain('مجدول: نسخة 4 في')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('الموعد نفسه')
  })
})

// ADMIN-CMS-23: «معاينة» draws the last saved version, so while the form holds edits the bar says to save first.
describe('the preview link beside unsaved edits', () => {
  const PREVIEW = '/admin/preview?id=started'
  const room = (props: { hasUnsavedChanges?: boolean; previewPath?: string | null; reloading?: boolean }) =>
    renderToStaticMarkup(
      createElement(PublishBar, {
        collection: 'rooms',
        docId: 'started',
        seq: 4,
        liveSeq: 4,
        scheduledAt: null,
        scheduledSeq: null,
        canPublish: true,
        canArchive: false,
        previewPath: PREVIEW,
        onChanged: () => {},
        ...props,
      }),
    ).replaceAll('<!-- -->', '')

  it('says to save first, as a status, and keeps the link', () => {
    const html = room({ hasUnsavedChanges: true })
    expect(PREVIEW_UNSAVED_NOTE).toBe('احفظ أولًا لترى تعديلاتك في المعاينة.')
    expect(html).toMatch(/<p role="status" class="[^"]*">احفظ أولًا لترى تعديلاتك في المعاينة\.<\/p>/)
    expect(html).toContain(`href="${PREVIEW}"`)
    expect(html.indexOf('معاينة</a>')).toBeLessThan(html.indexOf(PREVIEW_UNSAVED_NOTE))
  })

  it('says nothing when the form is saved or does not say, and for a document with no preview', () => {
    expect(room({})).not.toContain(PREVIEW_UNSAVED_NOTE)
    expect(room({ hasUnsavedChanges: false })).not.toContain(PREVIEW_UNSAVED_NOTE)
    const noPreview = room({ hasUnsavedChanges: true, previewPath: null })
    expect(noPreview).not.toContain(PREVIEW_UNSAVED_NOTE)
    expect(noPreview).not.toContain('معاينة')
  })

  // R3a audit: while the form reads the document again its `seq` is about to change, so nothing in the bar can be pressed.
  it('lets nothing be pressed while the form reloads, and everything once it has', () => {
    const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? []
    const reloading = buttons(room({ reloading: true }))
    expect(reloading.length).toBeGreaterThan(1)
    for (const button of reloading) expect(button).toContain('disabled=""')
    expect(buttons(room({}))[0]).not.toContain('disabled=""')
  })
})
