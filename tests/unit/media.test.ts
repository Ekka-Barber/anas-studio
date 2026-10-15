// P05: the pure media rules in `src/lib/media.ts` — the ticket request
// schema and header verification on real buffers generated with Sharp (a
// devDependency; never in the Worker bundle). The width helpers moved to the
// client-safe `src/lib/media-ref.ts` and are tested in media-ref.test.ts.
import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  publicKey,
  originalKey,
  quarantineKey,
  ticketRequestSchema,
  verifyObjectHead,
} from '../../supabase/functions/_shared/media.ts'

function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    purpose: 'image',
    name: 'غلاف المجلس',
    folder: '',
    altAr: 'وصف عربي للصورة',
    caption: 'شرح اختياري',
    rights: 'تصوير أنس',
    original: { mime: 'image/jpeg', bytes: 1000, width: 2000, height: 1500 },
    crop: { x: 0, y: 0, width: 2000, height: 1500 },
    derivatives: [
      { width: 360, height: 270, bytes: 100 },
      { width: 720, height: 540, bytes: 200 },
      { width: 1200, height: 900, bytes: 300 },
      { width: 1800, height: 1350, bytes: 400 },
    ],
    ...overrides,
  }
}

describe('keys', () => {
  it('derives the fixed layout', () => {
    const id = randomUUID()
    expect(originalKey(id)).toBe(`originals/${id}`)
    expect(quarantineKey(id, 720)).toBe(`quarantine/${id}/720.webp`)
    expect(publicKey(id, 720)).toBe(`m/${id}/720.webp`)
  })
})

describe('ticketRequestSchema', () => {
  it('accepts a full valid declaration', () => {
    const parsed = ticketRequestSchema.safeParse(baseRequest())
    expect(parsed.success).toBe(true)
  })

  it('accepts an Arabic folder path, an omitted caption and a custom small width', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({
        folder: 'أعمال/تصاميم',
        caption: undefined,
        original: { mime: 'image/webp', bytes: 500, width: 200, height: 160 },
        crop: { x: 0, y: 0, width: 200, height: 160 },
        derivatives: [{ width: 200, height: 160, bytes: 50 }],
      }),
    )
    expect(parsed.success).toBe(true)
  })

  it('rejects an original larger than 15 MiB', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({ original: { mime: 'image/jpeg', bytes: 15_728_641, width: 2000, height: 1500 } }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects more than 40 megapixels', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({
        original: { mime: 'image/jpeg', bytes: 1000, width: 8000, height: 5001 },
        crop: { x: 0, y: 0, width: 8000, height: 5001 },
        // The full width set, so only the pixel count (8000 x 5001 > 40 MP) is wrong.
        derivatives: [
          { width: 360, height: 225, bytes: 100 },
          { width: 720, height: 450, bytes: 200 },
          { width: 1200, height: 750, bytes: 300 },
          { width: 1800, height: 1125, bytes: 400 },
        ],
      }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects a crop outside the original', () => {
    const parsed = ticketRequestSchema.safeParse(
      // x + width = 2001 > 2000; the base derivatives already match a 2000 x 1500 crop.
      baseRequest({ crop: { x: 1, y: 0, width: 2000, height: 1500 } }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects a wrong derivative width set', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({
        derivatives: [
          { width: 360, height: 270, bytes: 100 },
          { width: 720, height: 540, bytes: 200 },
          { width: 1200, height: 900, bytes: 300 },
        ],
      }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects a derivative height that breaks the crop ratio', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({
        derivatives: [
          { width: 360, height: 271, bytes: 100 },
          { width: 720, height: 540, bytes: 200 },
          { width: 1200, height: 900, bytes: 300 },
          { width: 1800, height: 1350, bytes: 400 },
        ],
      }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects an SVG MIME type', () => {
    const parsed = ticketRequestSchema.safeParse(
      baseRequest({ original: { mime: 'image/svg+xml', bytes: 100, width: 2000, height: 1500 } }),
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects whitespace-only alt text or rights', () => {
    expect(ticketRequestSchema.safeParse(baseRequest({ altAr: '   ' })).success).toBe(false)
    expect(ticketRequestSchema.safeParse(baseRequest({ rights: ' ' })).success).toBe(false)
  })

  it('rejects an unknown key anywhere in the declaration', () => {
    expect(ticketRequestSchema.safeParse(baseRequest({ extra: 1 })).success).toBe(false)
    expect(
      ticketRequestSchema.safeParse(
        baseRequest({ original: { mime: 'image/jpeg', bytes: 1000, width: 2000, height: 1500, extra: 1 } }),
      ).success,
    ).toBe(false)
  })

  it('rejects a folder with a leading, trailing or double slash or control characters', () => {
    expect(ticketRequestSchema.safeParse(baseRequest({ folder: '/أعمال' })).success).toBe(false)
    expect(ticketRequestSchema.safeParse(baseRequest({ folder: 'أعمال/' })).success).toBe(false)
    expect(ticketRequestSchema.safeParse(baseRequest({ folder: 'أعمال//تصاميم' })).success).toBe(false)
    expect(ticketRequestSchema.safeParse(baseRequest({ folder: 'أعمال\u0007' })).success).toBe(false)
  })
})

describe('verifyObjectHead', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
  ] as const)('accepts real %s bytes with matching dimensions', async (format, mime) => {
    const buffer = await sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 90, g: 70, b: 50 } } })
      [format]()
      .toBuffer()
    const result = await verifyObjectHead(new Uint8Array(buffer), { mime, width: 320, height: 200 })
    expect(result).toEqual({ ok: true })
  })

  // EF-ADMIN-06: an AVIF still image may carry the major brand mif1 (or an AVIF sequence msf1) and say `avif` (or `avis`) among
  // its compatible brands; image-size reports the raw major brand as the type. Real AVIF bytes, their ftyp brands rewritten.
  describe('the ftyp brands of an AVIF', () => {
    const word = (text: string): Uint8Array => new TextEncoder().encode(text)
    /** Real AVIF bytes (major `avif`, compatible `mif1`, `avif`, `miaf`) with the major brand and the compatible `avif` replaced. */
    async function avifWith(major: string, compatibleAvif: string): Promise<Uint8Array> {
      const buffer = await sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 90, g: 70, b: 50 } } })
        .avif()
        .toBuffer()
      const bytes = new Uint8Array(buffer)
      const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
      bytes.set(word(major), 8)
      for (let offset = 16; offset + 4 <= size; offset += 4) {
        if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'avif') bytes.set(word(compatibleAvif), offset)
      }
      return bytes
    }
    const expectedAvif = { mime: 'image/avif', width: 320, height: 200 }

    it('sharp writes avif as its major brand, which was always accepted', async () => {
      expect(await verifyObjectHead(await avifWith('avif', 'avif'), expectedAvif)).toEqual({ ok: true })
    })

    it.each([
      ['mif1', 'avif'],
      ['mif1', 'avis'],
      ['msf1', 'avif'],
      ['msf1', 'avis'],
    ])('a %s file that lists %s among its compatible brands is image/avif', async (major, compatible) => {
      expect(await verifyObjectHead(await avifWith(major, compatible), expectedAvif)).toEqual({ ok: true })
    })

    it.each(['mif1', 'msf1'])('a %s file that lists neither avif nor avis is the HEIF family\'s and stays UNKNOWN_TYPE', async (major) => {
      const result = await verifyObjectHead(await avifWith(major, 'heic'), expectedAvif)
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' })
    })

    it('anything else is as before: another major brand is refused, and the declared type must still match', async () => {
      // An AVIF sequence by its major brand, and a HEIC file that lists avif: image-size does not call either an AVIF still image.
      expect(await verifyObjectHead(await avifWith('avis', 'avif'), expectedAvif)).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' })
      expect(await verifyObjectHead(await avifWith('heic', 'avif'), expectedAvif)).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' })
      // A mif1 AVIF declared as a JPEG is a type mismatch, and its dimensions are still compared.
      expect(await verifyObjectHead(await avifWith('mif1', 'avif'), { ...expectedAvif, mime: 'image/jpeg' })).toMatchObject({ ok: false, code: 'TYPE_MISMATCH' })
      expect(await verifyObjectHead(await avifWith('mif1', 'avif'), { ...expectedAvif, width: 321 })).toMatchObject({ ok: false, code: 'DIMENSION_MISMATCH' })
    })
  })

  it('accepts an orientation-6 JPEG declared with swapped (oriented) dimensions', async () => {
    const buffer = await sharp({ create: { width: 120, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()
    const oriented = await verifyObjectHead(new Uint8Array(buffer), { mime: 'image/jpeg', width: 50, height: 120 })
    expect(oriented).toEqual({ ok: true })
    const physical = await verifyObjectHead(new Uint8Array(buffer), { mime: 'image/jpeg', width: 120, height: 50 })
    expect(physical.ok).toBe(false)
  })

  it('rejects SVG text', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    const result = await verifyObjectHead(svg, { mime: 'image/jpeg', width: 10, height: 10 })
    expect(result.ok).toBe(false)
  })

  it('rejects HTML text', async () => {
    const html = new TextEncoder().encode('<html><body><h1>not an image</h1></body></html>')
    const result = await verifyObjectHead(html, { mime: 'image/jpeg', width: 10, height: 10 })
    expect(result.ok).toBe(false)
  })

  it('rejects zip bytes', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, ...new Array(40).fill(0)])
    const result = await verifyObjectHead(zip, { mime: 'image/jpeg', width: 10, height: 10 })
    expect(result.ok).toBe(false)
  })

  it('rejects PNG bytes declared as JPEG, and mismatched dimensions', async () => {
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer()
    const wrongType = await verifyObjectHead(new Uint8Array(png), { mime: 'image/jpeg', width: 64, height: 32 })
    expect(wrongType.ok).toBe(false)
    const wrongSize = await verifyObjectHead(new Uint8Array(png), { mime: 'image/png', width: 32, height: 64 })
    expect(wrongSize.ok).toBe(false)
  })
})
