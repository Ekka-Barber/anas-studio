// AUDIT-1 S09.2: after `media_rename_folder(from, to)` the open details form and
// the folder filter must follow the same prefix rule the SQL uses, or the next
// save moves the image back to the old folder.
import { describe, expect, it, vi } from 'vitest'

// vitest.config.ts has no `@/` alias, so MediaLibrary's own imports are stubbed;
// only the pure `movedFolder` runs here.
vi.mock('@/admin/collections', () => ({}))
vi.mock('@/admin/collections/media', () => ({}))
vi.mock('@/admin/collections/policies', () => ({}))
vi.mock('@/lib/media-ref', () => ({}))
vi.mock('@/lib/supabase/browser', () => ({}))
vi.mock('@/lib/supabase/functions', () => ({}))
vi.mock('../../src/components/admin/FieldInput', () => ({}))
vi.mock('../../src/components/admin/MediaUpload', () => ({}))

import { movedFolder } from '../../src/components/admin/MediaLibrary'

describe('movedFolder', () => {
  it('moves the renamed folder and everything under it', () => {
    expect(movedFolder('a', 'a', 'b')).toBe('b')
    expect(movedFolder('a/x', 'a', 'b')).toBe('b/x')
    expect(movedFolder('a/x/y', 'a', 'c/d')).toBe('c/d/x/y')
  })

  it('leaves other folders alone, including a sibling that only shares the prefix', () => {
    expect(movedFolder('ab', 'a', 'b')).toBe('ab')
    expect(movedFolder('b/a', 'a', 'c')).toBe('b/a')
    expect(movedFolder('', 'a', 'b')).toBe('')
  })
})
