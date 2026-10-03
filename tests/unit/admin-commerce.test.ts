// P08 round 11c: the parts of the variant form's commerce panel and of the statistics screen that need no
// React (src/lib/admin-commerce.ts): the Riyadh day, the checks a paid file passes before any call, the
// range of days sent to `stats`, the size wording, the strict parsers of what `variant_admin_info`, the
// paid-file actions and `owner_commerce_stats` answer, and the sentences.
import { describe, expect, it } from 'vitest'

import { PAID_FILE_MAX_BYTES as SERVER_MAX_BYTES } from '../../supabase/functions/_shared/paid-files.ts'
import {
  checkPaidFile,
  COMMERCE_NOTE,
  commerceLines,
  DAY_INVALID,
  dayAfter,
  dayStart,
  FILE_EMPTY,
  FILE_NAME,
  FILE_TOO_LARGE,
  FILE_TYPE,
  formatFileSize,
  isDay,
  PAID_FILE_MAX_BYTES,
  paidFileMime,
  parseCommerceStats,
  parseUploadDone,
  parseUploadTicket,
  parseVariantInfo,
  RANGE_REVERSED,
  RANGE_TOO_LONG,
  riyadhToday,
  signedMoney,
  statsRequest,
  uploadedSentence,
  type CommerceStats,
} from '../../src/lib/admin-commerce'

const DAY_MS = 86_400_000
const PDF = 'application/pdf'
const EPUB = 'application/epub+zip'

describe('the Riyadh day', () => {
  it('is today in Riyadh (UTC+3): the day turns at 21:00 UTC', () => {
    expect(riyadhToday(Date.parse('2026-10-03T20:59:59.999Z'))).toBe('2026-10-03')
    expect(riyadhToday(Date.parse('2026-10-03T21:00:00.000Z'))).toBe('2026-10-04')
    expect(riyadhToday(Date.parse('2026-12-31T22:00:00Z'))).toBe('2027-01-01')
    expect(riyadhToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('knows a real calendar day as a date input writes it, and nothing else', () => {
    for (const day of ['2026-10-03', '2024-02-29', '2026-12-31', '2026-01-01']) expect(isDay(day), day).toBe(true)
    for (const bad of ['', '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '20261-01-01', '2026-1-1', '26-10-03', '2026-10-03T00:00', ' 2026-10-03', 'ليس يومًا']) {
      expect(isDay(bad), bad).toBe(false)
    }
  })

  it('gives the day after, over a month, a leap day and a year end', () => {
    expect(dayAfter('2026-10-03')).toBe('2026-10-04')
    expect(dayAfter('2026-02-28')).toBe('2026-03-01')
    expect(dayAfter('2024-02-28')).toBe('2024-02-29')
    expect(dayAfter('2024-02-29')).toBe('2024-03-01')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
  })

  it('starts a day at its midnight in Riyadh, as an ISO time with the offset', () => {
    expect(dayStart('2026-10-03')).toBe('2026-10-03T00:00:00+03:00')
    expect(new Date(dayStart('2026-10-03')).toISOString()).toBe('2026-10-02T21:00:00.000Z')
  })
})

describe('the range sent to stats', () => {
  it('sends nothing for two empty days: the function fills its own thirty', () => {
    expect(statsRequest('', '')).toEqual({ ok: true, body: { action: 'stats' } })
  })

  it('is the start of the first day to the start of the day after the last, in Riyadh', () => {
    expect(statsRequest('2026-10-01', '2026-10-03')).toEqual({
      ok: true,
      body: { action: 'stats', from: '2026-10-01T00:00:00+03:00', to: '2026-10-04T00:00:00+03:00' },
    })
    // One day is both ends the same: exactly 24 hours.
    const one = statsRequest('2026-10-03', '2026-10-03')
    if (!one.ok) throw new Error('refused')
    expect(Date.parse(one.body.to!) - Date.parse(one.body.from!)).toBe(DAY_MS)
    // The last day of a year ends at the next year's start.
    expect(statsRequest('2026-12-31', '2026-12-31')).toMatchObject({ body: { from: '2026-12-31T00:00:00+03:00', to: '2027-01-01T00:00:00+03:00' } })
  })

  it('leaves out the day that is empty', () => {
    expect(statsRequest('2026-10-01', '')).toEqual({ ok: true, body: { action: 'stats', from: '2026-10-01T00:00:00+03:00' } })
    expect(statsRequest('', '2026-10-03')).toEqual({ ok: true, body: { action: 'stats', to: '2026-10-04T00:00:00+03:00' } })
  })

  it('takes 366 days, the function\'s own bound, and refuses a 367th', () => {
    for (const [from, to] of [
      ['2024-01-01', '2024-12-31'],
      ['2025-01-01', '2026-01-01'],
    ] as const) {
      const longest = statsRequest(from, to)
      if (!longest.ok) throw new Error(`${from} to ${to} refused`)
      expect(Date.parse(longest.body.to!) - Date.parse(longest.body.from!)).toBe(366 * DAY_MS)
    }
    expect(statsRequest('2025-01-01', '2026-01-02')).toEqual({ ok: false, message: RANGE_TOO_LONG })
    expect(statsRequest('2020-01-01', '2026-10-03')).toEqual({ ok: false, message: RANGE_TOO_LONG })
  })

  it('refuses a range that ends before it starts', () => {
    expect(statsRequest('2026-10-04', '2026-10-03')).toEqual({ ok: false, message: RANGE_REVERSED })
    expect(statsRequest('2027-01-01', '2026-01-01')).toEqual({ ok: false, message: RANGE_REVERSED })
  })

  it('refuses a day that is not one, whatever the other holds', () => {
    for (const [from, to] of [
      ['2026-02-30', ''],
      ['', '20261-01-01'],
      ['2026-10-01', 'غدًا'],
    ]) {
      expect(statsRequest(from!, to!), `${from} ${to}`).toEqual({ ok: false, message: DAY_INVALID })
    }
  })
})

describe('the paid file, before any call', () => {
  it('uses the bucket\'s own limit, as the Edge function holds it', () => {
    expect(PAID_FILE_MAX_BYTES).toBe(SERVER_MAX_BYTES)
    expect(PAID_FILE_MAX_BYTES).toBe(100 * 1024 * 1024)
  })

  it('takes the type the file gives, or the extension\'s when it gives none', () => {
    expect(paidFileMime('a.pdf', PDF)).toBe(PDF)
    expect(paidFileMime('a.epub', EPUB)).toBe(EPUB)
    expect(paidFileMime('a.pdf', '')).toBe(PDF)
    expect(paidFileMime('A.PDF', '')).toBe(PDF)
    expect(paidFileMime('كتاب.epub', '')).toBe(EPUB)
    // The file's own type wins: the function checks the bytes behind it.
    expect(paidFileMime('renamed.txt', PDF)).toBe(PDF)
    expect(paidFileMime('book.pdf', EPUB)).toBe(EPUB)
  })

  it('refuses any other type, and an extension that is not one', () => {
    for (const [name, type] of [
      ['a.txt', ''],
      ['a', ''],
      ['a.', ''],
      ['a.pdf.exe', ''],
      ['a.docx', ''],
      ['a.pdf', 'text/plain'],
      ['a.pdf', 'application/x-pdf'],
      ['a.epub', 'application/zip'],
      ['a.pdf', 'APPLICATION/PDF'],
    ] as const) {
      expect(paidFileMime(name, type), `${name} ${type}`).toBeNull()
    }
    expect(checkPaidFile({ name: 'a.txt', size: 10, type: '' })).toEqual({ ok: false, message: FILE_TYPE })
  })

  it('passes a good file, with its name trimmed and its type', () => {
    expect(checkPaidFile({ name: 'book.pdf', size: 1234, type: PDF })).toEqual({ ok: true, filename: 'book.pdf', mime: PDF })
    expect(checkPaidFile({ name: '  كتاب.epub ', size: 1, type: '' })).toEqual({ ok: true, filename: 'كتاب.epub', mime: EPUB })
    expect(checkPaidFile({ name: 'big.pdf', size: PAID_FILE_MAX_BYTES, type: PDF })).toMatchObject({ ok: true })
  })

  it('refuses an empty file and one over the limit, each with its sentence', () => {
    expect(checkPaidFile({ name: 'a.pdf', size: 0, type: PDF })).toEqual({ ok: false, message: FILE_EMPTY })
    expect(checkPaidFile({ name: 'a.pdf', size: PAID_FILE_MAX_BYTES + 1, type: PDF })).toEqual({ ok: false, message: FILE_TOO_LARGE })
  })

  it('refuses a name over 120 characters or holding a slash, a backslash or a control character', () => {
    const named = (name: string) => checkPaidFile({ name, size: 10, type: PDF })
    expect(named(`${'a'.repeat(116)}.pdf`)).toMatchObject({ ok: true })
    expect(named(`${'a'.repeat(117)}.pdf`)).toEqual({ ok: false, message: FILE_NAME })
    // Trailing blanks are not counted: the function trims the name, and so does this.
    expect(named(`${'a'.repeat(116)}.pdf   `)).toMatchObject({ ok: true })
    for (const bad of ['dir/book.pdf', 'dir\\book.pdf', '../book.pdf', 'bo\nok.pdf', 'bo\tok.pdf', 'bo\u0000ok.pdf', 'bo\u007Fok.pdf', '   ']) {
      expect(named(bad), JSON.stringify(bad)).toEqual({ ok: false, message: FILE_NAME })
    }
  })

  it('says each refusal in a different sentence, with no Arabic-Indic digit or dash', () => {
    const sentences = [FILE_TYPE, FILE_EMPTY, FILE_TOO_LARGE, FILE_NAME]
    expect(new Set(sentences).size).toBe(4)
    for (const sentence of sentences) expect(sentence).not.toMatch(/[٠-٩۰-۹—–]/)
  })
})

describe('the size wording', () => {
  it('is whole kilobytes (at least one) below a megabyte, megabytes with one decimal from it', () => {
    expect(formatFileSize(1)).toBe('1 كيلوبايت')
    expect(formatFileSize(1023)).toBe('1 كيلوبايت')
    expect(formatFileSize(1536)).toBe('2 كيلوبايت')
    expect(formatFileSize(10_240)).toBe('10 كيلوبايت')
    expect(formatFileSize(1_048_575)).toBe('1024 كيلوبايت')
    expect(formatFileSize(1_048_576)).toBe('1.0 ميغابايت')
    expect(formatFileSize(5_452_595)).toBe('5.2 ميغابايت')
    expect(formatFileSize(PAID_FILE_MAX_BYTES)).toBe('100.0 ميغابايت')
  })

  it('says a finished upload, and how many waiting orders were sent the link', () => {
    expect(uploadedSentence(0)).toBe('رُفع الملف.')
    expect(uploadedSentence(1)).toBe('رُفع الملف. وأُرسل رابط التنزيل إلى 1 من الطلبات المنتظرة.')
    expect(uploadedSentence(1234)).toBe('رُفع الملف. وأُرسل رابط التنزيل إلى 1,234 من الطلبات المنتظرة.')
  })
})

/** What a reply of `variant_admin_info` looks like, one key at a time to spoil. */
const variantInfo = () => ({
  ok: true,
  preorderUnits: 3,
  file: { filename: 'كتاب.pdf', mime: PDF, bytes: 12_345, createdAt: '2026-10-03T08:12:27.380123+00:00' },
})

describe('variant_admin_info, read strictly', () => {
  it('reads the count and the file', () => {
    expect(parseVariantInfo(variantInfo())).toEqual({
      preorderUnits: 3,
      file: { filename: 'كتاب.pdf', mime: PDF, bytes: 12_345, createdAt: '2026-10-03T08:12:27.380123+00:00' },
    })
    expect(parseVariantInfo({ ...variantInfo(), preorderUnits: 0, file: null })).toEqual({ preorderUnits: 0, file: null })
    // A time with a Z, a whole-second time and a keys we do not read are all fine.
    expect(parseVariantInfo({ ...variantInfo(), extra: 1, file: { ...variantInfo().file, createdAt: '2026-10-03T08:12:27Z', storageKey: 'x' } })).toMatchObject({ file: { createdAt: '2026-10-03T08:12:27Z' } })
  })

  it('reads the function\'s NOT_FOUND as no variant, and any other refusal as unreadable', () => {
    expect(parseVariantInfo({ ok: false, code: 'NOT_FOUND' })).toBeNull()
    expect(() => parseVariantInfo({ ok: false, code: 'NOT_DIGITAL' })).toThrow()
    expect(() => parseVariantInfo({ ok: false })).toThrow()
  })

  it('throws on a reply that is not an object, or has no ok', () => {
    for (const bad of [null, undefined, 'ok', 5, [], [variantInfo()], {}, { ok: 'true', preorderUnits: 0, file: null }]) {
      expect(() => parseVariantInfo(bad), JSON.stringify(bad)).toThrow()
    }
  })

  it('throws when any key is missing', () => {
    for (const key of ['preorderUnits', 'file']) {
      const reply: Record<string, unknown> = variantInfo()
      delete reply[key]
      expect(() => parseVariantInfo(reply), key).toThrow()
    }
    for (const key of ['filename', 'mime', 'bytes', 'createdAt']) {
      const reply = variantInfo()
      delete (reply.file as Record<string, unknown>)[key]
      expect(() => parseVariantInfo(reply), `file.${key}`).toThrow()
    }
  })

  it('throws when any value is of the wrong type or out of range', () => {
    const top: Array<[string, unknown[]]> = [['preorderUnits', ['3', -1, 1.5, null, Number.NaN, undefined]], ['file', ['x', 5, [], undefined]]]
    for (const [key, values] of top) {
      for (const value of values) expect(() => parseVariantInfo({ ...variantInfo(), [key]: value }), `${key}=${String(value)}`).toThrow()
    }
    const inner: Array<[string, unknown[]]> = [
      ['filename', ['', 5, null]],
      ['mime', ['', 5, null]],
      ['bytes', ['12', -1, 1.5, null]],
      ['createdAt', ['yesterday', '2026-10-03', '2026-10-03T08:12:27', '2026-10-03 08:12:27+00:00', 5, null]],
    ]
    for (const [key, values] of inner) {
      for (const value of values) expect(() => parseVariantInfo({ ...variantInfo(), file: { ...variantInfo().file, [key]: value } }), `file.${key}=${String(value)}`).toThrow()
    }
  })
})

describe('the paid-file replies, read strictly', () => {
  const TICKET = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
  const ticket = () => ({ ticket: TICKET, bucket: 'paid-files', path: `incoming/${TICKET}`, token: 'a.b.c' })

  it('reads the ticket and the completion', () => {
    expect(parseUploadTicket(ticket())).toEqual(ticket())
    expect(parseUploadDone({ assetId: TICKET, filled: 0 })).toEqual({ assetId: TICKET, filled: 0 })
    expect(parseUploadDone({ assetId: TICKET, filled: 12, more: true })).toEqual({ assetId: TICKET, filled: 12 })
  })

  it('throws on a missing key, a wrong type, an id that is no uuid and a negative count', () => {
    for (const key of Object.keys(ticket())) {
      const reply: Record<string, unknown> = ticket()
      delete reply[key]
      expect(() => parseUploadTicket(reply), key).toThrow()
      expect(() => parseUploadTicket({ ...ticket(), [key]: 5 }), key).toThrow()
      expect(() => parseUploadTicket({ ...ticket(), [key]: '' }), key).toThrow()
    }
    expect(() => parseUploadTicket({ ...ticket(), ticket: 'not-a-uuid' })).toThrow()
    expect(() => parseUploadTicket(null)).toThrow()
    expect(() => parseUploadDone({ assetId: TICKET })).toThrow()
    expect(() => parseUploadDone({ assetId: 'x', filled: 1 })).toThrow()
    expect(() => parseUploadDone({ assetId: TICKET, filled: -1 })).toThrow()
    expect(() => parseUploadDone({ assetId: TICKET, filled: '1' })).toThrow()
    expect(() => parseUploadDone('ok')).toThrow()
  })
})

/** What `owner_commerce_stats` answers (round 9's SQL), one key at a time to spoil. */
const commerce = () => ({
  environment: 'test',
  paidOrders: 3,
  grossPaid: 150_000,
  refundsConfirmed: 25_050,
  netCollected: 124_950,
  customers: 2,
  review: { open: 1, captured: 9_900, refunded: 4_000 },
  disputes: { count: 2, againstSeller: 3_000, forSeller: 500 },
})

describe('the commerce figures, read strictly', () => {
  it('reads every figure of the reply', () => {
    expect(parseCommerceStats(commerce())).toEqual(commerce())
    expect(parseCommerceStats({ ...commerce(), environment: 'live', extra: 1 })).toMatchObject({ environment: 'live' })
  })

  it('takes a negative net (a range that refunds older sales) and refuses a negative anything else', () => {
    expect(parseCommerceStats({ ...commerce(), grossPaid: 0, netCollected: -25_050 })).toMatchObject({ netCollected: -25_050 })
    for (const key of ['paidOrders', 'grossPaid', 'refundsConfirmed', 'customers']) {
      expect(() => parseCommerceStats({ ...commerce(), [key]: -1 }), key).toThrow()
    }
  })

  it('throws when any key, at any depth, is missing', () => {
    for (const key of Object.keys(commerce())) {
      const reply: Record<string, unknown> = commerce()
      delete reply[key]
      expect(() => parseCommerceStats(reply), key).toThrow()
    }
    for (const group of ['review', 'disputes'] as const) {
      for (const key of Object.keys(commerce()[group])) {
        const reply = commerce()
        delete (reply[group] as Record<string, unknown>)[key]
        expect(() => parseCommerceStats(reply), `${group}.${key}`).toThrow()
      }
    }
  })

  it('throws when any value is of the wrong type: a string, a fraction, null, a float of halalas', () => {
    for (const key of ['paidOrders', 'grossPaid', 'refundsConfirmed', 'netCollected', 'customers']) {
      for (const value of ['5', 1.5, null, Number.NaN, undefined]) {
        expect(() => parseCommerceStats({ ...commerce(), [key]: value }), `${key}=${String(value)}`).toThrow()
      }
    }
    for (const group of ['review', 'disputes'] as const) {
      for (const key of Object.keys(commerce()[group])) {
        for (const value of ['5', 1.5, null, -1]) {
          expect(() => parseCommerceStats({ ...commerce(), [group]: { ...commerce()[group], [key]: value } }), `${group}.${key}=${String(value)}`).toThrow()
        }
      }
      for (const value of [null, 'x', [], undefined]) expect(() => parseCommerceStats({ ...commerce(), [group]: value }), group).toThrow()
    }
    for (const value of ['staging', '', null, 5, undefined]) expect(() => parseCommerceStats({ ...commerce(), environment: value }), String(value)).toThrow()
    for (const bad of [null, undefined, 'x', 5, []]) expect(() => parseCommerceStats(bad)).toThrow()
  })
})

describe('the commerce lines and the sentence', () => {
  const stats: CommerceStats = parseCommerceStats(commerce())

  it('says each figure in the order the screen draws them', () => {
    expect(commerceLines(stats)).toEqual([
      'طلبات مدفوعة: 3',
      'إجمالي المدفوع: 1,500.00 ر.س',
      'الاستردادات المؤكدة: 250.50 ر.س',
      'الصافي بعد الاستردادات: 1,249.50 ر.س',
      'العملاء: 2',
      'دفعات قيد المراجعة: مفتوحة 1، مبالغها 99.00 ر.س، المسترد منها 40.00 ر.س',
      'النزاعات: 2، على البائع 30.00 ر.س، لصالح البائع 5.00 ر.س',
    ])
  })

  it('draws zeros as zeros, and a negative net with its minus on its left', () => {
    const empty = commerceLines({ ...stats, paidOrders: 0, grossPaid: 0, refundsConfirmed: 0, netCollected: 0, customers: 0, review: { open: 0, captured: 0, refunded: 0 }, disputes: { count: 0, againstSeller: 0, forSeller: 0 } })
    expect(empty[0]).toBe('طلبات مدفوعة: 0')
    expect(empty[3]).toBe('الصافي بعد الاستردادات: 0.00 ر.س')
    expect(signedMoney(-25_050)).toBe('‎-250.50 ر.س')
    expect(signedMoney(25_050)).toBe('250.50 ر.س')
    expect(commerceLines({ ...stats, netCollected: -25_050 })[3]).toBe('الصافي بعد الاستردادات: ‎-250.50 ر.س')
  })

  it('states what the net is and is not, in the contract\'s words', () => {
    expect(COMMERCE_NOTE).toBe(
      'الصافي هنا هو إجمالي المدفوع ناقص الاستردادات المؤكدة. لا يشمل رسوم بوابة الدفع ولا الاعتراضات ولا توقيت التحويل، وليس نقدًا مُسوّى في البنك ولا ربحًا.',
    )
  })
})
