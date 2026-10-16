// Relative, not `@/`: the unit tests and the variant table config import this file, and the unit config has no alias.
import type { SettingsStatus } from '../../supabase/functions/_shared/admin.ts'
import { PAID_FILE_MAX_BYTES } from '../../supabase/functions/_shared/paid-file-rules.ts'
import { isDay, riyadhToday } from '../../supabase/functions/_shared/riyadh-day.ts'
import { formatMoney, formatNumber, formatRiyadh } from './format'

/**
 * The owner's catalog and figures screens (P08 round 11c), the parts that need no React: the Riyadh day
 * (a preorder's delivery date may not be before today; the statistics range is whole days; the day and the
 * paid file's limit are the pure modules the `admin` function imports too, re-exported here for the screens),
 * the checks a paid file passes before any call, the strict parsers of what `variant_admin_info`, the paid-file
 * actions and `stats` answer, and the words the screens say, the store settings' «الشراء» box among them.
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
/** Said on the variant panel's alert line for a digital variant on sale whose panel read no paid file (ADMIN-COMMERCE-15). */
export const ON_SALE_WITHOUT_FILE = 'هذا الخيار معروض للبيع بلا ملف: من يشتريه ينتظر حتى ترفع الملف. ارفع الملف أو أوقف عرضه.'
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

// Today in Riyadh, and what a real calendar day is: one definition (`riyadh-day.ts`) for the screens and the function.
export { isDay, riyadhToday }

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

// The bucket's own limit (100 MiB): the pure module the Edge function's `paid-files.ts` imports too.
export { PAID_FILE_MAX_BYTES }
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

/**
 * A saved variant that is digital, not a preorder and on sale (`enabled`, «معروض للبيع»), whose panel read no paid file: whoever
 * buys it pays for a download that does not exist yet and waits until the file is uploaded (ADMIN-COMMERCE-15). `info` is what the
 * panel read: null while it has read nothing (loading, failed, no variant), when nothing is said.
 */
export function soldWithoutFile(variant: { digital: boolean; preorder: boolean; enabled: boolean }, info: VariantInfo | null): boolean {
  return variant.digital && !variant.preorder && variant.enabled && info !== null && info.file === null
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

// ---------------------------------------------------------------------------
// The catalog forms' refusals
// ---------------------------------------------------------------------------

/** What a catalog form says of a 23514 (a check of the table) that its config has no sentence for. */
export const CHECK_MESSAGE = 'تحقق من القيم.'

/**
 * The sentence of a failed check (SQLSTATE 23514, ADMIN-COMMERCE-14): the table config's own for the check the error names (PostgREST
 * passes Postgres' text, `... violates check constraint "<name>"`), else the general one. `byCheck` maps a check's name to its sentence.
 */
export function checkMessage(error: { message?: string }, byCheck: Readonly<Record<string, string>> | undefined): string {
  const name = /violates check constraint "([^"]+)"/.exec(error.message ?? '')?.[1]
  return name !== undefined && byCheck !== undefined && Object.hasOwn(byCheck, name) ? (byCheck[name] ?? CHECK_MESSAGE) : CHECK_MESSAGE
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

/**
 * A published policy as `commerce_settings_get` lists it in `publishedPolicies`: the revision (`seq`) an approval would pin
 * and when that revision went live. The list is the policies an approval covers, in the order the SQL gives them.
 */
export interface PublishedPolicy {
  id: string
  title: string
  seq: number
  publishedAt: string
}

/** `publishedPolicies`, read key by key; a reply that is not what it should be throws (a missing title reads as empty). */
export function parsePublishedPolicies(value: unknown): PublishedPolicy[] {
  if (!Array.isArray(value)) return malformed()
  return value.map((entry) => {
    const o = obj(entry)
    return { id: text(o.id), title: str(o.title ?? ''), seq: int(o.seq), publishedAt: time(o.publishedAt) }
  })
}

/** The `revisions` of «اعتماد السياسات»: exactly the policies the screen lists, each at the revision it showed. */
export function approvalRevisions(policies: readonly PublishedPolicy[]): Record<string, number> {
  return Object.fromEntries(policies.map((policy) => [policy.id, policy.seq]))
}

/** One line of the list above «اعتماد السياسات»: «<name>: نُشرت <Riyadh date and time>». */
export function publishedPolicyLine(name: string, publishedAt: string): string {
  return `${name}: نُشرت ${formatRiyadh(publishedAt)}`
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
    // Of the review payments that arrived in the range: the sums are of the riyal ones (the SQL), the open count is of every currency and as they stand now.
    `دفعات وصلت للمراجعة في المدة: مبالغها ${formatMoney(review.captured)}، المسترد منها ${formatMoney(review.refunded)}، المفتوح منها الآن ${formatNumber(review.open)}`,
    `النزاعات: ${formatNumber(disputes.count)}، على البائع ${formatMoney(disputes.againstSeller)}، لصالح البائع ${formatMoney(disputes.forSeller)}`,
  ]
}

// ---------------------------------------------------------------------------
// The store settings screen's calls (FABLE-AUDIT F3-5, F3-16)
// ---------------------------------------------------------------------------

export const FACTORS_UNREADABLE = 'تعذّر قراءة حالة المصادقة؛ حدّث الصفحة.'
export const SAVED_NOT_REFRESHED = 'تم الحفظ؛ تعذّر تحديث الشاشة، حدّثها.'

/** An authenticator as `mfa.listFactors()` lists it. */
interface ListedFactor {
  id: string
  status: string
}

/** What the owner's authenticators come to: a verified one to ask for a code with, none enrolled, or a list that could not be read. */
export type FactorReading = { kind: 'verified'; id: string } | { kind: 'none' } | { kind: 'failed' }

/**
 * `mfa.listFactors()`'s answer as the settings screen needs it. A list that could not be read says nothing about
 * enrolment: it is `failed`, never `none` (which sends an owner who has an authenticator to enrol one).
 */
export function factorReading(reply: { data: { totp: readonly ListedFactor[] } | null; error: unknown }): FactorReading {
  if (reply.error || !reply.data || !Array.isArray(reply.data.totp)) return { kind: 'failed' }
  const verified = reply.data.totp.find((factor) => factor.status === 'verified')
  return verified === undefined ? { kind: 'none' } : { kind: 'verified', id: verified.id }
}

/**
 * The settings screen once an action went through: the settings read again and its own success sentence. When the
 * reading fails the version the screen still holds is spent (the action raised it), and the next action sent with it
 * would be refused as a change from another session that never happened. The screen is then `stale`: it says so, in
 * place of the success sentence, and sends nothing until the page is read again.
 */
export async function afterSaved<Row>(
  reread: () => Promise<Row | null>,
  success: string,
): Promise<{ row: Row | null; stale: boolean; sentence: string }> {
  let row: Row | null = null
  try {
    row = await reread()
  } catch {
    // A reading that threw is a reading that failed.
  }
  return row === null ? { row: null, stale: true, sentence: SAVED_NOT_REFRESHED } : { row, stale: false, sentence: success }
}
