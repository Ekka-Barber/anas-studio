// AUDIT-2 R05: the media library's state rules that can run without a DOM.
// ADMIN-media-1 / FIX-admin-4: a save that resolves after another image was opened
// must not touch that image. ADMIN-media-2: a range fetched twice must not double a tile.
// GAP-G5-5: an update that matched no row is not a save. GAP-G4-8: a rename is refused
// when a child path would pass 120 characters.
import { describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }))

// vitest.config.ts has no `@/` alias, so MediaLibrary's own imports are stubbed.
vi.mock('@/admin/collections', () => ({}))
vi.mock('@/admin/collections/media', () => ({}))
vi.mock('@/admin/collections/policies', () => ({}))
vi.mock('@/lib/media-ref', async () => {
  const rules = await import('../../supabase/functions/_shared/media-rules.ts')
  return { folderIsInvalid: rules.folderIsInvalid }
})
vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: () => ({
    from: () => ({ update: () => ({ eq: () => ({ select: async () => client.result }) }) }),
  }),
}))
vi.mock('@/lib/supabase/functions', () => ({}))
vi.mock('../../src/components/admin/FieldInput', () => ({}))
vi.mock('../../src/components/admin/MediaUpload', () => ({}))

import {
  appendPage,
  patchSelected,
  renameProblem,
  updateMediaRow,
  type MediaRow,
} from '../../src/components/admin/MediaLibrary'

function row(id: string): MediaRow {
  return {
    id,
    name: id,
    folder: '',
    alt_ar: 'وصف',
    caption: null,
    rights: 'حقوق',
    original_bytes: 1,
    original_width: 1,
    original_height: 1,
    original_mime: 'image/webp',
    derivatives: [],
    created_at: '2026-09-30T00:00:00Z',
  }
}

describe('patchSelected', () => {
  it('patches the row that was saved', () => {
    expect(patchSelected(row('a'), 'a', { name: 'جديد' })?.name).toBe('جديد')
  })

  it('leaves another image, opened while the save ran, exactly as it is', () => {
    const other = row('b')
    expect(patchSelected(other, 'a', { name: 'جديد' })).toBe(other)
    expect(patchSelected(null, 'a', { name: 'جديد' })).toBeNull()
  })
})

describe('appendPage', () => {
  it('drops rows the grid already shows, so a range fetched twice adds nothing', () => {
    const shown = [row('1'), row('2')]
    expect(appendPage(shown, [row('1'), row('2')]).map((r) => r.id)).toEqual(['1', '2'])
    expect(appendPage(shown, [row('2'), row('3')]).map((r) => r.id)).toEqual(['1', '2', '3'])
  })
})

describe('updateMediaRow', () => {
  const patch = { name: 'n', alt_ar: 'a', caption: null, rights: 'r', folder: '' }

  it('is missing when the update matched no row (deleted image, or RLS filtered it)', async () => {
    client.result = { data: [], error: null }
    expect(await updateMediaRow('a', patch)).toBe('missing')
  })

  it('is saved when a row came back, error when the request failed', async () => {
    client.result = { data: [{ id: 'a' }], error: null }
    expect(await updateMediaRow('a', patch)).toBe('saved')
    client.result = { data: null, error: { message: 'boom' } }
    expect(await updateMediaRow('a', patch)).toBe('error')
  })
})

describe('renameProblem', () => {
  // `أ/` plus 100 characters: 102 in all, valid where it is.
  const deep = `أ/${'ب'.repeat(100)}`

  it('refuses a new name that pushes a child path past 120 characters', () => {
    expect(renameProblem(['أ', deep], 'أ', 'ج'.repeat(40))).toMatch(/أطول من 120/)
  })

  it('allows a rename whose every child path still fits', () => {
    expect(renameProblem(['أ', deep], 'أ', 'ج'.repeat(10))).toBeNull()
  })

  it('refuses an empty source, an empty target and a malformed target', () => {
    expect(renameProblem(['أ'], '', 'ب')).toMatch(/غير صالح/)
    expect(renameProblem(['أ'], 'أ', '')).toMatch(/غير صالح/)
    expect(renameProblem(['أ'], 'أ', 'ب/')).toMatch(/غير صالح/)
  })
})
