// P05: the client-safe media reference helpers in `src/lib/media-ref.ts` —
// including the round-2 additions: the public origin, `mediaUrl`, the
// derivative width rules and the folder path rules, plus the admin media
// schema's sync with `mediaFields`.
import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { mediaFields, mediaMetaSchema } from '../../src/admin/collections/media'
import {
  collectMediaIds,
  derivativeHeight,
  derivativeWidths,
  folderIsInvalid,
  formatMediaRef,
  isMediaId,
  mediaUrl,
  MEDIA_ORIGIN,
  parseMediaRef,
  PRESET_WIDTHS,
} from '../../src/lib/media-ref'

describe('isMediaId', () => {
  it('accepts only lowercase uuid strings', () => {
    const id = randomUUID()
    expect(isMediaId(id)).toBe(true)
    expect(isMediaId(id.toUpperCase())).toBe(false)
    expect(isMediaId('not-an-id')).toBe(false)
    expect(isMediaId(42)).toBe(false)
    expect(isMediaId(null)).toBe(false)
  })
})

describe('collectMediaIds', () => {
  it('walks deeply and returns unique ids in first-seen order', () => {
    const first = randomUUID()
    const second = randomUUID()
    const value = {
      vignette: { id: first },
      gallery: [{ id: second }, { id: first }, { note: 'صورة', id: second }],
      title: 'غلاف',
    }
    expect(collectMediaIds(value)).toEqual([first, second])
  })

  it('returns an empty list for id-free values', () => {
    expect(collectMediaIds({ a: [1, 'نص', true], b: null })).toEqual([])
    expect(collectMediaIds('نص عادي')).toEqual([])
  })
})

describe('formatMediaRef / parseMediaRef', () => {
  it('round-trips', () => {
    const ref = { base: '/media/m/' + randomUUID(), width: 1800, height: 1350, widths: [360, 720, 1200, 1800] }
    const formatted = formatMediaRef(ref)
    expect(formatted).toBe(`media|${ref.base}|1800x1350|360,720,1200,1800`)
    expect(parseMediaRef(formatted)).toEqual(ref)
  })

  it('carries the alt text written at upload, even one with a bar or a percent sign', () => {
    const ref = { base: '/media/m/' + randomUUID(), width: 720, height: 480, widths: [360, 720], alt: 'باب | مفتوح 100%' }
    const formatted = formatMediaRef(ref)
    expect(formatted.split('|')).toHaveLength(5)
    expect(parseMediaRef(formatted)).toEqual(ref)
    expect(parseMediaRef(formatMediaRef({ ...ref, alt: undefined }))?.alt).toBeUndefined()
    expect(parseMediaRef('media|/media/m/x|100x50|360|%E0%A4%A')).toBeNull()
  })

  it('parses a production-origin reference', () => {
    const parsed = parseMediaRef(`media|https://media.anas.studio/m/${randomUUID()}|720x480|360,720`)
    expect(parsed?.widths).toEqual([360, 720])
    expect(parsed?.width).toBe(720)
    expect(parsed?.height).toBe(480)
  })

  it('returns null for anything else', () => {
    const id = randomUUID()
    expect(parseMediaRef(id)).toBeNull()
    expect(parseMediaRef('media|/media/m/x')).toBeNull()
    expect(parseMediaRef('media|/media/m/x|100x|360')).toBeNull()
    expect(parseMediaRef('media|/media/m/x|100x50|')).toBeNull()
    expect(parseMediaRef('media||100x50|360')).toBeNull()
    expect(parseMediaRef('')).toBeNull()
    expect(parseMediaRef(null)).toBeNull()
  })
})

describe('MEDIA_ORIGIN and mediaUrl (round 2)', () => {
  // D32: the origin is the `media-public` Storage bucket under the build's
  // NEXT_PUBLIC_SUPABASE_URL; the unit environment sets none, so it is empty.
  it('is empty without a Supabase URL (unit tests)', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
    expect(MEDIA_ORIGIN).toBe('')
  })

  it('keeps the whole derivative key after the origin', () => {
    const id = randomUUID()
    expect(mediaUrl(`m/${id}/1200.webp`)).toBe(`/m/${id}/1200.webp`)
    expect(mediaUrl(`m/${id}/360.webp`)).toBe(`/m/${id}/360.webp`)
  })
})

describe('derivative widths (moved from src/lib/media.ts)', () => {
  it('returns every preset that fits, and the crop width alone below the smallest', () => {
    expect(PRESET_WIDTHS).toEqual([360, 720, 1200, 1800])
    expect(derivativeWidths(2000)).toEqual([360, 720, 1200, 1800])
    expect(derivativeWidths(1000)).toEqual([360, 720])
    expect(derivativeWidths(200)).toEqual([200])
  })

  it('scales the crop ratio, rounding to the nearest pixel', () => {
    expect(derivativeHeight(720, { width: 2000, height: 1000 })).toBe(360)
    expect(derivativeHeight(360, { width: 1000, height: 333 })).toBe(120)
  })
})

describe('folder rules', () => {
  it('accepts the root and clean paths, refuses broken ones', () => {
    expect(folderIsInvalid('')).toBe(false)
    expect(folderIsInvalid('أغلفة')).toBe(false)
    expect(folderIsInvalid('أغلفة / ٢٠٢٦'.replace(' / ', '/'))).toBe(false)
    expect(folderIsInvalid('أغلفة/')).toBe(true)
    expect(folderIsInvalid('/أغلفة')).toBe(true)
    expect(folderIsInvalid('أغلفة//٢٠٢٦')).toBe(true)
    expect(folderIsInvalid('أغلفة\t٢٠٢٦')).toBe(true)
    // The SQL `[[:cntrl:]]` check also refuses the C1 controls.
    expect(folderIsInvalid('أغلفة\u0085٢٠٢٦')).toBe(true)
    expect(folderIsInvalid('أغلفة\u009F')).toBe(true)
    expect(folderIsInvalid('x'.repeat(121))).toBe(true)
  })
})

describe('mediaMetaSchema stays in sync with mediaFields', () => {
  const valid = { name: 'غلاف', altAr: 'وصف', caption: '', rights: 'تصوير أنس', folder: '' }

  it('accepts an object with exactly the field names', () => {
    expect(mediaMetaSchema.safeParse(valid).success).toBe(true)
    expect(mediaMetaSchema.safeParse({ ...valid, caption: undefined }).success).toBe(true)
  })

  it('refuses an unknown key, so a new field cannot silently miss its limits', () => {
    expect(mediaMetaSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false)
  })

  it('refuses a missing required field', () => {
    for (const field of mediaFields) {
      if (field.name === 'caption') continue
      const partial = { ...valid } as Record<string, unknown>
      delete partial[field.name]
      expect(mediaMetaSchema.safeParse(partial).success, field.name).toBe(false)
    }
  })

  it('enforces the SQL limits', () => {
    expect(mediaMetaSchema.safeParse({ ...valid, name: 'x'.repeat(121) }).success).toBe(false)
    expect(mediaMetaSchema.safeParse({ ...valid, altAr: '' }).success).toBe(false)
    expect(mediaMetaSchema.safeParse({ ...valid, rights: 'x'.repeat(301) }).success).toBe(false)
    expect(mediaMetaSchema.safeParse({ ...valid, caption: 'x'.repeat(501) }).success).toBe(false)
    expect(mediaMetaSchema.safeParse({ ...valid, folder: '/abs' }).success).toBe(false)
  })
})
