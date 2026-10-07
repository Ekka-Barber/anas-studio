// Relative, not `@/`: the unit tests and the variant table config import this file, and the unit config has no alias.
import type { SettingsStatus } from '../../supabase/functions/_shared/admin.ts'
import { formatMoney, formatNumber } from './format'

/**
 * The owner's catalog and figures screens (P08 round 11c), the parts that need no React: the Riyadh day
 * (a preorder's delivery date may not be before today; the statistics range is whole days), the checks a
 * paid file passes before any call, the strict parsers of what `variant_admin_info`, the paid-file actions
 * and `stats` answer, and the words the screens say, the store settings' «الشراء» box among them.
 *
 * A reply is read key by key, as `admin-orders.ts` does: a key too few, or a value of the wrong type,
 * throws, and the screen then says it could not read the reply, never a half-drawn figure. Extra keys are
 * ignored. All money is integer halalas.
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const BAD_REPLY = 'تعذّر قراءة الرد؛ حدّث الصفحة.'
export const LOAD_FAILED = 'تعذّر التحميل.'
export const REFRESHED = 'تم التحديث.'
export const VARIANT_NOT_FOUND = 'لم نجد هذا الخيار.'

export const PREORDER_UNITS = 'طلبات مسبقة مؤكدة لم تُشحن'
export const PREORDER_STOCK_NOTE = 'أدخل المخزون الفعلي بعد طرح هذه الطلبات.'
export const NO_FILE = 'لا يوجد ملف بعد'
export const REPLACE_NOTE = 'يحل الملف الجديد محل الحالي في الطلبات الجديدة؛ الطلبات التي استلمت ملفًا تبقى عليه.'
export const UPLOADING = 'جارٍ الرفع…'
export const UPLOAD_FAILED = 'تعذّر رفع الملف؛ حاول مرة أخرى.'

// What the upload refuses before any call.
export const FILE_TYPE = 'اختر ملف PDF أو EPUB.'
export const FILE_EMPTY = 'الملف فارغ.'
export const FILE_TOO_LARGE = 'حجم الملف أكبر من 100 ميغابايت.'
export const FILE_NAME = 'اسم الملف غير صالح؛ يجب ألا يزيد على 120 حرفًا ولا يحوي شرطة مائلة.'

export const TEST_DATA = 'بيانات بيئة الاختبار'
export const STATS_UPDATED = 'تم تحديث الأرقام.'
export const COMMERCE_NOTE =
  'الصافي هنا هو إجمالي المدفوع ناقص الاستردادات المؤكدة. لا يشمل رسوم بوابة الدفع ولا الاعتراضات ولا توقيت التحويل، وليس نقدًا مُسوّى في البنك ولا ربحًا.'
export const RANGE_HINT = 'اترك الحقلين فارغين لآخر 30 يومًا.'
export const RANGE_REVERSED = 'يوم «إلى» قبل يوم «من».'
export const RANGE_TOO_LONG = 'المدى أطول من 366 يومًا.'
export const DAY_INVALID = 'اختر يومًا صحيحًا.'

// ---------------------------------------------------------------------------
// The Riyadh day
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000
/** Riyadh is UTC+3 all year, no daylight saving (the rule of `money-input.ts`'s datetime round trip). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000

/** Today's calendar day in Riyadh, `YYYY-MM-DD`. */
export function riyadhToday(now: number = Date.now()): string {
  return new Date(now + RIYADH_OFFSET_MS).toISOString().slice(0, 10)
}

/** A real calendar day as `<input type="date">` writes it (four-digit year: 2026-02-30 and 20261-01-01 are not days). */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const time = Date.parse(`${text}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text
}

/** The day after `day`, `YYYY-MM-DD`. */
export function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
}

/** The first instant of `day` in Riyadh, as the `admin` function's `stats` reads it (an ISO time with its offset). */
export function dayStart(day: string): string {
  return `${day}T00:00:00+03:00`
}

export type StatsRequest = { ok: true; body: { action: 'stats'; from?: string; to?: string } } | { ok: false; message: string }

/**
 * The `stats` request for the two days typed (inclusive, Riyadh): `from` is the start of the first day and
 * `to` the start of the day after the last, so the function's `[from, to)` holds both whole days. An empty
 * day is left out and the function fills it (`to` now, `from` thirty days before `to`). With both given, a
 * range that ends before it starts, or runs over 366 days (the function's own bound), is refused here.
 */
export function statsRequest(from: string, to: string): StatsRequest {
  if ((from !== '' && !isDay(from)) || (to !== '' && !isDay(to))) return { ok: false, message: DAY_INVALID }
  if (from !== '' && to !== '') {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
    if (days < 1) return { ok: false, message: RANGE_REVERSED }
    if (days > 366) return { ok: false, message: RANGE_TOO_LONG }
  }
  return {
    ok: true,
    body: { action: 'stats', ...(from === '' ? {} : { from: dayStart(from) }), ...(to === '' ? {} : { to: dayStart(dayAfter(to)) }) },
  }
}

// ---------------------------------------------------------------------------
// The paid file
// ---------------------------------------------------------------------------

/** The bucket's own limit (100 MiB), as `PAID_FILE_MAX_BYTES` in the Edge function's `paid-files.ts`, a Deno module the client cannot import. */
export const PAID_FILE_MAX_BYTES = 104_857_600
const PAID_FILE_NAME_MAX = 120
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = { pdf: 'application/pdf', epub: 'application/epub+zip' }

/**
 * The type the file is uploaded as: its own when the browser gave one (only the two the bucket takes), else the
 * extension's; null for anything else.
 */
export function paidFileMime(name: string, type: string): string | null {
  if (type !== '') return Object.values(MIME_BY_EXTENSION).includes(type) ? type : null
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  return extension !== undefined && Object.hasOwn(MIME_BY_EXTENSION, extension) ? (MIME_BY_EXTENSION[extension] ?? null) : null
}

export type PaidFileCheck = { ok: true; filename: string; mime: string } | { ok: false; message: string }

/**
 * What the upload checks before any call, with a sentence for each refusal: a PDF or an EPUB, not empty, not over
 * the bucket's limit, and a name the ledger takes (1 to 120 characters, no slash, no backslash, no control character).
 * The name is sent trimmed, as the function reads it.
 */
export function checkPaidFile(file: { name: string; size: number; type: string }): PaidFileCheck {
  const filename = file.name.trim()
  const mime = paidFileMime(filename, file.type)
  if (mime === null) return { ok: false, message: FILE_TYPE }
  if (file.size === 0) return { ok: false, message: FILE_EMPTY }
  if (file.size > PAID_FILE_MAX_BYTES) return { ok: false, message: FILE_TOO_LARGE }
  if (filename === '' || filename.length > PAID_FILE_NAME_MAX || /[/\\\u0000-\u001F\u007F-\u009F]/.test(filename)) {
    return { ok: false, message: FILE_NAME }
  }
  return { ok: true, filename, mime }
}

/** A size as the media library words it: megabytes with one decimal from a megabyte up, else whole kilobytes (at least one). */
export function formatFileSize(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} ميغابايت` : `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`
}

/** What a finished upload says: «رُفع الملف.» and, when orders were waiting for it, how many were sent the link. */
export function uploadedSentence(filled: number): string {
  return filled > 0 ? `رُفع الملف. وأُرسل رابط التنزيل إلى ${formatNumber(filled)} من الطلبات المنتظرة.` : 'رُفع الملف.'
}

// ---------------------------------------------------------------------------
// The replies, parsed strictly
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** An ISO time with its offset, as the database writes a timestamp ('2026-10-03T01:03:24.796123+00:00'). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

function malformed(): never {
  throw new Error('تعذّر قراءة الرد.')
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : malformed()
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : malformed()
}
function text(value: unknown): string {
  const found = str(value)
  return found === '' ? malformed() : found
}
/** A non-negative integer: halalas, a count, a size. */
function int(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : malformed()
}
/** Any integer: a net that refunds older sales is below zero. */
function signed(value: unknown): number {
  return Number.isInteger(value) ? (value as number) : malformed()
}
function uuid(value: unknown): string {
  const found = str(value)
  return UUID.test(found) ? found : malformed()
}
function time(value: unknown): string {
  const found = str(value)
  return TIMESTAMP.test(found) && !Number.isNaN(Date.parse(found)) ? found : malformed()
}

export interface PaidFileInfo {
  filename: string
  mime: string
  bytes: number
  createdAt: string
}
export interface VariantInfo {
  /** The units of the variant's committed preorders: what the owner nets out of real stock. */
  preorderUnits: number
  file: PaidFileInfo | null
}

/**
 * `variant_admin_info`: the variant's info, or null for its `NOT_FOUND` (the variant is gone). Any other shape,
 * and any other refusal, throws.
 */
export function parseVariantInfo(value: unknown): VariantInfo | null {
  const o = obj(value)
  if (o.ok === false) return o.code === 'NOT_FOUND' ? null : malformed()
  if (o.ok !== true) return malformed()
  let file: PaidFileInfo | null = null
  if (o.file !== null) {
    const f = obj(o.file)
    file = { filename: text(f.filename), mime: text(f.mime), bytes: int(f.bytes), createdAt: time(f.createdAt) }
  }
  return { preorderUnits: int(o.preorderUnits), file }
}

/** `paid-file-ticket`: the signed upload to put the file to. */
export function parseUploadTicket(value: unknown): { ticket: string; bucket: string; path: string; token: string } {
  const o = obj(value)
  return { ticket: uuid(o.ticket), bucket: text(o.bucket), path: text(o.path), token: text(o.token) }
}

/** `paid-file-complete`: the recorded asset and how many waiting orders it was handed to. */
export function parseUploadDone(value: unknown): { assetId: string; filled: number } {
  const o = obj(value)
  return { assetId: uuid(o.assetId), filled: int(o.filled) }
}

export interface CommerceStats {
  environment: 'test' | 'live'
  paidOrders: number
  grossPaid: number
  refundsConfirmed: number
  netCollected: number
  customers: number
  review: { open: number; captured: number; refunded: number }
  disputes: { count: number; againstSeller: number; forSeller: number }
}

/** `owner_commerce_stats` as the `stats` action hands it over (its `commerce`). */
export function parseCommerceStats(value: unknown): CommerceStats {
  const o = obj(value)
  const environment = str(o.environment)
  if (environment !== 'test' && environment !== 'live') return malformed()
  const review = obj(o.review)
  const disputes = obj(o.disputes)
  return {
    environment,
    paidOrders: int(o.paidOrders),
    grossPaid: int(o.grossPaid),
    refundsConfirmed: int(o.refundsConfirmed),
    netCollected: signed(o.netCollected),
    customers: int(o.customers),
    review: { open: int(review.open), captured: int(review.captured), refunded: int(review.refunded) },
    disputes: { count: int(disputes.count), againstSeller: int(disputes.againstSeller), forSeller: int(disputes.forSeller) },
  }
}

/** A sum in halalas as riyals; a negative one keeps its minus on its left in right-to-left text (a left-to-right mark before it). */
export function signedMoney(halalas: number): string {
  return halalas < 0 ? `‎${formatMoney(halalas)}` : formatMoney(halalas)
}

// ---------------------------------------------------------------------------
// The store settings' «الشراء» box (FABLE-AUDIT)
// ---------------------------------------------------------------------------

/** Why the payment settings are refused, by the reason code `status` names (`paymentsConfig`'s), in a few words. */
const PAYMENTS_REASONS: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: 'متغيرات الدفع ناقصة',
  BAD_MODE: 'وضع الدفع غير صحيح',
  KEY_MODE_MISMATCH: 'مفتاح Moyasar لا يوافق وضع الدفع',
  WEAK_WEBHOOK_SECRET: 'سرّ إشعارات Moyasar أقصر من المطلوب',
  BAD_BASE_URL: 'عنوان Moyasar غير صحيح',
  BAD_CALLBACK_BASE: 'العنوان العام للدوال غير صحيح',
  LIVE_ON_LOCAL: 'الوضع الحي غير مسموح على نسخة محلية',
  EMULATOR_ON_HOSTED: 'مفاتيح المحاكي المحلي على الموقع المنشور',
  TEST_CODE_REQUIRED: 'رمز الوصول التجريبي ناقص',
}

/** What `status` says of the payments, in one plain sentence, with the reason of a refusal; nothing beyond it. */
export function paymentsLine(payments: SettingsStatus['payments']): string {
  if (!payments.configured) {
    const reason = payments.reason !== undefined && Object.hasOwn(PAYMENTS_REASONS, payments.reason) ? PAYMENTS_REASONS[payments.reason] : undefined
    return reason === undefined ? 'الدفع غير مضبوط' : `الدفع غير مضبوط: ${reason}`
  }
  if (payments.mode === 'live') return 'الدفع مضبوط: وضع حي'
  return payments.emulator ? 'الدفع مضبوط: وضع تجريبي، محاكٍ محلي' : 'الدفع مضبوط: وضع تجريبي'
}

/**
 * Whether the store takes new orders now (`commerce_settings_get`'s `checkoutOpen`, the cart's own rule, not
 * the switch alone) and, when it does not, the first reason `checkoutClosedReason` names. «اعتماد السياسات»
 * comes before the «الشراء» box on that screen, hence «أعلاه».
 */
export function checkoutLine(row: { checkoutOpen: boolean; checkoutClosedReason: string | null }): string {
  if (row.checkoutOpen) return 'الشراء مفتوح'
  if (row.checkoutClosedReason === 'SELLER_UNSET') return 'الشراء مغلق: بيانات البائع ناقصة'
  if (row.checkoutClosedReason === 'POLICIES_UNAPPROVED') return 'الشراء مغلق: السياسات تحتاج اعتمادًا (انظر «اعتماد السياسات» أعلاه)'
  // SWITCH_OFF, or a reason this screen does not know.
  return 'الشراء مغلق'
}

/** The figures of the «المتجر» section, one «label: value» line each, in the order the screen draws them. */
export function commerceLines(stats: CommerceStats): string[] {
  const { review, disputes } = stats
  return [
    `طلبات مدفوعة: ${formatNumber(stats.paidOrders)}`,
    `إجمالي المدفوع: ${formatMoney(stats.grossPaid)}`,
    `الاستردادات المؤكدة: ${formatMoney(stats.refundsConfirmed)}`,
    `الصافي بعد الاستردادات: ${signedMoney(stats.netCollected)}`,
    `العملاء: ${formatNumber(stats.customers)}`,
    `دفعات قيد المراجعة: مفتوحة ${formatNumber(review.open)}، مبالغها ${formatMoney(review.captured)}، المسترد منها ${formatMoney(review.refunded)}`,
    `النزاعات: ${formatNumber(disputes.count)}، على البائع ${formatMoney(disputes.againstSeller)}، لصالح البائع ${formatMoney(disputes.forSeller)}`,
  ]
}
